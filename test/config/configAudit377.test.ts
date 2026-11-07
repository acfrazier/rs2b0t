import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';

import { skipUnless } from '../lib/skipUnless.js';

/** P3 loc census on client loc.dat: named counts opcode 2 present (name !== null), including empty strings. */
const P3_LOC = {
    definitions: 14975,
    named: 8985,
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

function packJag(files: Record<string, Uint8Array>): Uint8Array {
    const entries = Object.entries(files);
    const table = 2 + entries.length * 10;
    let payload = 0;
    for (const [, data] of entries) {
        payload += data.length;
    }
    const inner = new Uint8Array(table + payload);
    const p = new Packet(inner);
    p.p2(entries.length);
    for (const [name, data] of entries) {
        p.p4(JagFile.genHash(name));
        p.p3(data.length);
        p.p3(data.length);
    }
    for (const [, data] of entries) {
        inner.set(data, p.pos);
        p.pos += data.length;
    }
    const bz = Bun.spawnSync(['bzip2', '-c'], { stdin: inner, stdout: 'pipe', stderr: 'pipe' });
    if (bz.exitCode !== 0) {
        throw new Error(bz.stderr.toString() || 'bzip2 failed');
    }
    const packed = bz.stdout.subarray(4);
    const out = new Uint8Array(6 + packed.length);
    const header = new Packet(out);
    header.p3(inner.length);
    header.p3(packed.length);
    out.set(packed, 6);
    return out;
}

function emptyCount(): Uint8Array {
    return new Uint8Array([0, 0]);
}

function idxDat(records: Uint8Array[]): { dat: Uint8Array; idx: Uint8Array } {
    let total = 2;
    for (const record of records) {
        total += record.length;
    }
    const dat = new Uint8Array(total);
    const idx = new Packet(new Uint8Array(2 + records.length * 2));
    idx.p2(records.length);
    let offset = 2;
    for (const record of records) {
        dat.set(record, offset);
        idx.p2(record.length);
        offset += record.length;
    }
    return { dat, idx: idx.data };
}

describe.skipIf(skipUnless('engine'))('377 config-audit against ENGINE_DIR data/pack/client', () => {
    test('prints CONFIG AUDIT CLEAN with P3 loc counts including named=8985', () => {
        const cache = join(process.env.ENGINE_DIR!, 'data/pack/client');
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

describe('377 config-audit fail-closed', () => {
    test('an injected unknown opcode fails the audit', () => {
        const loc = idxDat([new Uint8Array([200, 0])]);
        const empty = idxDat([]);
        const config = packJag({
            'loc.dat': loc.dat,
            'loc.idx': loc.idx,
            'npc.dat': empty.dat,
            'npc.idx': empty.idx,
            'obj.dat': empty.dat,
            'obj.idx': empty.idx,
            'seq.dat': emptyCount(),
            'flo.dat': emptyCount(),
            'idk.dat': emptyCount(),
            'spotanim.dat': emptyCount(),
            'varp.dat': emptyCount(),
            'varbit.dat': emptyCount()
        });
        const interfaces = packJag({ data: emptyCount() });
        const media = packJag({});
        const dir = mkdtempSync(join(tmpdir(), 'sce-audit-'));
        try {
            writeFileSync(join(dir, 'config'), config);
            writeFileSync(join(dir, 'interface'), interfaces);
            writeFileSync(join(dir, 'media'), media);
            const result = Bun.spawnSync(['bun', 'tools/config-audit.ts', '--cache', dir], {
                cwd: process.cwd(),
                stdout: 'pipe',
                stderr: 'pipe'
            });
            const out = result.stdout.toString() + result.stderr.toString();
            expect(result.exitCode, out).not.toBe(0);
            expect(out).toContain('CONFIG AUDIT FAILED');
            expect(out).toMatch(/unknown config opcode 200/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
