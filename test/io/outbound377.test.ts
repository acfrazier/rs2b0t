import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import { actions, attach, detach } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import Packet from '#/client/io/Packet.js';
import { OUTBOUND_CENSUS } from '#/client/io/gameOutbound.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { installCanvasMock } from './replay/runtime.js';

const fixture = JSON.parse(readFileSync('test/io/fixtures/prot377/engine-prot.json', 'utf8')) as {
    client: { name: string; id: number; length: number }[];
};

interface Probe {
    tryMove(srcX: number, srcZ: number, dx: number, dz: number, tryNearest: boolean, locWidth: number, locLength: number, locAngle: number, locShape: number, forceapproach: number, type: number): boolean;
    doAction(optionId: number): void;
    out: Packet;
    collision: (CollisionMap | null)[];
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    keyHeld: number[];
    menuAction: Int32Array;
    menuParamA: Int32Array;
    menuParamB: Int32Array;
    menuParamC: Int32Array;
}

async function client(): Promise<{ probe: Probe; restore: () => void }> {
    const restore = await installCanvasMock();
    // Canvas.js is bound at import time; the mock has to land before Client loads.
    const { Client } = await import('#/client/shell/Client.js');
    const created = new Client(undefined as never, undefined as never, undefined as never) as unknown as Probe;
    created.collision[0] = new CollisionMap();
    created.mapBuildBaseX = 3200;
    created.mapBuildBaseZ = 3200;
    created.keyHeld[5] = 1;
    created.out.pos = 0;
    return { probe: created, restore };
}

function sent(out: Packet): number[] {
    return [...out.data.subarray(0, out.pos)];
}

function frames(): { name: string; raw: number[] }[] {
    const byId = new Map(fixture.client.map(row => [row.id, row.name]));
    const rows: { name: string; raw: number[] }[] = [];
    for (const file of ['tutorial', 'instance', 'mainland']) {
        for (const line of readFileSync(`test/io/recordings/377/${file}.jsonl`, 'utf8').split('\n')) {
            if (!line) continue;
            const record = JSON.parse(line) as { type?: string; direction?: string; bytes?: string };
            if (record.type !== 'frame' || record.direction !== 'out' || !record.bytes) continue;
            const raw = [...Buffer.from(record.bytes, 'hex')];
            rows.push({ name: byId.get(raw[0]) ?? `UNK_${raw[0]}`, raw });
        }
    }
    return rows;
}

describe('377 outbound census', () => {
    test('accounts for every engine client descriptor', () => {
        expect(OUTBOUND_CENSUS).toHaveLength(80);
        expect(fixture.client).toHaveLength(80);
        const byName = new Map(fixture.client.map(row => [row.name, row]));
        for (const row of OUTBOUND_CENSUS) {
            expect(byName.get(row.name)).toEqual({ name: row.name, id: row.id, length: row.length });
        }
    });

    test('does not send the dropped 289 anticheat opcodes', () => {
        const source = readFileSync('src/client/shell/Client.ts', 'utf8');
        for (const name of ['ANTICHEAT_OPLOGIC6', 'ANTICHEAT_OPLOGIC7', 'ANTICHEAT_OPLOGIC8', 'ANTICHEAT_OPLOGIC9', 'ANTICHEAT_CYCLELOGIC7']) {
            expect(source.includes(`ClientProt.${name}`)).toBe(false);
        }
    });
});

describe('production tryMove', () => {
    test('writes p2_alt3 x, ctrl, p2_alt3 z', async () => {
        const { probe, restore } = await client();
        try {
            expect(probe.tryMove(10, 10, 12, 10, false, 0, 0, 0, 0, 0, 0)).toBe(true);
            const raw = sent(probe.out);
            const body = new Packet(Uint8Array.from(raw.slice(2)));
            expect(body.g2_alt3()).toBe(3212);
            expect(body.g1()).toBe(1);
            expect(body.g2_alt3()).toBe(3210);
            expect(raw[2]).toBe((3212 + 128) & 0xff);
            expect(raw[3]).toBe(3212 >> 8);
            expect(raw[5]).toBe((3210 + 128) & 0xff);
        } finally {
            restore();
        }
    });
});

describe('production menu writers', () => {
    test('OPLOC1 carries the placed id and matches a recorded payload', async () => {
        const recorded = frames().find(frame => frame.name === 'OPLOC1');
        expect(recorded).toBeDefined();
        const recordedBody = new Packet(Uint8Array.from(recorded!.raw.slice(1)));
        const worldX = recordedBody.g2_alt2();
        const worldZ = recordedBody.g2_alt1();
        const placed = recordedBody.g2_alt1();
        const resolved = placed === 1781 ? 1782 : placed + 1;

        const { probe, restore } = await client();
        try {
            probe.mapBuildBaseX = 0;
            probe.mapBuildBaseZ = 0;
            probe.menuAction[0] = MiniMenuAction.OP_LOC1;
            probe.menuParamA[0] = (placed << 14) | 0x11;
            probe.menuParamB[0] = worldX;
            probe.menuParamC[0] = worldZ;
            probe.doAction(0);

            const payload = sent(probe.out).slice(1);
            expect(payload).toEqual(recorded!.raw.slice(1));
            const written = new Packet(Uint8Array.from(payload));
            written.g2_alt2();
            written.g2_alt1();
            const loc = written.g2_alt1();
            expect(loc).toBe(placed);
            expect(loc).not.toBe(resolved);
        } finally {
            restore();
        }
    });

    test('OPHELD1 and INV_BUTTON5 go through doAction', async () => {
        const { probe, restore } = await client();
        try {
            const com = new IfType();
            com.layerId = -1;
            const previous = IfType.list;
            IfType.list = [];
            IfType.list[5382] = com;

            (probe.constructor as { oplogic5: number }).oplogic5 = 0;
            probe.menuAction[0] = MiniMenuAction.OP_HELD1;
            probe.menuParamA[0] = 10;
            probe.menuParamB[0] = 3;
            probe.menuParamC[0] = 5382;
            probe.doAction(0);
            let body = new Packet(Uint8Array.from(sent(probe.out).slice(1)));
            expect([body.g2_alt2(), body.g2_alt1(), body.g2_alt1()]).toEqual([5382, 3, 10]);

            probe.out.pos = 0;
            probe.menuAction[0] = MiniMenuAction.INV_BUTTON5;
            probe.menuParamA[0] = 931;
            probe.menuParamB[0] = 1;
            probe.menuParamC[0] = 5382;
            probe.doAction(0);
            body = new Packet(Uint8Array.from(sent(probe.out).slice(1)));
            expect([body.g2_alt3(), body.g2_alt3(), body.g2_alt1()]).toEqual([1, 931, 5382]);
            IfType.list = previous;
        } finally {
            restore();
        }
    });
});

describe('adapter direct writers', () => {
    test('dragInvSlot matches a recorded non-adjacent drag payload', () => {
        const recorded = frames().find(frame => frame.name === 'INV_BUTTOND');
        expect(recorded).toBeDefined();
        const body = new Packet(Uint8Array.from(recorded!.raw.slice(1)));
        const to = body.g2_alt3();
        const mode = body.g1_alt1();
        const comId = body.g2_alt2();
        const from = body.g2_alt1();

        const com = new IfType();
        com.id = comId;
        com.type = ComponentType.TYPE_INV;
        com.linkObjType = new Int32Array(Math.max(from, to) + 1);
        com.linkObjNumber = new Int32Array(com.linkObjType.length);
        com.linkObjType[from] = 11;
        const previous = IfType.list;
        IfType.list = [];
        IfType.list[comId] = com;
        const raw = { out: new Packet(new Uint8Array(64)), statSessionGeneration: 0 };
        attach(raw as never);
        expect(actions.dragInvSlot(comId, from, to, mode as 0 | 1)).toBe(true);
        expect(sent(raw.out).slice(1)).toEqual(recorded!.raw.slice(1));
        IfType.list = previous;
        detach();
    });

    test('answerCountDialog matches the recorded count packet payload', () => {
        const recorded = frames().find(frame => frame.name === 'RESUME_P_COUNTDIALOG');
        expect(recorded).toBeDefined();
        const value = new Packet(Uint8Array.from(recorded!.raw.slice(1))).g4();
        const raw = { out: new Packet(new Uint8Array(16)), ingame: true, dialogInputOpen: true, statSessionGeneration: 0 };
        attach(raw as never);
        expect(actions.answerCountDialog(value)).toBe(true);
        expect(sent(raw.out).slice(1)).toEqual(recorded!.raw.slice(1));
        detach();
    });

    test('sayPublic uses Java effect bytes, which the Client-TS recording does not', () => {
        const recorded = frames().find(frame => frame.name === 'MESSAGE_PUBLIC');
        expect(recorded).toBeDefined();
        expect(recorded!.raw[3]).toBe(0);
        const raw = {
            out: new Packet(new Uint8Array(64)),
            localPlayer: { name: 'Elliott', chatMessage: '', chatColour: 0, chatEffect: 0, chatTimer: 0 },
            addChat() {},
            statSessionGeneration: 0
        };
        attach(raw as never);
        expect(actions.sayPublic('hello')).toBe(true);
        expect(sent(raw.out)[3]).toBe(128);
        detach();
    });
});

describe('recorded move clicks use the same transform as tryMove', () => {
    test('every recorded move payload is p2_alt3 x, ctrl, p2_alt3 z', () => {
        const moves = frames().filter(frame => frame.name === 'MOVE_GAMECLICK' || frame.name === 'MOVE_OPCLICK');
        expect(moves.length).toBeGreaterThan(0);
        for (const frame of moves) {
            const body = new Packet(Uint8Array.from(frame.raw.slice(2)));
            const x = body.g2_alt3();
            expect(frame.raw[2]).toBe((x + 128) & 0xff);
            expect(frame.raw[3]).toBe(x >> 8);
        }
    });
});
