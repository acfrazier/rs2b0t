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
            const cases = [...body.matchAll(/\bcase\s+(\d+_\d+_\d+_\d+_\d+|default)\s*:/g)];
            for (let i = 0; i < cases.length; i++) {
                const start = cases[i].index! + cases[i][0].length;
                const end = cases[i + 1]?.index ?? body.length;
                const branch = body.slice(start, end);
                if (cases[i][1] === 'default') {
                    defaultCases.push(branch);
                    continue;
                }
                const source = parseCoord(cases[i][1]);
                if (
                    !source
                    || source.level !== placement.level
                    || Math.max(Math.abs(source.x - placement.x), Math.abs(source.z - placement.z)) > 2
                ) {
                    continue;
                }
                matchedSource = true;
                for (const destination of destinationCandidates(branch, edge)) {
                    candidates.add(destination);
                }
            }
            if (onlyHandler !== undefined && !matchedSource) {
                for (const branch of defaultCases) {
                    for (const destination of destinationCandidates(branch, edge)) {
                        candidates.add(destination);
                    }
                }
            }
        }
    }
    return candidates;
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
                    ...bodies
                        .filter(body => !COORD_CASE_RE.test(body))
                        .flatMap(body => [...destinationCandidates(body, edge)])
                ])
                : sourceCaseDestinationCandidates(handlers, edge, operations);
            if (expected.size === 0 && edge.disabledReason) continue;
            if (!expected.has(pointKey(edge.to))) {
                mismatches.push(`${edge.debugName ?? edge.locId ?? edge.action} (${edge.action}): ${pointKey(edge.from)} -> ${pointKey(edge.to)} (content destinations: ${[...expected].join('; ') || 'no matching movement handler'})`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
