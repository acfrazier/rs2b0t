import { describe, expect, test } from 'bun:test';

import FloType from '#/client/config/FloType.js';
import IdkType from '#/client/config/IdkType.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import ObjType from '#/client/config/ObjType.js';
import SeqType, { RestartMode } from '#/client/config/SeqType.js';
import SpotType from '#/client/config/SpotType.js';
import VarBitType from '#/client/config/VarBitType.js';
import VarpType from '#/client/config/VarpType.js';
import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';

function fakeJag(files: Record<string, Uint8Array | null>): JagFile {
    return {
        read(name: string): Uint8Array | null {
            return files[name] ?? null;
        }
    } as JagFile;
}

function locPair(records: Uint8Array[]): { dat: Uint8Array; idx: Uint8Array } {
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

describe('377 loc opcode 77', () => {
    test('reads varbit, varp, and morph ids including 65535 sentinels', () => {
        const loc = new LocType();
        loc.id = 7;
        loc.decode(new Packet(new Uint8Array([77, 255, 255, 0, 3, 1, 255, 255, 0, 4, 0])));
        expect(loc.multivarbit).toBe(-1);
        expect(loc.multivar).toBe(3);
        expect(loc.multiloc).toEqual([-1, 4]);
    });

    test('rust loc morph vector matches Java signed fields', () => {
        const loc = new LocType();
        loc.decode(new Packet(new Uint8Array([1, 1, 255, 255, 10, 5, 1, 0, 2, 19, 2, 29, 255, 39, 128, 70, 255, 255, 71, 128, 0, 72, 127, 255, 74, 77, 255, 255, 0, 3, 1, 255, 255, 0, 4, 0])));
        // Java !lowMem would keep opcode-1 models; the bot client is lowMem and matches Client-TS overwrite.
        expect(Array.from(loc.model ?? [])).toEqual([2]);
        expect(loc.shape).toBeNull();
        expect(loc.active).toBe(false);
        expect(loc.blockwalk).toBe(false);
        expect(loc.blockrange).toBe(false);
        expect(loc.ambient).toBe(-1);
        expect(loc.contrast).toBe(-128);
        expect(loc.offsetx).toBe(-1);
        expect(loc.offsety).toBe(-32768);
        expect(loc.offsetz).toBe(32767);
        expect(loc.multivarbit).toBe(-1);
        expect(loc.multivar).toBe(3);
        expect(loc.raiseobject).toBe(0);
        expect(loc.multiloc).toEqual([-1, 4]);
    });

    test('unknown opcode throws under STRICT', () => {
        const loc = new LocType();
        loc.id = 7;
        expect(() => loc.decode(new Packet(new Uint8Array([200, 0])))).toThrow('LocType 7: unknown config opcode 200');
    });

    test('trailing bytes in the idx slice throw under STRICT', () => {
        const { dat, idx } = locPair([new Uint8Array([0, 99])]);
        LocType.init(fakeJag({ 'loc.dat': dat, 'loc.idx': idx }));
        expect(() => LocType.list(0)).toThrow('LocType 0: trailing config bytes');
    });
});

describe('377 npc opcode 106', () => {
    test('reads multinpc varbit+varp and opcode 107', () => {
        const npc = new NpcType();
        npc.decode(new Packet(new Uint8Array([12, 255, 13, 255, 255, 100, 128, 101, 255, 106, 255, 255, 0, 3, 0, 255, 255, 107, 0])));
        expect(npc.size).toBe(-1);
        expect(npc.readyanim).toBe(65535);
        expect(npc.ambient).toBe(-128);
        expect(npc.contrast).toBe(-5);
        expect(npc.multivarbit).toBe(-1);
        expect(npc.multivar).toBe(3);
        expect(npc.multinpc).toEqual([-1]);
        expect(npc.active).toBe(false);
    });

    test('unknown opcode throws under STRICT', () => {
        const npc = new NpcType();
        npc.id = 2;
        expect(() => npc.decode(new Packet(new Uint8Array([200, 0])))).toThrow('NpcType 2: unknown config opcode 200');
    });
});

describe('377 obj opcode 10', () => {
    test('stores the word instead of skipping it', () => {
        const obj = new ObjType();
        obj.decode(new Packet(new Uint8Array([10, 0, 42, 0])));
        expect(obj.unused10).toBe(42);
    });
});

describe('377 seq opcode 12', () => {
    test('empty record uses Java frame and restart defaults', () => {
        const seq = new SeqType();
        seq.decode(new Packet(new Uint8Array([0])));
        expect(seq.numFrames).toBe(1);
        expect(Array.from(seq.frames ?? [])).toEqual([-1]);
        expect(seq.duplicatebehaviour).toBe(RestartMode.RESETLOOP);
        expect(seq.unused12).toBe(0);
    });

    test('stores opcode 12 as g4', () => {
        const seq = new SeqType();
        seq.decode(new Packet(new Uint8Array([12, 128, 0, 0, 1, 0])));
        expect(seq.unused12).toBe(-2147483647);
    });
});

describe('377 varp and varbit', () => {
    test('varp opcodes 8/11/13 set scope', () => {
        VarpType.codeCount = 0;
        VarpType.codeIds = new Int32Array(8);
        const varp = new VarpType();
        varp.decode(7, new Packet(new Uint8Array([1, 255, 2, 128, 3, 3, 4, 5, 255, 255, 6, 7, 128, 0, 0, 0, 8, 10, 120, 10, 11, 12, 255, 255, 255, 254, 13, 14, 0])));
        expect(varp.type).toBe(255);
        expect(varp.type2).toBe(128);
        expect(varp.transmit).toBe(true);
        expect(varp.keepBit).toBe(false);
        expect(varp.clientcode).toBe(65535);
        expect(varp.protect).toBe(true);
        expect(varp.unused7).toBe(-2147483648);
        expect(varp.debugname).toBe('x');
        expect(varp.scope).toBe(true);
        expect(varp.scopeType).toBe(2);
        expect(varp.unused12).toBe(-2);
        expect(varp.unused14).toBe(false);
        expect(VarpType.codeIds?.[0]).toBe(7);
        expect(VarpType.codeCount).toBe(2);
    });

    test('varbit opcodes 2-5 store transmit and payload', () => {
        const bit = new VarBitType();
        bit.decode(new Packet(new Uint8Array([1, 255, 255, 128, 255, 2, 3, 128, 0, 0, 0, 4, 255, 255, 255, 255, 5, 10, 121, 10, 0])));
        expect(bit.basevar).toBe(65535);
        expect(bit.startbit).toBe(128);
        expect(bit.endbit).toBe(255);
        expect(bit.unused2).toBe(true);
        expect(bit.unused3).toBe(-2147483648);
        expect(bit.unused4).toBe(-1);
        expect(bit.unused5).toBe(false);
        expect(bit.debugname).toBe('y');
    });

    test('eager trailing bytes throw under STRICT', () => {
        expect(() => VarpType.init(fakeJag({ 'varp.dat': new Uint8Array([0, 1, 0, 99]) }))).toThrow('VarpType: trailing config bytes');
        expect(() => VarBitType.init(fakeJag({ 'varbit.dat': new Uint8Array([0, 1, 0, 99]) }))).toThrow('VarBitType: trailing config bytes');
    });
});

describe('377 flo opcode 7', () => {
    test('magenta sentinel yields black HSL', () => {
        const flo = new FloType();
        flo.decode(new Packet(new Uint8Array([1, 255, 0, 255, 0])));
        expect(flo.colour).toBe(0xff00ff);
        expect(flo.hue).toBe(0);
        expect(flo.saturation).toBe(0);
        expect(flo.lightness).toBe(0);
        expect(flo.chroma).toBe(1);
    });

    test('opcode 7 restores hue after overlay recompute', () => {
        const flo = new FloType();
        flo.decode(new Packet(new Uint8Array([1, 255, 0, 0, 2, 255, 3, 5, 6, 122, 10, 7, 0, 0, 255, 0])));
        expect(flo.texture).toBe(255);
        expect(flo.overlay).toBe(true);
        expect(flo.occlude).toBe(false);
        expect(flo.debugname).toBe('z');
        expect(flo.hue).toBe(0);
        expect(flo.lightness).toBe(127);
    });
});

describe('377 idk and spot STRICT', () => {
    test('unknown opcodes throw', () => {
        expect(() => new IdkType().decode(new Packet(new Uint8Array([200, 0])))).toThrow('IdkType: unknown config opcode 200');
        const spot = new SpotType();
        spot.id = 4;
        expect(() => spot.decode(new Packet(new Uint8Array([200, 0])))).toThrow('SpotType 4: unknown config opcode 200');
    });
});

describe('377 IfType type 8', () => {
    function interfaceJag(body: Uint8Array): JagFile {
        return fakeJag({ data: body });
    }

    test('reads type-8 static text without unloadCom', () => {
        const data = new Packet(new Uint8Array(64));
        data.p2(1);
        data.p2(0);
        data.p1(ComponentType.TYPE_TEXT_STATIC);
        data.p1(0);
        data.p2(0);
        data.p2(1);
        data.p2(1);
        data.p1(0);
        data.p1(0);
        data.p1(0);
        data.p1(0);
        data.pjstr('Tip');
        IfType.init(interfaceJag(data.data.subarray(0, data.pos)), null, []);
        expect(IfType.list[0].text).toBe('Tip');
        expect(IfType.list[0]).toBeInstanceOf(IfType);
        expect('unloadCom' in IfType).toBe(false);
    });
});
