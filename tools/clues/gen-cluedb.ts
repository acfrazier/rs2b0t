import { filesUnder } from '../lib/content.js';
import { resolveOut } from '../lib/genout.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';

import { decodeCoord } from '../nav/stairsParse.js';
import { buildClueDb, parseChallengeTalk, parseClueObjs, parseEnum, parseKillForKey, parsePuzzleTalk, parseTalkMappings, type ClueType, type ParsedClueObj, type PuzzleMapping, type TalkMapping } from './cluesParse.js';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = resolveOut('src/bot/api/ai/clues/data/cluedb.ts');
const PIECES_OUT = resolveOut('src/bot/api/ai/clues/data/puzzlePieces.ts');
const TRAIL = join(CONTENT, 'scripts', 'minigames', 'game_trail', 'configs');
const MEDIUM_SCRIPT = join(CONTENT, 'scripts', 'minigames', 'game_trail', 'scripts', 'medium', 'trail_clue_medium.rs2');

/** The `[trail_*]` obj corpus from every .obj under `scripts/`: 289 keeps it in
 *  `game_trail/configs/trail*.obj`, 377 in `scripts/_unpack/377/all.obj`, read the way the
 *  engine's packer reads configs: every file under `scripts/`, names unique across the tree
 *  (PackShared refuses duplicates), ids resolved through `pack/obj.pack`. */
function loadTrailObjs(): Record<string, ParsedClueObj> {
    const out: Record<string, ParsedClueObj> = {};
    for (const f of filesUnder(join(CONTENT, 'scripts'), '.obj')) {
        const parsed = parseClueObjs(readFileSync(f, 'utf8'));
        for (const [id, obj] of Object.entries(parsed)) {
            if (!id.startsWith('trail_')) {
                continue;
            }
            if (id in out) {
                throw new Error(`duplicate trail obj block: ${id}`);
            }
            out[id] = obj;
        }
    }
    return out;
}

const VAGUE003_COORD = '1_40_51_14_62';

// Two hard clues keep their coord in the handler script, so the generator can't read them off the obj corpus.
const HARD_SPECIAL_COORDS: Record<string, string> = {
    // 377 scripts/quests/quest_fluffs/scripts/quest_fluffs.rs2:288-290, gertrudeempty_crate (oploc1)
    trail_clue_hard_map001: '0_51_54_45_47',
    // 289 only: 377 has no trail_clue_hard_riddle022 in trail_hard.enum; 289 general_use/bookcases.rs2, switch_coord
    trail_clue_hard_riddle022: '1_42_53_14_17'
};

// The key chests/drawers; each line is the 377 content source of the loc_coord branch that opens it.
const RIDDLE_KEY_COORDS: Record<string, string> = {
    // scripts/general_use/scripts/chests.rs2:10 (chest)
    trail_clue_medium_riddle001: '0_50_54_56_31',
    // scripts/general_use/scripts/drawers.rs2:5 (drawers)
    trail_clue_medium_riddle002: '1_40_51_14_62',
    // scripts/general_use/scripts/drawers.rs2:8
    trail_clue_medium_riddle003: '1_40_51_51_60',
    // scripts/general_use/scripts/drawers.rs2:11
    trail_clue_medium_riddle004: '0_42_54_21_22',
    // scripts/general_use/scripts/chests.rs2:12 (chest)
    trail_clue_medium_riddle005: '1_40_48_33_36',
    // 289 only: 377 has no riddle007/008 in trail_medium.enum; 289 general_use/drawers.rs2:17,19
    trail_clue_medium_riddle007: '1_43_49_57_29',
    trail_clue_medium_riddle008: '0_45_55_41_57'
};

const NPC_ALIAS: Record<string, string> = { _sailor: 'captain_tobias' };

// Extra items the content pack doesn't record. Bank-only: the solver withdraws them and never goes to fetch them.
const CLUE_ITEMS: Record<string, string[]> = {
    // The dig tile is on the Baxtorian Falls ledge, reached by rope.
    trail_clue_medium_sextant006: ['Rope']
};


function loadObjIds(): Map<string, number> {
    const text = readFileSync(join(CONTENT, 'pack', 'obj.pack'), 'utf8');
    const out = new Map<string, number>();
    for (const raw of text.split('\n')) {
        const m = /^(\d+)=(\S+)$/.exec(raw.trim());
        if (m) {
            out.set(m[2], Number(m[1]));
        }
    }
    return out;
}

function loadNpcDisplayNames(): Map<string, string> {
    const files = filesUnder(join(CONTENT, 'scripts'), '.npc');
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
            }
        }
    }
    for (const [from, to] of Object.entries(NPC_ALIAS)) {
        const display = names.get(to);
        if (display !== undefined) {
            names.set(from, display);
        }
    }
    return names;
}

/** Sliding-puzzle pieces are all named "Sliding piece", so the board is read by obj id. puzzle_piece_id is the slot the piece belongs in when solved. */
function generatePieces(objIds: Map<string, number>): string {
    const pieces: [number, number][] = [];
    for (const f of filesUnder(join(CONTENT, 'scripts'), '.obj')) {
        let cur: string | null = null;
        for (const raw of readFileSync(f, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
            } else if (cur?.startsWith('trail_slidingpuzzle') && line.startsWith('param=puzzle_piece_id,')) {
                const id = objIds.get(cur);
                if (id === undefined) {
                    throw new Error(`no obj id for puzzle piece ${cur}`);
                }
                pieces.push([id, Number(line.slice('param=puzzle_piece_id,'.length))]);
            }
        }
    }
    if (pieces.length === 0) {
        throw new Error('no sliding puzzle pieces found under scripts/');
    }
    pieces.sort((a, b) => a[0] - b[0]);
    console.log(`puzzle pieces=${pieces.length}`);

    return [
        '/* eslint-disable */',
        '// GENERATED by tools/clues/gen-cluedb.ts, do not edit.',
        '// Regenerate: bun tools/clues/gen-cluedb.ts   (drift gate: --check)',
        '// docs/reference/clues-mechanics.md#puzzle-boxes',
        '',
        '// piece obj id to the board slot it belongs in when the puzzle is solved.',
        'export const PUZZLE_PIECE_SLOT: Record<number, number> = {',
        pieces.map(([id, slot]) => `    ${id}: ${slot}`).join(',\n'),
        '};',
        ''
    ].join('\n');
}

function generate(): string {
    const objIds = loadObjIds();
    const npcDisplay = loadNpcDisplayNames();
    const rs2Files = filesUnder(join(CONTENT, 'scripts'), '.rs2');
    const trailObjs = loadTrailObjs();

    const easyTalk: TalkMapping[] = rs2Files.flatMap(f => parseTalkMappings(readFileSync(f, 'utf8'), 'easy'));
    const easy = buildClueDb({
        clueNames: parseEnum(readFileSync(join(TRAIL, 'trail_easy.enum'), 'utf8')),
        objs: trailObjs,
        objIds,
        talk: easyTalk,
        npcDisplay,
        specials: { trail_clue_easy_vague003: { type: 'search', coord: decodeCoord(VAGUE003_COORD) } }
    });

    const mediumTalk: TalkMapping[] = rs2Files.flatMap(f => {
        const text = readFileSync(f, 'utf8');
        return [...parseTalkMappings(text, 'medium'), ...parseChallengeTalk(text)];
    });
    const killForKey: Record<string, { npc: string; keyObj: string; keyId: number }> = {};
    const riddleSpecials: Record<string, { type: ClueType; coord: NavPoint }> = {};
    for (const [riddle, { npc, keyObj }] of Object.entries(parseKillForKey(readFileSync(MEDIUM_SCRIPT, 'utf8')))) {
        const keyId = objIds.get(keyObj);
        if (keyId === undefined) {
            throw new Error(`no obj id for ${keyObj}`);
        }
        const coord = RIDDLE_KEY_COORDS[riddle];
        if (coord === undefined) {
            throw new Error(`no key-chest coord for ${riddle} (add to RIDDLE_KEY_COORDS)`);
        }
        killForKey[riddle] = { npc: npcDisplay.get(npc) ?? npc, keyObj, keyId };
        riddleSpecials[riddle] = { type: 'search', coord: decodeCoord(coord) };
    }
    const medium = buildClueDb({
        clueNames: parseEnum(readFileSync(join(TRAIL, 'trail_medium.enum'), 'utf8')),
        objs: trailObjs,
        objIds,
        talk: mediumTalk,
        npcDisplay,
        specials: riddleSpecials,
        killForKey,
        items: CLUE_ITEMS
    });

    const hardObjs = trailObjs;
    const hardTalk: TalkMapping[] = rs2Files.flatMap(f => parseTalkMappings(readFileSync(f, 'utf8'), 'hard'));
    const hardPuzzles: PuzzleMapping[] = rs2Files.flatMap(f => parsePuzzleTalk(readFileSync(f, 'utf8')));
    const guardians: Record<string, string> = {};
    for (const [obj, parsed] of Object.entries(hardObjs)) {
        if (parsed.guardian) {
            const display = npcDisplay.get(parsed.guardian);
            if (display === undefined) {
                throw new Error(`no display name for guardian npc ${parsed.guardian} (clue ${obj})`);
            }
            guardians[obj] = display;
        }
    }
    const hardSpecials: Record<string, { type: ClueType; coord: NavPoint }> = {};
    for (const [obj, coord] of Object.entries(HARD_SPECIAL_COORDS)) {
        hardSpecials[obj] = { type: 'search', coord: decodeCoord(coord) };
    }
    const hard = buildClueDb({
        clueNames: parseEnum(readFileSync(join(TRAIL, 'trail_hard.enum'), 'utf8')),
        objs: hardObjs,
        objIds,
        talk: hardTalk,
        npcDisplay,
        specials: hardSpecials,
        puzzles: hardPuzzles,
        guardians
    });

    const db = { ...easy.db, ...medium.db, ...hard.db };
    const caskets = { ...easy.caskets, ...medium.caskets, ...hard.caskets };

    const ids = Object.keys(db).map(Number).sort((a, b) => a - b);
    const talkCount = ids.filter(id => db[id].type === 'talk').length;
    const sextantCount = ids.filter(id => db[id].needsSextant).length;
    const keyCount = ids.filter(id => db[id].keyFrom).length;
    const guardCount = ids.filter(id => db[id].guardian).length;
    const puzzleCount = ids.filter(id => db[id].puzzle).length;
    console.log(`clues=${ids.length} talk=${talkCount} caskets=${Object.keys(caskets).length} sextant=${sextantCount} keyfor=${keyCount} guarded=${guardCount} puzzle=${puzzleCount}`);

    const clueLines = ids.map(id => `    ${id}: ${JSON.stringify(db[id])}`);
    const casketLines = Object.keys(caskets)
        .map(Number)
        .sort((a, b) => a - b)
        .map(id => `    ${id}: ${JSON.stringify(caskets[id])}`);

    return [
        '/* eslint-disable */',
        '// GENERATED by tools/clues/gen-cluedb.ts, do not edit.',
        '// Regenerate: bun tools/clues/gen-cluedb.ts   (drift gate: --check)',
        '// docs/reference/clues-database.md#the-clue-database',
        "import type { ClueRow } from '#/bot/api/ai/clues/types.js';",
        '',
        'export const CLUE_DB: Record<number, ClueRow> = {',
        clueLines.join(',\n'),
        '};',
        '',
        '// casket obj id to casket obj name; lets the solver recognise a held casket.',
        'export const CASKET_IDS: Record<number, string> = {',
        casketLines.join(',\n'),
        '};',
        ''
    ].join('\n');
}

const outputs: [string, string][] = [
    [OUT, generate()],
    [PIECES_OUT, generatePieces(loadObjIds())]
];

if (process.argv.includes('--check')) {
    for (const [path, fresh] of outputs) {
        let current = '';
        try {
            current = readFileSync(path, 'utf8');
        } catch {
            // Missing output is stale.
        }
        if (current !== fresh) {
            console.error(`STALE: ${path} does not match the content pack — run: bun tools/clues/gen-cluedb.ts`);
            process.exit(1);
        }
        console.log(`ok: ${path} matches the content pack`);
    }
} else {
    for (const [path, fresh] of outputs) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, fresh);
        console.log(`wrote ${path}`);
    }
}
