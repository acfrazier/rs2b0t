import { filesUnder } from '../lib/content.js';
import { resolveOut } from '../lib/genout.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseObjPack } from './parse.js';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = resolveOut('src/bot/data/nameCollisions.ts');


interface Named {
    obj: string;
    name: string;
}

/** Named objects that can be traded. */
// Why: certs inherit names through certtemplate; excluding them avoids duplicate entries.
function namedTradeables(text: string): Named[] {
    const out: Named[] = [];
    let obj: string | null = null;
    let name: string | null = null;
    let tradeable = true;
    const flush = (): void => {
        if (obj !== null && name !== null && tradeable) {
            out.push({ obj, name });
        }
    };
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            flush();
            obj = head[1]!;
            name = null;
            tradeable = true;
        } else if (line.startsWith('name=')) {
            name = line.slice(5);
        } else if (line === 'tradeable=no' || /^dummyitem=(?!0$)/.test(line)) {
            tradeable = false;
        }
    }
    flush();
    return out;
}

/** Tokens suitable for player input. */
// Why: leftover tokens like '1' and 's' aren't useful aliases; those groups need manual names.
function usable(word: string): boolean {
    return word.length > 1 && !/\d/.test(word);
}

/** Words that say what the group already says, so they can narrow nothing. */
// Why: the 377 content repeats whole display names inside debugnames ("unstrung_onyx_amulet" under the
// group "Onyx amulet"), and those echo tokens poison resolveAliased: any customer query containing them
// ("strung sapphire amulet", "loop half of a key") loses the words to the alias set and then filters to
// empty, because no single member's word list contains them all. Gated behind --name-echo-filter so the
// committed 289 table keeps regenerating byte-identical.
const STOPWORDS = new Set(['of', 'a', 'the', 'and']);

/** Debugname tokens minus inter-member shares; with the echo filter, minus the name's own tokens too. */
function distinguish(objs: readonly string[], nameTokens: readonly string[], echoFilter: boolean): string[][] {
    const tokens = objs.map(o => o.split('_').filter(Boolean));
    const shared = tokens[0]!.filter(t => tokens.every(other => other.includes(t)));
    return tokens.map(t =>
        t.filter(x => !shared.includes(x) && !(echoFilter && (nameTokens.includes(x) || STOPWORDS.has(x))))
    );
}

function generate(echoFilter: boolean): string {
    const named: Named[] = [];
    for (const f of filesUnder(join(CONTENT, 'scripts'), '.obj')) {
        named.push(...namedTradeables(readFileSync(f, 'utf8')));
    }
    const ids = parseObjPack(readFileSync(join(CONTENT, 'pack', 'obj.pack'), 'utf8'));

    const groups = new Map<string, { obj: string; id: number }[]>();
    for (const { obj, name } of named) {
        const id = ids.get(obj);
        if (id === undefined) {
            continue;
        }
        const key = name.toLowerCase();
        const bucket = groups.get(key);
        if (bucket) {
            bucket.push({ obj, id });
        } else {
            groups.set(key, [{ obj, id }]);
        }
    }

    const display = new Map(named.map(n => [n.name.toLowerCase(), n.name]));
    const rows = [...groups]
        .filter(([, members]) => members.length > 1)
        .map(([key, members]) => {
            const sorted = [...members].sort((a, b) => a.id - b.id);
            const nameTokens = key.split(/[^a-z0-9]+/).filter(Boolean);
            const parts = distinguish(sorted.map(m => m.obj), nameTokens, echoFilter);
            return {
                name: display.get(key)!,
                objs: sorted.map((m, i) => ({ ...m, words: parts[i]!.filter(usable) }))
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    // Why: with the echo filter, a word must not collide with any group's display name either: "amulet"
    // survives the Onyx group (the Whoopsie certs distinguish a cert amulet) yet still poisons
    // "strung sapphire amulet", because the word filter then eats the query's tail and resolves empty.
    if (echoFilter) {
        const nameWords = new Set(rows.flatMap(r => r.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
        for (const row of rows) {
            for (const member of row.objs) {
                member.words = member.words.filter(w => !nameWords.has(w));
            }
        }
    }

    const thin = rows.filter(r => r.objs.some(o => o.words.length === 0)).length;
    console.log(`groups=${rows.length} objs=${rows.reduce((n, r) => n + r.objs.length, 0)} needing-hand-words=${thin}`);
    const invocation = ['bun tools/items/gen-namecollisions.ts', ...(echoFilter ? ['--name-echo-filter'] : [])].join(' ');
    return [
        '/* eslint-disable */',
        '// GENERATED by tools/items/gen-namecollisions.ts, do not edit.',
        `// Regenerate: ${invocation}   (drift gate: --check)`,
        "import type { NameCollision } from '#/bot/api/market/aliasTypes.js';",
        '',
        'export const NAME_COLLISIONS: readonly NameCollision[] = [',
        rows.map(r => `    ${JSON.stringify(r)}`).join(',\n'),
        '];',
        ''
    ].join('\n');
}

const echoFilter = process.argv.includes('--name-echo-filter');
const fresh = generate(echoFilter);
if (process.argv.includes('--check')) {
    let current = '';
    try {
        current = readFileSync(OUT, 'utf8');
    } catch {
        // Missing output is stale.
    }
    if (current !== fresh) {
        console.error(`STALE: ${OUT} does not match the content pack — run: bun tools/items/gen-namecollisions.ts`);
        process.exit(1);
    }
    console.log(`ok: ${OUT} matches the content pack`);
} else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, fresh);
    console.log(`wrote ${OUT}`);
}
