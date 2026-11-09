import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import stairEdges from '#/bot/event/webwalk/data/stairEdges.json';
import { skipUnless } from '../lib/skipUnless.js';

interface Point {
    x: number;
    z: number;
    level: number;
}

interface StairEdge {
    from: Point;
    to: Point;
    action: string;
    debugName?: string;
    options?: (string | null)[];
    locX?: number;
    locZ?: number;
    locId?: number;
    disabledReason?: string;
}

const edges = stairEdges as StairEdge[];
const CONTENT_DIR = process.env.CONTENT_DIR;
const HEADER_RE = /^\[([^\]]+)]([ \t].*)?$/gm;
const MOVEMENT_CALL_RE = /(?:~|@)?(?:p_telejump|p_teleport|climb_ladder|stair_options|ladder_options)\s*\(/g;
const COORD_RE = /^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/;
const MOVECORD_RE = /^movecoord\s*\((.*)\)$/s;

function pointKey(point: Point): string {
    return `${point.x},${point.z},${point.level}`;
}

function parseCoord(value: string): Point | null {
    const match = COORD_RE.exec(value.trim());
    if (!match) return null;
    const [, level, mapX, mapZ, localX, localZ] = match;
    return { x: Number(mapX) * 64 + Number(localX), z: Number(mapZ) * 64 + Number(localZ), level: Number(level) };
}

function splitArgs(value: string): string[] {
    const args: string[] = [];
    let start = 0;
    let depth = 0;
    let quoted = false;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === '"' && value[i - 1] !== '\\') quoted = !quoted;
        if (quoted) continue;
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) {
            args.push(value.slice(start, i).trim());
            start = i + 1;
        }
    }
    args.push(value.slice(start).trim());
    return args;
}

function callArgs(text: string, open: number): string[] {
    let depth = 0;
    let quoted = false;
    let start = open + 1;
    const args: string[] = [];
    for (let i = open + 1; i < text.length; i++) {
        const char = text[i];
        if (char === '"' && text[i - 1] !== '\\') quoted = !quoted;
        if (quoted) continue;
        if (char === '(') depth++;
        else if (char === ')') {
            if (depth === 0) {
                args.push(text.slice(start, i).trim());
                return args;
            }
            depth--;
        } else if (char === ',' && depth === 0) {
            args.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    return [];
}

function contentFiles(directory: string, extension: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...contentFiles(fullPath, extension));
        else if (entry.isFile() && entry.name.endsWith(extension)) files.push(fullPath);
    }
    return files;
}

function contentHandlers(scriptsDir: string): Map<string, string[]> {
    const handlers = new Map<string, string[]>();
    const labels = new Map<string, string[]>();
    const aliases = new Map<string, string[]>();
    for (const file of contentFiles(scriptsDir, '.rs2')) {
        const text = readFileSync(file, 'utf8');
        const headers = [...text.matchAll(HEADER_RE)];
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            const name = header[1];
            const bodyStart = header.index! + header[0].length;
            const body = text.slice(bodyStart, headers[i + 1]?.index ?? text.length);
            const oploc = /^oploc([1-5]),([^,]+)$/.exec(name);
            if (oploc) {
                const key = `${oploc[2]}|${oploc[1]}`;
                const trailer = (header[2] ?? '').trim();
                const alias = /^@([a-zA-Z0-9_]+);?$/.exec(trailer)?.[1];
                if (alias) {
                    aliases.set(key, [...(aliases.get(key) ?? []), alias]);
                } else {
                    handlers.set(key, [...(handlers.get(key) ?? []), body]);
                }
                continue;
            }
            const label = /^label,([^,]+)$/.exec(name);
            if (label) labels.set(label[1], [...(labels.get(label[1]) ?? []), body]);
        }
    }
    for (const [key, names] of aliases) {
        handlers.set(key, [...(handlers.get(key) ?? []), ...names.flatMap(name => labels.get(name) ?? [])]);
    }
    const expandLabels = (body: string, visiting = new Set<string>()): string => {
        const resolved: string[] = [body];
        const uncommented = body.replace(/\/\/[^\n]*/g, '');
        for (const match of uncommented.matchAll(/@([a-zA-Z0-9_]+)/g)) {
            const label = match[1];
            if (visiting.has(label)) continue;
            const next = new Set(visiting);
            next.add(label);
            resolved.push(...(labels.get(label) ?? []).map(labelBody => expandLabels(labelBody, next)));
        }
        return resolved.join('\n');
    };
    for (const [key, bodies] of handlers) {
        handlers.set(key, bodies.map(body => expandLabels(body)));
    }
    return handlers;
}

function contentOptionOperations(scriptsDir: string): Map<string, Map<string, number[]>> {
    const options = new Map<string, Map<string, number[]>>();
    for (const locFile of contentFiles(scriptsDir, '.loc')) {
        const text = readFileSync(locFile, 'utf8');
        const headers = [...text.matchAll(/^\[([^\]]+)]\s*$/gm)];
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            const bodyStart = header.index! + header[0].length;
            const body = text.slice(bodyStart, headers[i + 1]?.index ?? text.length);
            for (const match of body.matchAll(/^op([1-5])=(.*)$/gm)) {
                const operation = match[2].split('//', 1)[0].trim().toLowerCase();
                if (!operation) continue;
                const byAction = options.get(header[1]) ?? new Map<string, number[]>();
                const indexes = byAction.get(operation) ?? [];
                const op = Number(match[1]);
                if (!indexes.includes(op)) byAction.set(operation, [...indexes, op].sort((a, b) => a - b));
                options.set(header[1], byAction);
            }
        }
    }
    return options;
}

const COORD_CASE_RE = /\bcase\s+\d+_\d+_\d+_\d+_\d+\s*:/;
const SWITCH_COORD_RE = /\bswitch_coord\s*\([^)]*\)\s*\{/gi;
const MISSING_HANDLER_REASON_RE = /^No (?:revision 377 OPLOC movement handler|matching revision 377 OPLOC handler) for this location action\.$/;

function switchCoordBlocks(body: string): { start: number; end: number }[] {
    const blocks: { start: number; end: number }[] = [];
    let coveredThrough = -1;
    for (const match of body.matchAll(SWITCH_COORD_RE)) {
        const start = match.index!;
        if (start < coveredThrough) continue;
        const openBrace = start + match[0].lastIndexOf('{');
        let depth = 0;
        let quoted = false;
        let escaped = false;
        let end = -1;
        for (let i = openBrace; i < body.length; i++) {
            const char = body[i]!;
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
                continue;
            }
            if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                end = i + 1;
                break;
            }
        }
        if (end < 0) throw new Error('Unclosed switch_coord block in content handler');
        blocks.push({ start, end });
        coveredThrough = end;
    }
    return blocks;
}

function hasMovementCall(body: string): boolean {
    MOVEMENT_CALL_RE.lastIndex = 0;
    return MOVEMENT_CALL_RE.test(body);
}

function sourceCaseDestinationCandidates(
    handlers: Map<string, string[]>,
    edge: StairEdge,
    operations: number[],
    onlyHandler?: string
): Set<string> {
    const candidates = new Set<string>();
    if (edge.locX === undefined || edge.locZ === undefined) return candidates;
    const placement = { x: edge.locX, z: edge.locZ, level: edge.from.level };
    for (const [handler, bodies] of handlers) {
        const match = /^(.*)\|([1-5])$/.exec(handler);
        const name = match?.[1];
        const op = Number(match?.[2]);
        if (!op || !operations.includes(op) || (onlyHandler !== undefined && name !== onlyHandler)) continue;
        for (const rawBody of bodies) {
            const body = rawBody.replace(/\/\/[^\n]*/g, '');
            let matchedSource = false;
            const defaultCases: string[] = [];
            for (const block of switchCoordBlocks(body)) {
                const openBrace = body.indexOf('{', block.start);
                const switchBody = body.slice(openBrace + 1, block.end - 1);
                const cases = [...switchBody.matchAll(/\bcase\s+(\d+_\d+_\d+_\d+_\d+|default)\s*:/g)];
                for (let i = 0; i < cases.length; i++) {
                    const start = cases[i]!.index! + cases[i]![0].length;
                    const end = cases[i + 1]?.index ?? switchBody.length;
                    const branch = switchBody.slice(start, end);
                    if (cases[i]![1] === 'default') {
                        defaultCases.push(branch);
                        continue;
                    }
                    const source = parseCoord(cases[i]![1]!);
                    if (
                        !source
                        || source.level !== placement.level
                        || Math.max(Math.abs(source.x - placement.x), Math.abs(source.z - placement.z)) > 2
                    ) {
                        continue;
                    }
                    matchedSource = true;
                    for (const destination of destinationCandidates(branch, edge)) candidates.add(destination);
                }
            }
            if (onlyHandler !== undefined && !matchedSource) {
                for (const branch of defaultCases) {
                    for (const destination of destinationCandidates(branch, edge)) candidates.add(destination);
                }
            }
        }
    }
    return candidates;
}

function unscopedDestinationCandidates(
    handlers: Map<string, string[]>,
    edge: StairEdge,
    operations: number[],
    onlyHandler?: string
): Set<string> {
    const candidates = new Set<string>();
    for (const [handler, bodies] of handlers) {
        const match = /^(.*)\|([1-5])$/.exec(handler);
        const name = match?.[1];
        const op = Number(match?.[2]);
        if (!op || !operations.includes(op) || (onlyHandler !== undefined && name !== onlyHandler)) continue;
        for (const rawBody of bodies) {
            const body = rawBody.replace(/\/\/[^\n]*/g, '');
            let cursor = 0;
            for (const block of switchCoordBlocks(body)) {
                for (const destination of destinationCandidates(body.slice(cursor, block.start), edge)) candidates.add(destination);
                cursor = block.end;
            }
            for (const destination of destinationCandidates(body.slice(cursor), edge)) candidates.add(destination);
        }
    }
    return candidates;
}

function handlerHasUnscopedMovement(
    handlers: Map<string, string[]>,
    operations: number[],
    onlyHandler?: string
): boolean {
    for (const [handler, bodies] of handlers) {
        const match = /^(.*)\|([1-5])$/.exec(handler);
        const name = match?.[1];
        const op = Number(match?.[2]);
        if (!op || !operations.includes(op) || (onlyHandler !== undefined && name !== onlyHandler)) continue;
        for (const rawBody of bodies) {
            const body = rawBody.replace(/\/\/[^\n]*/g, '');
            let cursor = 0;
            for (const block of switchCoordBlocks(body)) {
                if (hasMovementCall(body.slice(cursor, block.start))) return true;
                cursor = block.end;
            }
            if (hasMovementCall(body.slice(cursor))) return true;
        }
    }
    return false;
}

function destinationCandidates(body: string, edge: StairEdge): Set<string> {
    const candidates = new Set<string>();
    const assignments = new Map<string, string[]>();
    for (const match of body.matchAll(/(\$[a-zA-Z0-9_]+)\s*=\s*([^;]+);/g)) {
        assignments.set(match[1], [...(assignments.get(match[1]) ?? []), match[2].trim()]);
    }

    const resolve = (expression: string, visiting = new Set<string>()): Point[] => {
        const value = expression.trim();
        const literal = parseCoord(value);
        if (literal) return [literal];
        if (value === 'coord' || value === 'coord()') return [edge.from];
        if (value === 'loc_coord' || value === 'loc_coord()') {
            return edge.locX === undefined || edge.locZ === undefined ? [] : [{ x: edge.locX, z: edge.locZ, level: edge.from.level }];
        }
        if (value.startsWith('$') && !visiting.has(value)) {
            const next = new Set(visiting);
            next.add(value);
            return (assignments.get(value) ?? []).flatMap(item => resolve(item, next));
        }
        const move = MOVECORD_RE.exec(value);
        if (move) {
            const [baseExpression, dxText, levelText, dzText] = splitArgs(move[1]);
            const dx = Number(dxText);
            const deltaLevel = Number(levelText);
            const dz = Number(dzText);
            if (![dx, deltaLevel, dz].every(Number.isInteger)) return [];
            return resolve(baseExpression, visiting).map(base => ({ x: base.x + dx, z: base.z + dz, level: base.level + deltaLevel }));
        }
        const mapSquare = /^map_findsquare\s*\((.*)\)$/s.exec(value);
        if (mapSquare) return resolve(splitArgs(mapSquare[1])[0], visiting);
        return [];
    };

    MOVEMENT_CALL_RE.lastIndex = 0;
    for (const match of body.matchAll(MOVEMENT_CALL_RE)) {
        const open = match.index! + match[0].lastIndexOf('(');
        const args = callArgs(body, open);
        const isChoice = /(?:stair_options|ladder_options)\s*\($/.test(match[0]);
        const expressions = isChoice ? args.slice(0, 2) : args.slice(0, 1);
        for (const expression of expressions) {
            for (const point of resolve(expression)) candidates.add(pointKey(point));
        }
    }
    return candidates;
}

test('Lumbridge Castle South staircase lands only on its content teleport destination', () => {
    const group = edges.filter(edge =>
        edge.debugName === 'scenery_1739'
        && edge.locId === 1739
        && edge.locX === 3204
        && edge.locZ === 3207
        && edge.action === 'Climb-down'
        && edge.from.x === 3205
        && edge.from.z === 3209
        && edge.from.level === 1
    );
    expect(new Set(group.map(edge => pointKey(edge.to)))).toEqual(new Set(['3205,3209,0']));
});

test('Varrock West Bank dungeon stairs retain the walkable approach beyond their footprint', () => {
    const exits = edges.filter(edge =>
        edge.debugName === 'scenery_1734'
        && edge.locId === 1734
        && edge.locX === 3187
        && edge.locZ === 9833
        && edge.action === 'Climb-up'
    );
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({
        from: { x: 3190, z: 9833, level: 0 },
        to: { x: 3186, z: 3433, level: 0 }
    });
    expect(exits[0]?.disabledReason).toBeUndefined();
});

test('ladder_1749 Climb-down placements stay enabled', () => {
    const descents = edges.filter(edge => edge.debugName === 'ladder_1749' && edge.action === 'Climb-down');
    expect(descents).toHaveLength(24);
    expect(descents.filter(edge => edge.disabledReason)).toEqual([]);

    const varrock = descents.filter(edge => edge.locX === 3202 && edge.locZ === 3416);
    expect(varrock).toHaveLength(1);
    expect(varrock[0]).toMatchObject({
        from: { x: 3202, z: 3417, level: 1 },
        to: { x: 3202, z: 3417, level: 0 }
    });
    expect(varrock[0]?.disabledReason).toBeUndefined();
});

describe.skipIf(skipUnless('content'))('377 stair landing destinations from content', () => {
    test('every content-backed stair landing matches its handler destination', () => {
        if (!CONTENT_DIR) {
            throw new Error('CONTENT_DIR must name the 377 content checkout');
        }
        const scriptsDir = path.join(CONTENT_DIR, 'scripts');
        if (!existsSync(scriptsDir)) {
            throw new Error('CONTENT_DIR must name the 377 content checkout');
        }
        const handlers = contentHandlers(scriptsDir);
        const optionOps = contentOptionOperations(scriptsDir);
        const mismatches: string[] = [];
        for (const edge of edges) {
            const contentOps = edge.debugName
                ? optionOps.get(edge.debugName)?.get(edge.action.toLowerCase())
                : undefined;
            const operations = contentOps?.length
                ? contentOps
                : edge.options?.flatMap((option, index) =>
                    option?.toLowerCase() === edge.action.toLowerCase() ? [index + 1] : []
                ) ?? [];
            const bodies = edge.debugName
                ? operations.flatMap(op => handlers.get(`${edge.debugName}|${op}`) ?? [])
                : [];
            const expected = bodies.length > 0
                ? new Set([
                    ...sourceCaseDestinationCandidates(handlers, edge, operations, edge.debugName),
                    ...unscopedDestinationCandidates(handlers, edge, operations, edge.debugName),
                    ...bodies
                        .filter(body => !COORD_CASE_RE.test(body))
                        .flatMap(body => [...destinationCandidates(body, edge)])
                ])
                : new Set([
                    ...sourceCaseDestinationCandidates(handlers, edge, operations),
                    ...unscopedDestinationCandidates(handlers, edge, operations)
                ]);
            if (expected.size === 0 && edge.disabledReason) continue;
            if (!expected.has(pointKey(edge.to))) {
                mismatches.push(`${edge.debugName ?? edge.locId ?? edge.action} (${edge.action}): ${pointKey(edge.from)} -> ${pointKey(edge.to)} (content destinations: ${[...expected].join('; ') || 'no matching movement handler'})`);
            }
        }
        expect(mismatches).toEqual([]);
    });
    test('disabled no-handler stair edges have no unscoped content movement', () => {
        const scriptsDir = path.join(CONTENT_DIR!, 'scripts');
        const handlers = contentHandlers(scriptsDir);
        const optionOps = contentOptionOperations(scriptsDir);
        const disabledWithMovement: string[] = [];
        for (const edge of edges) {
            if (!edge.disabledReason || !MISSING_HANDLER_REASON_RE.test(edge.disabledReason)) continue;
            const contentOps = edge.debugName
                ? optionOps.get(edge.debugName)?.get(edge.action.toLowerCase())
                : undefined;
            const operations = contentOps?.length
                ? contentOps
                : edge.options?.flatMap((option, index) =>
                    option?.toLowerCase() === edge.action.toLowerCase() ? [index + 1] : []
                ) ?? [];
            if (edge.debugName && handlerHasUnscopedMovement(handlers, operations, edge.debugName)) {
                disabledWithMovement.push(
                    `${edge.debugName} (${edge.action}) at ${pointKey(edge.from)} / loc ${edge.locX},${edge.locZ}`
                );
            }
        }
        expect(disabledWithMovement).toEqual([]);
    });
});
