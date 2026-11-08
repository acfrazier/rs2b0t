import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { attach, detach, invalidateLocSnapshots, reader } from '#/bot/adapter/ClientAdapter.js';
import { Input } from '#/bot/input/Input.js';
import { Loc as SceneLoc } from '#/bot/api/model/Loc.js';
import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import VarBitType from '#/client/config/VarBitType.js';
import ClientNpc from '#/client/dash3d/ClientNpc.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import { placedLocId, writeLocOp } from '#/client/io/gameOutbound.js';
import Packet from '#/client/io/Packet.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { installCanvasMock } from '../io/replay/runtime.js';

const BASE_LOC = 1781;
const CHILD_LOC = 1782;
const BASE_NPC = 3;
const CHILD_NPC = 9;
const TYPECODE = (2 << 29) | (BASE_LOC << 14) | (2 << 7) | 1;

type LocDef = InstanceType<typeof LocType>;
const locs = new Map<number, LocDef>();
const origLocList = LocType.list;
const origNpcList = NpcType.list;
const origVarbits = VarBitType.list;

function loc(id: number, name: string, op: string, width = 1): LocDef {
    const result = Object.create(LocType.prototype) as LocDef;
    result.id = id;
    result.name = name;
    result.op = [op, null, null, null, null];
    result.multivarbit = -1;
    result.multivar = -1;
    result.multiloc = [];
    result.width = width;
    result.length = 1;
    result.wallwidth = 16;
    return result;
}

function npcType(id: number, name: string, op: string, vislevel: number, size: number): InstanceType<typeof NpcType> {
    const result = Object.create(NpcType.prototype) as InstanceType<typeof NpcType>;
    result.id = id;
    result.name = name;
    result.op = [op, null, null, null, null];
    result.vislevel = vislevel;
    result.size = size;
    result.multivarbit = -1;
    result.multivar = -1;
    result.multinpc = [];
    return result;
}

function sceneWorld(typecode: number) {
    return {
        wallType: () => 0,
        sceneType: (_level: number, x: number, z: number) => (x === 1 && z === 2 ? typecode : 0),
        gdType: () => 0,
        decorType: () => 0,
        getWall: () => null,
        getDecor: () => null,
        getGd: () => null,
        getScene: () => null
    };
}

function locClient(varValue: number) {
    return {
        world: sceneWorld(TYPECODE),
        localPlayer: { x: 0, z: 0, routeX: [0], routeZ: [0] },
        minusedlevel: 0,
        mapBuildBaseX: 3200,
        mapBuildBaseZ: 3200,
        var: [varValue]
    };
}

function menuArrays() {
    return {
        ingame: true,
        menuAction: new Int32Array(500),
        menuParamA: new Int32Array(500),
        menuParamB: new Int32Array(500),
        menuParamC: new Int32Array(500),
        menuNumEntries: 0
    };
}

beforeEach(() => {
    const base = loc(BASE_LOC, 'millbase', 'Search', 2);
    base.multivarbit = 0;
    base.multivar = -1;
    base.multiloc = [CHILD_LOC, -1];
    const child = loc(CHILD_LOC, 'millbase_flour', 'Take', 1);
    locs.set(BASE_LOC, base);
    locs.set(CHILD_LOC, child);
    LocType.list = (id: number) => locs.get(id)!;
    VarBitType.list = [{ basevar: 0, startbit: 1, endbit: 3 } as InstanceType<typeof VarBitType>];
    invalidateLocSnapshots();
});

afterEach(() => {
    detach();
    invalidateLocSnapshots();
    LocType.list = origLocList;
    NpcType.list = origNpcList;
    VarBitType.list = origVarbits;
});

afterAll(() => {
    LocType.list = origLocList;
    NpcType.list = origNpcList;
    VarBitType.list = origVarbits;
});

describe('locs() morph', () => {
    test('varbit form keeps the placed id and uses the child name and ops', () => {
        attach(locClient(0) as never);
        const snap = reader.locs()[0];
        expect(snap).toMatchObject({ id: BASE_LOC, typecode: TYPECODE, name: 'millbase_flour' });
        expect(snap?.ops[0]).toBe('Take');
        expect(placedLocId(snap!.typecode)).toBe(BASE_LOC);
        expect(placedLocId(snap!.typecode)).not.toBe(CHILD_LOC);
    });

    test('hidden varbit form is omitted from locs()', () => {
        attach(locClient(2) as never);
        expect(reader.locs()).toEqual([]);
    });

    test('varp form keeps the placed id when multivarbit is -1', () => {
        locs.get(BASE_LOC)!.multivarbit = -1;
        locs.get(BASE_LOC)!.multivar = 0;
        attach(locClient(0) as never);
        expect(reader.locs()[0]).toMatchObject({ id: BASE_LOC, name: 'millbase_flour' });
        attach(locClient(1) as never);
        expect(reader.locs()).toEqual([]);
    });
});

describe('npcs() morph', () => {
    function npcClient(varValue: number, multinpc: number[], via: 'varbit' | 'varp') {
        const child = npcType(CHILD_NPC, 'Guard', 'Talk-to', 21, 2);
        const base = npcType(BASE_NPC, 'Door man', 'Examine', 1, 1);
        if (via === 'varbit') {
            base.multivarbit = 0;
            base.multivar = -1;
        } else {
            base.multivarbit = -1;
            base.multivar = 1;
        }
        base.multinpc = multinpc;
        NpcType.list = (id: number) => (id === CHILD_NPC ? child : base);

        const body = new ClientNpc();
        body.type = base;
        body.x = 10 << 7;
        body.z = 12 << 7;
        body.routeX[0] = 10;
        body.routeZ[0] = 12;
        const client = {
            localPlayer: Object.assign(new ClientPlayer(), { x: 0, z: 0 }),
            minusedlevel: 0,
            mapBuildBaseX: 2800,
            mapBuildBaseZ: 9800,
            var: via === 'varbit' ? [varValue] : [0, varValue],
            npcCount: 1,
            npcIds: new Int32Array([17]),
            npc: [] as (ClientNpc | null)[]
        };
        client.npc[17] = body;
        return client;
    }

    test('varbit form keeps the base type id and takes name, ops, level, size from the child', () => {
        attach(npcClient(0, [CHILD_NPC, -1], 'varbit') as never);
        const snap = reader.npcs()[0];
        expect(snap).toMatchObject({ id: BASE_NPC, name: 'Guard', level: 21, size: 2 });
        expect(snap?.ops[0]).toBe('Talk-to');
        expect(snap?.id).not.toBe(CHILD_NPC);
        expect(snap?.networkTile).toEqual({ x: 2800 + 10 + 1, z: 9800 + 12 + 1, level: 0 });
    });

    test('hidden varbit form is omitted from npcs()', () => {
        attach(npcClient(2, [CHILD_NPC, -1], 'varbit') as never);
        expect(reader.npcs()).toEqual([]);
    });

    test('varp form follows multivar when multivarbit is -1', () => {
        attach(npcClient(0, [CHILD_NPC, -1], 'varp') as never);
        expect(reader.npcs()[0]).toMatchObject({ id: BASE_NPC, name: 'Guard', size: 2 });
        attach(npcClient(1, [CHILD_NPC, -1], 'varp') as never);
        expect(reader.npcs()).toEqual([]);
    });
});

describe('locBox morph', () => {
    function boxClient(varValue: number) {
        const lx = 5;
        const lz = 6;
        const decor = {
            typecode: TYPECODE,
            x: (lx << 7) + 64,
            z: (lz << 7) + 64,
            model: { getTempModel: () => null }
        };
        return {
            world: {
                getWall: () => null,
                getDecor: (_level: number, tz: number, tx: number) => (tx === lx && tz === lz ? decor : null),
                getGd: () => null,
                getScene: () => null
            },
            minusedlevel: 0,
            mapBuildBaseX: 3200,
            mapBuildBaseZ: 3200,
            var: [varValue],
            overlayPos: (sx: number, sz: number, _h: number) => ({ x: sx, y: sz })
        };
    }

    test('matches the resolved child name, not the base name', () => {
        attach(boxClient(0) as never);
        expect(reader.locBox({ x: 3205, z: 3206, name: 'millbase_flour' })).not.toBeNull();
        expect(reader.locBox({ x: 3205, z: 3206, name: 'millbase' })).toBeNull();
    });

    test('hidden form has no hull, including by placed id', () => {
        attach(boxClient(2) as never);
        expect(reader.locBox({ x: 3205, z: 3206, name: 'millbase_flour' })).toBeNull();
        expect(reader.locBox({ x: 3205, z: 3206, id: BASE_LOC })).toBeNull();
    });

    test('hull width comes from the base loc, not the child', () => {
        attach(boxClient(0) as never);
        const hull = reader.locBox({ x: 3205, z: 3206, id: BASE_LOC });
        expect(hull).not.toBeNull();
        const dx = Math.abs(hull![1]!.x - hull![0]!.x);
        expect(dx).toBe(256);
        expect(dx).not.toBe(128);
    });

    test('hull height and radius come from the base model, not the child', () => {
        const base = loc(BASE_LOC, 'millbase', 'Search', 1);
        base.multivarbit = -1;
        base.multivar = 0;
        base.multiloc = [CHILD_LOC];
        base.getModel = (() => ({ minY: 64, maxY: 0, radius: 64 })) as unknown as LocDef['getModel'];
        const child = loc(CHILD_LOC, 'millbase_flour', 'Take', 1);
        child.getModel = (() => ({ minY: 300, maxY: 0, radius: 180 })) as unknown as LocDef['getModel'];
        locs.set(BASE_LOC, base);
        locs.set(CHILD_LOC, child);
        const lx = 5;
        const lz = 6;
        attach({
            world: {
                getWall: () => null,
                getDecor: (_level: number, tz: number, tx: number) => {
                    if (tx !== lx || tz !== lz) {
                        return null;
                    }
                    return {
                        typecode: TYPECODE,
                        x: (lx << 7) + 64,
                        z: (lz << 7) + 64,
                        model: { getTempModel: () => ({ minY: 300, maxY: 0, radius: 180 }) }
                    };
                },
                getGd: () => null,
                getScene: () => null
            },
            minusedlevel: 0,
            mapBuildBaseX: 3200,
            mapBuildBaseZ: 3200,
            var: [0],
            overlayPos: (sx: number, _sz: number, h: number) => ({ x: sx, y: h })
        } as never);
        const hull = reader.locBox({ x: 3205, z: 3206, id: BASE_LOC });
        expect(hull).not.toBeNull();
        const width = Math.abs(hull![1]!.x - hull![0]!.x);
        const top = hull![4]!.y;
        expect(width).toBe(128);
        expect(top).toBe(64);
        expect(width).not.toBe(360);
        expect(top).not.toBe(300);
    });
});

describe('placed-id outbound across a morph', () => {
    test('Input.interactLoc still sends the placed typecode after the child form is visible', () => {
        attach(locClient(0) as never);
        const snap = reader.locs()[0];
        expect(snap?.id).toBe(BASE_LOC);
        expect(placedLocId(snap!.typecode)).toBe(BASE_LOC);

        const captured = { action: 0, a: 0, b: 0, c: 0 };
        const client = {
            ...locClient(0),
            ...menuArrays(),
            doAction(slot: number) {
                captured.action = this.menuAction[slot];
                captured.a = this.menuParamA[slot];
                captured.b = this.menuParamB[slot];
                captured.c = this.menuParamC[slot];
            }
        };
        attach(client as never);
        const local = reader.toLocal(snap!.tile.x, snap!.tile.z);
        expect(local).toEqual({ lx: 1, lz: 2 });
        expect(Input.interactLoc(local!.lx, local!.lz, snap!.typecode, 1)).toBe(true);
        expect(captured.action).toBe(MiniMenuAction.OP_LOC1);
        expect(captured.a).toBe(TYPECODE);
        expect(placedLocId(captured.a)).toBe(BASE_LOC);
        expect(placedLocId(captured.a)).not.toBe(CHILD_LOC);
        expect(captured.b).toBe(1);
        expect(captured.c).toBe(2);

        const out = new Packet(new Uint8Array(16));
        writeLocOp(out, ClientProt.OPLOC1, 1, 3201, 3202, placedLocId(captured.a));
        expect(out.data[0]).toBe(ClientProt.OPLOC1 & 0xff);
        expect(out.data[5]).toBe(BASE_LOC & 0xff);
        expect(out.data[6]).toBe(BASE_LOC >> 8);
        expect(out.data[5]).not.toBe(CHILD_LOC & 0xff);
    });

    test('Loc.interact writes the placed id through production doAction after a varp morph', async () => {
        locs.get(BASE_LOC)!.multivarbit = -1;
        locs.get(BASE_LOC)!.multivar = 0;
        const restoreCanvas = await installCanvasMock();
        // Canvas.js binds at import time, so Client cannot be a static import: the mock has to land first.
        const { Client } = await import('#/client/shell/Client.js');
        try {
            const probe = new Client(undefined as never, undefined as never, undefined as never) as unknown as {
                collision: (CollisionMap | null)[];
                mapBuildBaseX: number;
                mapBuildBaseZ: number;
                minusedlevel: number;
                keyHeld: number[];
                out: Packet;
                ingame: boolean;
                var: number[];
                localPlayer: ClientPlayer | null;
                world: unknown;
                doAction: (slot: number) => void;
            };
            probe.collision[0] = new CollisionMap();
            probe.collision[0]!.flags.fill(0);
            probe.mapBuildBaseX = 3200;
            probe.mapBuildBaseZ = 3200;
            probe.minusedlevel = 0;
            probe.keyHeld[5] = 1;
            probe.out.pos = 0;
            probe.ingame = true;
            probe.var[0] = 0;
            probe.localPlayer = new ClientPlayer();
            probe.localPlayer.routeX[0] = 0;
            probe.localPlayer.routeZ[0] = 0;
            probe.localPlayer.x = 0;
            probe.localPlayer.z = 0;
            probe.world = {
                wallType: () => 0,
                sceneType: (_level: number, x: number, z: number) => (x === 1 && z === 2 ? TYPECODE : 0),
                gdType: () => 0,
                decorType: () => 0,
                typeCode2: () => 0
            };
            expect(attach(probe)).not.toContain('doAction');
            const snap = reader.locs()[0];
            expect(snap).toMatchObject({ id: BASE_LOC, name: 'millbase_flour' });
            expect(placedLocId(snap!.typecode)).toBe(BASE_LOC);
            probe.var[0] = 1;
            invalidateLocSnapshots();
            expect(reader.locs()).toEqual([]);
            probe.out.pos = 0;
            expect(new SceneLoc(snap!).interact('Take')).toBe(true);
            const sent = Buffer.from(probe.out.data.subarray(0, probe.out.pos)).toString('hex');
            const placed = new Packet(new Uint8Array(16));
            writeLocOp(placed, ClientProt.OPLOC1, 1, 3201, 3202, BASE_LOC);
            const child = new Packet(new Uint8Array(16));
            writeLocOp(child, ClientProt.OPLOC1, 1, 3201, 3202, CHILD_LOC);
            const placedHex = Buffer.from(placed.data.subarray(0, placed.pos)).toString('hex');
            const childHex = Buffer.from(child.data.subarray(0, child.pos)).toString('hex');
            expect(sent.endsWith(placedHex)).toBe(true);
            expect(sent.includes(childHex)).toBe(false);
        } finally {
            restoreCanvas();
        }
    });
});
