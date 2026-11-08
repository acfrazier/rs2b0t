import { describe, expect, test } from 'bun:test';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { KILL_ANCHORS } from '#/bot/api/ai/clues/data/killAnchors.js';
import { PACK_UNREACHABLE } from '#/bot/api/ai/clues/data/unreachable.js';
import { auditInputsPresent, runClueAudit } from '../../../../tools/clues/audit-clues.js';

const KEY_FROM_IDS = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].keyFrom)
    .sort((a, b) => a - b);

describe('kill-for-key anchors (KILL_ANCHORS ↔ keyFrom)', () => {
    // 377: five riddles. `trail_clue_medium.rs2:29-37` keys the drops to riddle001-005 (Black Heather,
    // Guard dog, ardougne_guard, chicken, Man); the 289 riddle007/008 have no 377 clue items.
    test('exactly the 5 keyFrom riddles carry a well-formed hunt anchor, none stale', () => {
        expect(KEY_FROM_IDS).toEqual([2831, 2833, 2835, 2837, 2839]);
        for (const id of KEY_FROM_IDS) {
            expect(KILL_ANCHORS[id], `riddle ${id} missing KILL_ANCHORS entry`).toBeDefined();
        }
        expect(Object.keys(KILL_ANCHORS).map(Number).sort((a, b) => a - b)).toEqual(KEY_FROM_IDS);
        for (const id of KEY_FROM_IDS) {
            const a = KILL_ANCHORS[id];
            expect(Number.isInteger(a.x) && Number.isInteger(a.z) && Number.isInteger(a.level) && a.level >= 0 && a.level <= 3, `riddle ${id} anchor malformed: (${a.x},${a.z},${a.level})`).toBe(true);
        }
    });
});

// The audit decodes the engine of the build's revision, so presence is judged with the same engine the run passes.
const auditOpts = { engine: process.env.ENGINE_DIR };
const present = auditInputsPresent(auditOpts);

// Destinations the baked nav pack cannot route to; each carries a diagnosis in PACK_UNREACHABLE.
// Why: derived rather than re-pinned. The audit already fails on an unlisted id that cannot route and on a listed id that now can.
const EXPECTED_ABANDON = Object.keys(PACK_UNREACHABLE).map(Number).sort((a, b) => a - b);

describe.skipIf(!present)('clue audit (pack-gated)', () => {
    test('every clue variant is solvable: reachable, interact-legal, egress, loc/npc present', () => {
        // The audit decodes the engine's packed locs and maps, so it needs the engine of the build's
        // revision: the 377 engine while the tree is a 377 build (loadLocTypes fails closed on a mismatch).
        const { total, findings, expectedAbandon, clean } = runClueAudit({ engine: process.env.ENGINE_DIR });
        expect(findings.map(f => `${f.obj} [${f.id}] ${f.type}: ${f.problem}`)).toEqual([]);
        expect(expectedAbandon).toEqual(EXPECTED_ABANDON);
        // 377: the generated cluedb carries 104 clues: 101 earlier rows plus hard clues 3560/3562/3564; the 289 total was 186.
        expect(total).toBe(104);
        expect(clean).toBe(total - EXPECTED_ABANDON.length);
    }, 240_000);
});
