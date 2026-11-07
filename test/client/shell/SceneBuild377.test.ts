import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import LocType from '#/client/config/LocType.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import ClientBuild from '#/client/shell/ClientBuild.js';

import { Client, newWorld, sceneClient, type SceneClient } from './sceneClient.js';
import { encodeLand, encodeLocs, packTemplate, type LandTile } from './sceneSupport.js';

type Loc = InstanceType<typeof LocType>;

const origLocList = LocType.list;
const origLowMem = Client.lowMem;
const origBuildLowMem = ClientBuild.lowMem;
const origCheck = ClientBuild.checkLocations;

function patterned(level: number, x: number, z: number): LandTile {
    return { height: 2 + ((x * 7 + z * 3 + level * 5) % 200), flags: (x + z) % 9 === 0 ? 2 : 0 };
}

function stubLocs(): void {
    LocType.list = ((): Loc => {
        const loc = Object.create(LocType.prototype) as Loc;
        loc.width = 1;
        loc.length = 1;
        loc.anim = -1;
        loc.multiloc = [];
        loc.blockwalk = true;
        loc.blockrange = false;
        loc.active = false;
        loc.getModel = (() => null) as Loc['getModel'];
        return loc;
    }) as typeof LocType.list;
}

function builtClient(): SceneClient {
    const client = sceneClient();
    newWorld(client);
    return client;
}

// one clockwise quarter turn of an 8x8 chunk
const turn = ([x, z]: [number, number]): [number, number] => [z, 7 - x];

beforeEach(() => {
    Client.lowMem = false;
    ClientBuild.lowMem = false;
    ClientBuild.minusedlevel = 0;
    stubLocs();
});

afterEach(() => {
    LocType.list = origLocList;
    Client.lowMem = origLowMem;
    ClientBuild.lowMem = origBuildLowMem;
    ClientBuild.checkLocations = origCheck;
});

describe('Client.mapBuild of an instanced scene (Java buildScene)', () => {
    const SQUARE = (50 << 8) + 100;
    const land = encodeLand(patterned);
    const locs = encodeLocs([
        { id: 1, plane: 0, x: 24 + 1, z: 40 + 2, shape: 10, angle: 0 },
        { id: 1, plane: 0, x: 24 + 1, z: 40 + 9, shape: 10, angle: 0 }
    ]);

    function instance(): SceneClient {
        const client = builtClient();
        client.sceneInstanced = true;
        client.sceneState = 2;
        client.mapBuildIndex = Int32Array.of(SQUARE);
        client.mapBuildGroundData = [land];
        client.mapBuildLocationData = [locs];
        // chunk (2,3) of level 0 is source chunk (3,5) of map square (50,100), turned once
        for (const plane of client.sceneMapRegion) {
            for (const row of plane) {
                row.fill(-1);
            }
        }
        client.sceneMapRegion[0][2][3] = packTemplate(0, 8 * 50 + 3, 8 * 100 + 5, 1);
        return client;
    }

    test('loads the template chunk turned, clears the rest, and builds collision from the turned locs', () => {
        const errors = spyOn(console, 'error').mockImplementation(() => {});
        const client = instance();
        client.mapBuild();
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();

        // the edge rows are overwritten by the fade of the empty chunks around, so only the interior is compared
        for (let dx = 1; dx < 7; dx++) {
            for (let dz = 1; dz < 7; dz++) {
                const [lx, lz] = turn([dx, dz]);
                const src = patterned(0, 24 + dx, 40 + dz);
                expect(client.groundh[0][16 + lx][24 + lz]).toBe(-src.height! * 8);
            }
        }

        // the loc at source (1,2) lands on the turned tile; the one at z=9 is beyond the 8x8 window
        const [lx, lz] = turn([1, 2]);
        const flags = (x: number, z: number): number => client.collision[0].flags[CollisionMap.index(x, z)];
        const blocked: [number, number][] = [];
        for (let x = 1; x < 103; x++) {
            for (let z = 1; z < 103; z++) {
                if (flags(x, z) & CollisionFlag.WALK_SCENERY) {
                    blocked.push([x, z]);
                }
            }
        }
        expect(blocked).toEqual([[16 + lx, 24 + lz]]);

        // UNLOADED is cleared on the loaded chunk and stays on a chunk with no template
        expect(flags(16 + 3, 24 + 3) & CollisionFlag.UNLOADED).toBe(0);
        expect(flags(5 * 8 + 2, 5 * 8 + 2) & CollisionFlag.UNLOADED).toBe(CollisionFlag.UNLOADED);
    });

    test('empty chunks are flat and the level-0 scene border is faded into them', () => {
        const client = instance();
        client.groundh[0][40][40] = 999;
        client.mapBuild();
        expect(client.groundh[0][41][41]).toBe(0);
        expect(client.world).not.toBeNull();
    });

    test('keeps the NO_TIMEOUT pings, ends with a built base level, and clears stale map flags', () => {
        const client = instance();
        client.mapl[2][70][70] = 0x1f;
        client.mapBuild();
        expect(client.out.sent).toEqual([ClientProt.NO_TIMEOUT, ClientProt.NO_TIMEOUT, ClientProt.NO_TIMEOUT, ClientProt.NO_TIMEOUT]);
        expect(client.mapl[2][70][70]).toBe(0);
        expect(ClientBuild.minBuiltLevel).toBeLessThan(99);
    });

    test('checkScene measures an instance with the fixed 10,10 offsets and then builds and acknowledges', () => {
        const offsets: [number, number][] = [];
        ClientBuild.checkLocations = (_src, x, z) => {
            offsets.push([x, z]);
            return true;
        };
        const client = instance();
        client.sceneState = 1;
        client.mapBuildGroundFile = [-1];
        client.mapBuildLocationFile = [-1];
        client.mapBuildBaseX = 6632;
        client.mapBuildBaseZ = 48;
        client.minusedlevel = 0;

        expect(client.checkScene()).toBe(0);
        expect(offsets).toEqual([[10, 10]]);
        expect(client.sceneState).toBe(2);
        expect(client.out.sent.at(-1)).toBe(ClientProt.MAP_BUILD_COMPLETE);
    });
});

describe('Client.mapBuild of a normal scene', () => {
    test('uses each map square at its offset from the base and clears UNLOADED only where land loaded', () => {
        const client = builtClient();
        client.sceneInstanced = false;
        client.mapBuildCentreZoneX = 400;
        client.mapBuildCentreZoneZ = 401;
        client.mapBuildBaseX = (400 - 6) * 8;
        client.mapBuildBaseZ = (401 - 6) * 8;
        // map (49,49) starts at tile (49*64 - 3152, 49*64 - 3160) = (-16, -24); map (50,50) at (48, 40)
        client.mapBuildIndex = Int32Array.of((49 << 8) + 49, (50 << 8) + 50);
        client.mapBuildGroundData = [encodeLand(patterned), null];
        client.mapBuildLocationData = [encodeLocs([{ id: 1, plane: 0, x: 20, z: 30, shape: 10, angle: 0 }]), null];
        client.mapl[3][90][90] = 0x1f;

        client.mapBuild();

        expect(client.groundh[0][4][6]).toBe(-patterned(0, 4 + 16, 6 + 24).height! * 8);
        expect(client.collision[0].flags[CollisionMap.index(4, 6)] & CollisionFlag.UNLOADED).toBe(0);
        expect(client.collision[0].flags[CollisionMap.index(60, 60)] & CollisionFlag.UNLOADED).toBe(CollisionFlag.UNLOADED);
        // the loc at map-local (20,30) is scene tile (20-16, 30-24)
        expect(client.collision[0].flags[CollisionMap.index(4, 6)] & CollisionFlag.WALK_SCENERY).toBe(CollisionFlag.WALK_SCENERY);
        expect(client.mapl[3][90][90]).toBe(0);
    });

    test('measures a normal scene with the real offsets', () => {
        const offsets: [number, number][] = [];
        ClientBuild.checkLocations = (_src, x, z) => {
            offsets.push([x, z]);
            return true;
        };
        const client = builtClient();
        client.sceneState = 1;
        client.mapBuildBaseX = 3152;
        client.mapBuildBaseZ = 3160;
        client.mapBuildIndex = Int32Array.of((49 << 8) + 49);
        client.mapBuildGroundData = [new Uint8Array(1)];
        client.mapBuildLocationData = [new Uint8Array(1)];
        client.mapBuildGroundFile = [-1];
        client.mapBuildLocationFile = [-1];
        client.mapBuild = () => {};
        client.checkScene();
        expect(offsets).toEqual([[49 * 64 - 3152, 49 * 64 - 3160]]);
    });
});
