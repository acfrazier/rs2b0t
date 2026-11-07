import { describe, expect, test } from 'bun:test';

import { skipUnless } from '../lib/skipUnless.js';

/** P3 loc census (client config jag). named is 8983 on the client table; P3's 8985 counted the nav/server snapshot. */
const P3_LOC = {
    definitions: 14975,
    named: 8983,
    modeled: 14426,
    shaped: 5423,
    active: 9400,
    width: 2424,
    length: 2330,
    blockwalk: 13828,
    blockrange: 12518,
    ops: 5512,
    multilocs: 549
};

/** 274bot Java fixture family sizes, except varp/varbit which follow this pack's content. */
const RUST_FAMILY = {
    npc: 3852,
    obj: 7956,
    seq: 3997,
    spot: 666,
    varbit: 2138,
    varp: 765,
    idk: 84,
    flo: 174,
    ifSlots: 19269,
    ifPopulated: 19131
};

describe.skipIf(skipUnless('cache-bundle'))('377 config-audit against the recording cache', () => {
    test('prints CONFIG AUDIT CLEAN with P3 loc counts and 274bot family counts', () => {
        const cache = process.env.RS2B0T_CACHE_BUNDLE!;
        const result = Bun.spawnSync(['bun', 'tools/config-audit.ts', '--cache', cache], {
            cwd: process.cwd(),
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const out = result.stdout.toString() + result.stderr.toString();
        expect(result.exitCode, out).toBe(0);
        expect(out).toContain('CONFIG AUDIT CLEAN');
        expect(out).toContain(
            `loc: ${P3_LOC.definitions} decoded (named=${P3_LOC.named} modeled=${P3_LOC.modeled} shaped=${P3_LOC.shaped} active=${P3_LOC.active} width=${P3_LOC.width} length=${P3_LOC.length} blockwalk=${P3_LOC.blockwalk} blockrange=${P3_LOC.blockrange} ops=${P3_LOC.ops} multilocs=${P3_LOC.multilocs})`
        );
        expect(out).toContain(`npc: ${RUST_FAMILY.npc} decoded`);
        expect(out).toContain(`obj: ${RUST_FAMILY.obj} decoded`);
        expect(out).toContain(`seq: ${RUST_FAMILY.seq} decoded eagerly in init`);
        expect(out).toContain(`spot: ${RUST_FAMILY.spot} decoded eagerly in init`);
        expect(out).toContain(`varbit: ${RUST_FAMILY.varbit} decoded eagerly in init`);
        expect(out).toContain(`varp: ${RUST_FAMILY.varp} decoded eagerly in init`);
        expect(out).toContain(`idk: ${RUST_FAMILY.idk} decoded eagerly in init`);
        expect(out).toContain(`flo: ${RUST_FAMILY.flo} decoded eagerly in init`);
        expect(out).toContain(`if: ${RUST_FAMILY.ifSlots} slots, ${RUST_FAMILY.ifPopulated} populated`);
    });
});
