import { afterEach, describe, expect, test } from 'bun:test';

import { attach, detach, invalidateLocSnapshots, reader } from '#/bot/adapter/ClientAdapter.js';
import { GroundItem } from '#/bot/api/model/GroundItem.js';
import { Loc } from '#/bot/api/model/Loc.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { Input } from '#/bot/input/Input.js';
import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import ClientNpc from '#/client/dash3d/ClientNpc.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import WorldRegion from '#/client/dash3d/WorldRegion.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import { writeLocOp, writeObjOp } from '#/client/io/gameOutbound.js';
import Packet from '#/client/io/Packet.js';
import { Int32Array3d } from '#/client/util/Arrays.js';
import { installCanvasMock } from '../io/replay/runtime.js';

const origLocList = LocType.list;

afterEach(() => {
    detach();
    invalidateLocSnapshots();
    LocType.list = origLocList;
});

function emptyRegion(): Int32Array[][] {
    const region = new Int32Array3d(4, 13, 13);
    for (let level = 0; level < 4; level++) {
        for (let x = 0; x < 13; x++) {
            region[level]![x]!.fill(-1);
        }
    }
    return region;
}

function packTemplate(srcLevel: number, srcZoneX: number, srcZoneZ: number, rotation: number): number {
    return ((srcLevel & 0x3) << 24) | ((srcZoneX & 0x3ff) << 14) | ((srcZoneZ & 0x7ff) << 3) | ((rotation & 0x3) << 1);
}

describe('instanced coordinate contract', () => {
    test('observations and Input.walk use mapBuildBase, not template coordinates', () => {
        const baseX = 6632;
        const baseZ = 48;
        const lx = 48;
        const lz = 52;
        const walked: number[] = [];
        const type = new NpcType();
        type.id = 42;
        type.name = 'Monk';
        type.size = 1;
        type.op = ['Talk-to', null, null, null, null];
        const npc = new ClientNpc();
        npc.type = type;
        npc.x = 10 << 7;
        npc.z = 11 << 7;
        npc.routeX[0] = 10;
        npc.routeZ[0] = 11;
        LocType.list = ((id: number) => ({ name: `loc${id}`, op: ['Open'], multiloc: [] })) as unknown as typeof LocType.list;
        const world = {
            wallType: () => 0,
            sceneType: (_level: number, x: number, z: number) => (x === 10 && z === 11 ? (7 << 14) | 1 : 0),
            gdType: () => 0,
            decorType: () => 0
        };
        const player = Object.assign(new ClientPlayer(), { x: lx << 7, z: lz << 7 });
        player.routeX[0] = lx;
        player.routeZ[0] = lz;
        attach({
            ingame: true,
            sceneInstanced: true,
            sceneMapRegion: emptyRegion(),
            world,
            localPlayer: player,
            minusedlevel: 0,
            mapBuildBaseX: baseX,
            mapBuildBaseZ: baseZ,
            var: [],
            npcCount: 1,
            npcIds: new Int32Array([1]),
            npc: Object.assign([] as (ClientNpc | null)[], { 1: npc }),
            tryMove: (_sx: number, _sz: number, dx: number, dz: number) => {
                walked.splice(0, walked.length, dx, dz);
                return true;
            }
        } as never);

        expect(reader.sceneInstanced()).toBe(true);
        expect(reader.mapBuildBase()).toEqual({ x: baseX, z: baseZ });
        expect(reader.worldTile()).toEqual({ x: baseX + lx, z: baseZ + lz, level: 0 });
        expect(reader.serverTile()).toEqual({ x: 6680, z: 100, level: 0 });
        expect(reader.toLocal(6680, 100)).toEqual({ lx, lz });
        expect(reader.toWorld(lx, lz)).toEqual({ x: 6680, z: 100, level: 0 });
        expect(reader.locs()[0]?.tile).toEqual({ x: baseX + 10, z: baseZ + 11, level: 0 });
        expect(reader.npcs()[0]?.tile).toEqual({ x: baseX + 10, z: baseZ + 11, level: 0 });
        expect(Input.walk(lx, lz)).toBe(true);
        expect(walked).toEqual([lx, lz]);
        expect(reader.templateSource(lx, lz)).toBeNull();
    });
});

describe('templateSource', () => {
    test('rotated template round-trips through WorldRegion.localX/localZ', () => {
        const region = emptyRegion();
        const srcLevel = 2;
        const srcZoneX = 400;
        const srcZoneZ = 401;
        const rotation = 1;
        region[0]![6]![6] = packTemplate(srcLevel, srcZoneX, srcZoneZ, rotation);
        attach({
            sceneInstanced: true,
            sceneMapRegion: region,
            minusedlevel: 0,
            mapBuildBaseX: 6632,
            mapBuildBaseZ: 48
        } as never);

        const destX = 6 * 8 + 1;
        const destZ = 6 * 8 + 2;
        const src = reader.templateSource(destX, destZ, 0);
        expect(src).toMatchObject({ srcLevel, rotation, srcZoneX, srcZoneZ, mapSquare: ((400 / 8) << 8) + ((401 / 8) | 0) });
        expect(WorldRegion.localX(rotation, src!.srcLx, src!.srcLz)).toBe(1);
        expect(WorldRegion.localZ(src!.srcLz, src!.srcLx, rotation)).toBe(2);

        const packed = packTemplate(srcLevel, srcZoneX, srcZoneZ, rotation);
        expect((packed >> 24) & 0x3).toBe(srcLevel);
        expect((packed >> 1) & 0x3).toBe(rotation);
        expect((packed >> 14) & 0x3ff).toBe(srcZoneX);
        expect((packed >> 3) & 0x7ff).toBe(srcZoneZ);
    });

    test('duplicated chunks share the source cache chunk', () => {
        const region = emptyRegion();
        const packed = packTemplate(0, 50, 51, 0);
        region[0]![2]![3] = packed;
        region[0]![4]![5] = packed;
        attach({
            sceneInstanced: true,
            sceneMapRegion: region,
            minusedlevel: 0,
            mapBuildBaseX: 6632,
            mapBuildBaseZ: 48
        } as never);

        const a = reader.templateSource(2 * 8 + 1, 3 * 8 + 2);
        const b = reader.templateSource(4 * 8 + 1, 5 * 8 + 2);
        expect(a).toMatchObject({ srcZoneX: 50, srcZoneZ: 51, srcLx: 1, srcLz: 2, mapSquare: a!.mapSquare });
        expect(b).toMatchObject({ srcZoneX: 50, srcZoneZ: 51, srcLx: 1, srcLz: 2, mapSquare: a!.mapSquare });
    });

    test('each level has its own template', () => {
        const region = emptyRegion();
        region[0]![3]![4] = packTemplate(0, 10, 11, 0);
        region[1]![3]![4] = packTemplate(2, 20, 21, 3);
        attach({
            sceneInstanced: true,
            sceneMapRegion: region,
            minusedlevel: 0,
            mapBuildBaseX: 6632,
            mapBuildBaseZ: 48
        } as never);

        expect(reader.templateSource(3 * 8, 4 * 8, 0)).toMatchObject({ srcLevel: 0, srcZoneX: 10, srcZoneZ: 11, rotation: 0 });
        expect(reader.templateSource(3 * 8, 4 * 8, 1)).toMatchObject({ srcLevel: 2, srcZoneX: 20, srcZoneZ: 21, rotation: 3 });
    });

    test('returns null outside an instance, off-scene, or for an empty slot', () => {
        const region = emptyRegion();
        region[0]![0]![0] = packTemplate(0, 1, 2, 0);
        attach({
            sceneInstanced: false,
            sceneMapRegion: region,
            minusedlevel: 0,
            mapBuildBaseX: 2944,
            mapBuildBaseZ: 3320
        } as never);
        expect(reader.sceneInstanced()).toBe(false);
        expect(reader.templateSource(1, 1)).toBeNull();

        attach({
            sceneInstanced: true,
            sceneMapRegion: region,
            minusedlevel: 0,
            mapBuildBaseX: 6632,
            mapBuildBaseZ: 48
        } as never);
        expect(reader.templateSource(-1, 0)).toBeNull();
        expect(reader.templateSource(1, 8)).toBeNull();
        expect(reader.templateSource(0, 0)).not.toBeNull();
    });
});

type NavProbe = {
    state: string;
    worker: { postMessage: (message: { id: number }) => void } | null;
    failReason: string;
    onMessage: (message: { type: string; id: number; ok: boolean; reason: string; expanded: number }) => void;
};

describe('webwalk suspended in an instance', () => {
    test('Navigator.findPath submits no worker request while sceneInstanced is true', async () => {
        const nav = Navigator as unknown as NavProbe;
        const previous = { state: nav.state, worker: nav.worker, failReason: nav.failReason };
        let sent = 0;
        try {
            attach({
                sceneInstanced: true,
                sceneMapRegion: emptyRegion(),
                mapBuildBaseX: 6632,
                mapBuildBaseZ: 48,
                minusedlevel: 0
            } as never);
            nav.state = 'ready';
            nav.worker = {
                postMessage(message) {
                    sent++;
                    queueMicrotask(() => nav.onMessage({ type: 'path', id: message.id, ok: false, reason: 'intercepted', expanded: 0 }));
                }
            };
            const result = await Navigator.findPath({ x: 6680, z: 100, level: 0 }, { x: 6681, z: 100, level: 0 }, { state: {} as never });
            expect(sent).toBe(0);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('webwalk suspended in instanced scene');
            }
        } finally {
            nav.state = previous.state;
            nav.worker = previous.worker;
            nav.failReason = previous.failReason;
        }
    });

    test('Navigator.findPath still submits when the scene is not instanced', async () => {
        const nav = Navigator as unknown as NavProbe;
        const previous = { state: nav.state, worker: nav.worker, failReason: nav.failReason };
        let sent = 0;
        try {
            attach({
                sceneInstanced: false,
                sceneMapRegion: emptyRegion(),
                mapBuildBaseX: 2944,
                mapBuildBaseZ: 3320,
                minusedlevel: 0
            } as never);
            nav.state = 'ready';
            nav.worker = {
                postMessage(message) {
                    sent++;
                    queueMicrotask(() => nav.onMessage({ type: 'path', id: message.id, ok: false, reason: 'intercepted', expanded: 0 }));
                }
            };
            const result = await Navigator.findPath({ x: 3220, z: 3220, level: 0 }, { x: 3221, z: 3220, level: 0 }, { state: {} as never });
            expect(sent).toBe(1);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('intercepted');
            }
        } finally {
            nav.state = previous.state;
            nav.worker = previous.worker;
            nav.failReason = previous.failReason;
        }
    });
});

describe('instance world-local-outbound round trip', () => {
    const BASE_X = 6632;
    const BASE_Z = 48;
    const LOC_TYPECODE = (2 << 29) | (7 << 14) | 1;
    const OBJ_ID = 995;

    test('Loc.interact, GroundItem.interact and Input.walk use production writers with mapBuildBase', async () => {
        const region = emptyRegion();
        region[0]![1]![1] = packTemplate(2, 400, 401, 1);
        LocType.list = ((id: number) => ({ name: `loc${id}`, op: ['Open'], multiloc: [] })) as unknown as typeof LocType.list;
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
                sceneInstanced: boolean;
                sceneMapRegion: Int32Array[][];
                var: number[];
                localPlayer: ClientPlayer | null;
                world: unknown;
            };
            probe.collision[0] = new CollisionMap();
            probe.collision[0]!.flags.fill(0);
            probe.mapBuildBaseX = BASE_X;
            probe.mapBuildBaseZ = BASE_Z;
            probe.minusedlevel = 0;
            probe.keyHeld[5] = 1;
            probe.out.pos = 0;
            probe.ingame = true;
            probe.sceneInstanced = true;
            probe.sceneMapRegion = region;
            probe.localPlayer = new ClientPlayer();
            probe.localPlayer.routeX[0] = 48;
            probe.localPlayer.routeZ[0] = 52;
            probe.localPlayer.x = 48 << 7;
            probe.localPlayer.z = 52 << 7;
            probe.world = {
                wallType: () => 0,
                sceneType: (_level: number, x: number, z: number) => (x === 10 && z === 11 ? LOC_TYPECODE : 0),
                gdType: () => 0,
                decorType: () => 0,
                typeCode2: () => 0
            };
            expect(attach(probe)).not.toContain('tryMove');
            expect(reader.sceneInstanced()).toBe(true);
            expect(reader.templateSource(10, 11, 0)).toMatchObject({ srcZoneX: 400, srcZoneZ: 401, rotation: 1 });
            expect(reader.toLocal(BASE_X + 10, BASE_Z + 11)).toEqual({ lx: 10, lz: 11 });

            const locSnap = reader.locs()[0];
            expect(locSnap?.tile).toEqual({ x: BASE_X + 10, z: BASE_Z + 11, level: 0 });
            probe.out.pos = 0;
            expect(new Loc(locSnap!).interact('Open')).toBe(true);
            const locSent = Buffer.from(probe.out.data.subarray(0, probe.out.pos)).toString('hex');
            const locExpected = new Packet(new Uint8Array(16));
            writeLocOp(locExpected, ClientProt.OPLOC1, 1, BASE_X + 10, BASE_Z + 11, 7);
            expect(locSent.endsWith(Buffer.from(locExpected.data.subarray(0, locExpected.pos)).toString('hex'))).toBe(true);

            probe.out.pos = 0;
            expect(
                new GroundItem({
                    id: OBJ_ID,
                    name: 'Coins',
                    count: 1,
                    ops: ['Take', null, null, null, null],
                    tile: { x: BASE_X + 12, z: BASE_Z + 13, level: 0 },
                    distance: 1
                }).interact('Take')
            ).toBe(true);
            const objSent = Buffer.from(probe.out.data.subarray(0, probe.out.pos)).toString('hex');
            const objExpected = new Packet(new Uint8Array(16));
            writeObjOp(objExpected, ClientProt.OPOBJ1, 1, BASE_X + 12, BASE_Z + 13, OBJ_ID);
            expect(objSent.endsWith(Buffer.from(objExpected.data.subarray(0, objExpected.pos)).toString('hex'))).toBe(true);

            probe.out.pos = 0;
            expect(Input.walk(49, 52)).toBe(true);
            const walk = new Packet(probe.out.data.subarray(0, probe.out.pos));
            expect(walk.g1()).toBe(ClientProt.MOVE_GAMECLICK & 0xff);
            walk.g1();
            const x = walk.g2_alt3();
            walk.g1();
            const z = walk.g2_alt3();
            expect(x).toBe(BASE_X + 49);
            expect(z).toBe(BASE_Z + 52);
            expect(x).not.toBe(49);
            expect(z).not.toBe(52);
        } finally {
            restoreCanvas();
        }
    });
});
