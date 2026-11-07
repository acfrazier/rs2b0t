import { filesUnder } from '../lib/content.js';
import { resolveOut } from '../lib/genout.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = resolveOut('src/bot/data/dropdb.ts');
// Why: the 377 content renamed the directory (`drop_tables`); the generator reads whichever the
// content checkout carries, so the same tool regenerates either revision's data.
const dropScripts = ['drop_tables', 'drop tables']
    .map(dir => join(CONTENT, 'scripts', dir, 'scripts'))
    .find(dir => existsSync(dir));
if (dropScripts === undefined) {
    throw new Error(`no drop-table scripts under ${join(CONTENT, 'scripts', '{drop_tables,drop tables}')}`);
}
const DROP_DIR: string = dropScripts;
// Why: the King Black Dragon's table is an ai_queue3 block inside its area script, not a file under drop tables.
const AREA_DIR = join(CONTENT, 'scripts', 'areas');


function loadConfigNames(ext: string, extra?: (cur: string, line: string) => void): Map<string, string> {
    const files = filesUnder(join(CONTENT, 'scripts'), ext);
    const unpack = files.filter(f => f.includes('/_unpack/'));
    const canonical = files.filter(f => !f.includes('/_unpack/'));
    const names = new Map<string, string>();
    for (const f of [...unpack, ...canonical]) {
        let cur: string | null = null;
        for (const raw of readFileSync(f, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
            } else if (cur && line.startsWith('name=')) {
                names.set(cur, line.slice('name='.length));
            } else if (cur) {
                extra?.(cur, line);
            }
        }
    }
    return names;
}

interface Block {
    type: string;
    name: string;
    body: string;
}

function loadBlocks(): Map<string, Block> {
    const blocks = new Map<string, Block>();
    for (const f of [...filesUnder(DROP_DIR, '.rs2'), ...filesUnder(AREA_DIR, '.rs2')]) {
        let cur: Block | null = null;
        const lines: string[] = [];
        const flush = (): void => { if (cur) { cur.body = lines.join('\n'); blocks.set(`${cur.type}:${cur.name}`, cur); lines.length = 0; } };
        for (const raw of readFileSync(f, 'utf8').split('\n')) {
            const head = /^\[([a-z0-9_]+)\s*,\s*([a-z0-9_]+)\]/.exec(raw.trim());
            if (head) {
                flush();
                cur = { type: head[1], name: head[2], body: '' };
            } else if (cur) {
                lines.push(raw);
            }
        }
        flush();
    }
    return blocks;
}

const objNames = loadConfigNames('.obj');
const deathDrops = new Map<string, string>();
const categories = new Map<string, string[]>();
const npcNames = loadConfigNames('.npc', (cur, line) => {
    if (line.startsWith('param=death_drop,')) {
        deathDrops.set(cur, line.slice('param=death_drop,'.length).split(',')[0].trim());
    } else if (line.startsWith('category=')) {
        const cat = line.slice('category='.length).trim();
        categories.set(cat, [...(categories.get(cat) ?? []), cur]);
    }
});
const blocks = loadBlocks();

/** Every `[ai_queue3,<npc or _category>]` block under the content scripts, name to body; the default `[ai_queue3,_]` is not an owner. */
function loadQueue3Bodies(): Map<string, string> {
    const bodies = new Map<string, string>();
    for (const f of filesUnder(join(CONTENT, 'scripts'), '.rs2')) {
        let cur: string | null = null;
        const lines: string[] = [];
        const flush = (): void => { if (cur !== null) { bodies.set(cur, lines.join('\n')); } lines.length = 0; };
        for (const raw of readFileSync(f, 'utf8').split('\n')) {
            const head = /^\[([a-z0-9_]+)\s*,\s*([a-z0-9_]+)\](.*)$/.exec(raw.trim());
            if (head) {
                flush();
                cur = head[1] === 'ai_queue3' && head[2] !== '_' ? head[2] : null;
                lines.push(head[3]);
            } else if (cur !== null) {
                lines.push(raw);
            }
        }
        flush();
    }
    return bodies;
}

function itemsIn(key: string, deathDrop: string | undefined, seen: Set<string>): Set<string> {
    const out = new Set<string>();
    const block = blocks.get(key);
    if (!block || seen.has(key)) {
        return out;
    }
    seen.add(key);
    const tokens: string[] = [];
    for (const m of block.body.matchAll(/obj_add\s*\(\s*npc_coord\s*,\s*(~?[a-z0-9_]+)/g)) { tokens.push(m[1]); }
    for (const m of block.body.matchAll(/return\s*\(\s*(~?[a-z0-9_]+)/g)) { tokens.push(m[1]); }
    // megararetable stages its drop in a local ($drop = rune_spear; ... return ($drop, 1)), so the literal never follows `return (`. Non-obj tokens are filtered below.
    for (const m of block.body.matchAll(/=\s*([a-z][a-z0-9_]*)\s*;/g)) { tokens.push(m[1]); }
    for (const tok of tokens) {
        if (tok.startsWith('~')) {
            for (const it of itemsIn(`proc:${tok.slice(1)}`, deathDrop, seen)) { out.add(it); }
        } else if (tok === 'npc_param') {
            if (deathDrop) { out.add(deathDrop); }
        } else if (objNames.has(tok)) {
            out.add(tok);
        } else if (tok.startsWith('cert_') && objNames.has(tok.slice('cert_'.length))) {
            // noted forms are generated, so cert_<x> has no [cert_<x>] block to look up
            out.add(tok.slice('cert_'.length));
        }
    }
    return out;
}

function generate(): string {
    const byDisplay = new Map<string, Set<string>>();
    // Why: a block named _x is the table for every npc whose config says category=x, and the engine runs an npc's own block instead of it, so the category table only lands where no own block exists.
    const npcsOf = (block: Block): string[] => {
        if (!block.name.startsWith('_')) {
            return npcNames.has(block.name) ? [block.name] : [];
        }
        return (categories.get(block.name.slice(1)) ?? []).filter(npc => npcNames.has(npc) && !blocks.has(`${block.type}:${npc}`));
    };
    for (const block of blocks.values()) {
        if (!/^ai_queue/.test(block.type)) {
            continue;
        }
        for (const npc of npcsOf(block)) {
            const items = itemsIn(`${block.type}:${block.name}`, deathDrops.get(npc), new Set());
            if (items.size === 0) {
                continue;
            }
            const display = npcNames.get(npc)!;
            const set = byDisplay.get(display) ?? new Set<string>();
            for (const it of items) {
                const name = objNames.get(it);
                if (name) { set.add(name); }
            }
            byDisplay.set(display, set);
        }
    }

    // Why: an npc with no ai_queue3 block of its own or of its category runs the default death script, which adds the npc's `death_drop` param (377 skill_combat/scripts/npc/npc_combat.rs2:3,90-95); an own block that gosubs npc_default_death adds it too. Without this the table omits e.g. the iron dragon's dragon bones.
    const queue3 = loadQueue3Bodies();
    const categoryOf = new Map<string, string[]>();
    for (const [cat, npcs] of categories) {
        for (const npc of npcs) {
            categoryOf.set(npc, [...(categoryOf.get(npc) ?? []), cat]);
        }
    }
    for (const [npc, drop] of deathDrops) {
        const display = npcNames.get(npc);
        const name = objNames.get(drop);
        if (!display || !name) {
            continue;
        }
        const handler = queue3.get(npc) ?? (categoryOf.get(npc) ?? []).map(cat => queue3.get(`_${cat}`)).find(body => body !== undefined);
        if (handler === undefined || /\bnpc_default_death\b/.test(handler)) {
            byDisplay.set(display, (byDisplay.get(display) ?? new Set<string>()).add(name));
        }
    }

    const rows = [...byDisplay.entries()]
        .filter(([, set]) => set.size > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([monster, set]) => `    ${JSON.stringify(monster)}: ${JSON.stringify([...set].sort())}`);

    return [
        '/* eslint-disable */',
        '// GENERATED by tools/combat/gen-dropdb.ts, do not edit.',
        '// Regenerate: bun tools/combat/gen-dropdb.ts   (drift gate: --check)',
        '',
        '/** Monster display name to the item display names its drop table can yield (direct drops, always-drop, and resolved herb/gem/jewel sub-tables). Powers the loot multi-select. */',
        'export const DROP_DB: Record<string, string[]> = {',
        rows.join(',\n'),
        '};',
        ''
    ].join('\n');
}

const text = generate();
if (process.argv.includes('--check')) {
    const current = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();
    if (current !== text) {
        console.error(`${OUT} is stale — regenerate with: bun tools/combat/gen-dropdb.ts`);
        process.exit(1);
    }
    console.log(`${OUT} is up to date`);
} else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT} (${(text.match(/^ {4}"/gm) ?? []).length} monsters)`);
}
