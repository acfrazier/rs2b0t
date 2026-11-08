import { afterEach, describe, expect, test } from 'bun:test';

import { attach, detach, invalidateLocSnapshots, reader } from '#/bot/adapter/ClientAdapter.js';
import { Input } from '#/bot/input/Input.js';
import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import ClientNpc from '#/client/dash3d/ClientNpc.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import WorldRegion from '#/client/dash3d/WorldRegion.js';
import { Int32Array3d } from '#/client/util/Arrays.js';

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
