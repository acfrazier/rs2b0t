import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { Colour } from '#/client/graphics/Colour.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import type World from '#/client/dash3d/World.js';
import { Int32Array3d, Uint8Array3d } from '#/client/util/Arrays.js';

import { encodeLand, encodeLocs, type LandTile } from './sceneSupport.js';

// Why: mock.module has to run before the client modules load, and static imports are hoisted above it.
mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { default: ClientBuild } = await import('#/client/shell/ClientBuild.js');
const { default: LocType } = await import('#/client/config/LocType.js');
const { default: FloType } = await import('#/client/config/FloType.js');
const { default: Pix3D } = await import('#/client/dash3d/Pix3D.js');

type Build = InstanceType<typeof ClientBuild>;
type Loc = InstanceType<typeof LocType>;

interface BuildPrivates {
    floort1: Uint8Array[][];
    floort2: Uint8Array[][];
    floors: Uint8Array[][];
    floorr: Uint8Array[][];
}

interface Fixture {
    build: Build;
    groundh: Int32Array[][];
    mapl: Uint8Array[][];
    collisions: CollisionMap[];
}

const origLocList = LocType.list;
const origFloList = FloType.list;
const origLowMem = ClientBuild.lowMem;
const origMinUsed = ClientBuild.minusedlevel;

function fixture(): Fixture {
    const groundh = new Int32Array3d(4, 105, 105);
    const mapl = new Uint8Array3d(4, 104, 104);
    return { build: new ClientBuild(104, 104, groundh, mapl), groundh, mapl, collisions: [0, 1, 2, 3].map(() => new CollisionMap()) };
}

function flags(f: Fixture, level: number, x: number, z: number): number {
    return f.collisions[level].flags[CollisionMap.index(x, z)];
}

function priv(build: Build): BuildPrivates {
    return build as unknown as BuildPrivates;
}

beforeEach(() => {
    ClientBuild.lowMem = false;
    ClientBuild.minusedlevel = 0;
});

afterEach(() => {
    LocType.list = origLocList;
    FloType.list = origFloList;
    ClientBuild.lowMem = origLowMem;
    ClientBuild.minusedlevel = origMinUsed;
});

// A tile whose every field is a function of its position, so a misplaced tile shows up as a wrong value.
function patterned(level: number, x: number, z: number): LandTile {
    const tile: LandTile = { height: 2 + ((x * 7 + z * 3 + level * 5) % 200) };
    if ((x + z) % 3 === 0) {
        tile.flags = 1 + ((x + level) % 31);
    }
    if ((x * 5 + z) % 4 === 0) {
        tile.underlay = 1 + ((x + z) % 120);
    }
    if ((x + z * 2) % 5 === 0) {
        tile.overlay = { id: 1 + ((x * z) % 100), shape: (x + z + level) % 12, rotation: (x + level) % 4 };
    }
    return tile;
}

interface LandGrids {
    heights: number[][][];
    flagGrid: number[][][];
    under: number[][][];
    over: number[][][];
    shape: number[][][];
    turn: number[][][];
}

describe('ClientBuild.loadGround (Java World.method22)', () => {
    // Java method31 for rotation 0, transcribed independently of the implementation.
    function reference(land: Uint8Array, xOffset: number, zOffset: number, originX: number, originZ: number): LandGrids {
        const heights: number[][][] = [0, 1, 2, 3].map(() => Array.from({ length: 104 }, () => new Array<number>(104).fill(0)));
        const flagGrid: number[][][] = [0, 1, 2, 3].map(() => Array.from({ length: 104 }, () => new Array<number>(104).fill(0)));
        const under: number[][][] = [0, 1, 2, 3].map(() => Array.from({ length: 104 }, () => new Array<number>(104).fill(0)));
        const over: number[][][] = [0, 1, 2, 3].map(() => Array.from({ length: 104 }, () => new Array<number>(104).fill(0)));
        const shape: number[][][] = [0, 1, 2, 3].map(() => Array.from({ length: 104 }, () => new Array<number>(104).fill(0)));
        const turn: number[][][] = [0, 1, 2, 3].map(() => Array.from({ length: 104 }, () => new Array<number>(104).fill(0)));
        let pos = 0;
        for (let level = 0; level < 4; level++) {
            for (let x = 0; x < 64; x++) {
                for (let z = 0; z < 64; z++) {
                    const tx = xOffset + x;
                    const tz = zOffset + z;
                    const inside = tx >= 0 && tx < 104 && tz >= 0 && tz < 104;
                    for (;;) {
                        const op = land[pos++];
                        if (op === 0) {
                            if (inside) {
                                heights[level][tx][tz] = level === 0 ? -ClientBuild.perlinNoise(tx + originX + 932731, tz + 556238 + originZ) * 8 : heights[level - 1][tx][tz] - 240;
                            }
                            break;
                        }
                        if (op === 1) {
                            const raw = land[pos++];
                            const h = raw === 1 ? 0 : raw;
                            if (inside) {
                                heights[level][tx][tz] = level === 0 ? -h * 8 : heights[level - 1][tx][tz] - h * 8;
                            }
                            break;
                        }
                        if (op <= 49) {
                            const id = land[pos++];
                            if (inside) {
                                over[level][tx][tz] = id;
                                shape[level][tx][tz] = Math.floor((op - 2) / 4);
                                turn[level][tx][tz] = (op - 2) & 3;
                            }
                        } else if (op <= 81) {
                            if (inside) {
                                flagGrid[level][tx][tz] = op - 49;
                            }
                        } else if (inside) {
                            under[level][tx][tz] = op - 81;
                        }
                    }
                }
            }
        }
        return { heights, flagGrid, under, over, shape, turn };
    }

    function check(f: Fixture, expected: LandGrids): void {
        for (let level = 0; level < 4; level++) {
            for (let x = 0; x < 104; x++) {
                for (let z = 0; z < 104; z++) {
                    expect(f.groundh[level][x][z]).toBe(expected.heights[level][x][z]);
                    expect(f.mapl[level][x][z]).toBe(expected.flagGrid[level][x][z]);
                    expect(priv(f.build).floort1[level][x][z]).toBe(expected.under[level][x][z]);
                    expect(priv(f.build).floort2[level][x][z]).toBe(expected.over[level][x][z]);
                    expect(priv(f.build).floors[level][x][z]).toBe(expected.shape[level][x][z]);
                    expect(priv(f.build).floorr[level][x][z]).toBe(expected.turn[level][x][z]);
                }
            }
        }
    }

    test('decodes a land file that lies inside the scene', () => {
        const land = encodeLand(patterned);
        const f = fixture();
        f.build.loadGround(land, 3200, 3200, 20, 30, f.collisions);
        check(f, reference(land, 20, 30, 3200, 3200));
    });

    test('drops the tiles outside the scene and stays aligned with the stream', () => {
        const land = encodeLand((level, x, z) => (x === 63 && z === 63 && level === 3 ? { height: 77, flags: 5 } : patterned(level, x, z)));
        const f = fixture();
        f.build.loadGround(land, 3000, 3100, -40, 70, f.collisions);
        check(f, reference(land, -40, 70, 3000, 3100));
        // the last tile of the file is outside the scene at x=23, z=133: every earlier tile was consumed correctly
        expect(f.groundh[0][23][102]).toBe(reference(land, -40, 70, 3000, 3100).heights[0][23][102]);
    });

    test('uses the perlin height when a tile has no height opcode', () => {
        const land = encodeLand(() => ({}));
        const f = fixture();
        f.build.loadGround(land, 3200, 3216, 10, 10, f.collisions);
        expect(f.groundh[0][12][14]).toBe(-ClientBuild.perlinNoise(12 + 3200 + 932731, 14 + 556238 + 3216) * 8);
        expect(f.groundh[2][12][14]).toBe(f.groundh[1][12][14] - 240);
    });

    test('clears UNLOADED on the 64x64 it covers, on all four levels, inside 0 < x, z < 103 only', () => {
        const f = fixture();
        f.build.loadGround(encodeLand(patterned), 3200, 3200, -40, 70, f.collisions);
        for (let level = 0; level < 4; level++) {
            for (let x = 0; x < 104; x++) {
                for (let z = 0; z < 104; z++) {
                    const border = x === 0 || z === 0 || x === 103 || z === 103;
                    const covered = x >= 1 && x < 24 && z >= 70 && z < 103;
                    const expected = border ? 0xffffff : covered ? CollisionFlag._OPEN : CollisionFlag.UNLOADED;
                    expect(flags(f, level, x, z)).toBe(expected);
                }
            }
        }
    });
});

describe('ClientBuild.loadGroundChunk (Java World.method16)', () => {
    // one clockwise quarter turn of an 8x8 chunk, from the 377 rotation table
    const turn = ([x, z]: [number, number]): [number, number] => [z, 7 - x];
    const rotated = (rotation: number, tile: [number, number]): [number, number] => {
        let result = tile;
        for (let i = 0; i < rotation; i++) {
            result = turn(result);
        }
        return result;
    };

    test('places the source chunk turned by the rotation, tile for tile', () => {
        const land = encodeLand(patterned);
        for (let rotation = 0; rotation < 4; rotation++) {
            const f = fixture();
            f.build.loadGroundChunk(land, rotation, 0, 0, 16, 24, 32, 40, f.collisions);
            for (let dx = 0; dx < 8; dx++) {
                for (let dz = 0; dz < 8; dz++) {
                    const src = patterned(0, 16 + dx, 24 + dz);
                    const [lx, lz] = rotated(rotation, [dx, dz]);
                    const x = 32 + lx;
                    const z = 40 + lz;
                    expect(f.groundh[0][x][z]).toBe(-src.height! * 8);
                    expect(f.mapl[0][x][z]).toBe(src.flags ?? 0);
                    expect(priv(f.build).floort1[0][x][z]).toBe(src.underlay ?? 0);
                    expect(priv(f.build).floort2[0][x][z]).toBe(src.overlay?.id ?? 0);
                    if (src.overlay) {
                        expect(priv(f.build).floors[0][x][z]).toBe(src.overlay.shape);
                        expect(priv(f.build).floorr[0][x][z]).toBe((src.overlay.rotation + rotation) & 3);
                    }
                }
            }
        }
    });

    test('leaves every tile outside the destination chunk alone', () => {
        const f = fixture();
        f.build.loadGroundChunk(encodeLand(patterned), 1, 0, 0, 16, 24, 32, 40, f.collisions);
        for (let x = 0; x < 104; x++) {
            for (let z = 0; z < 104; z++) {
                if (x < 32 || x >= 40 || z < 40 || z >= 48) {
                    expect(f.groundh[0][x][z]).toBe(0);
                    expect(f.mapl[0][x][z]).toBe(0);
                }
            }
        }
    });

    test('reads a chunk from the last plane at the end of the file', () => {
        const f = fixture();
        f.build.loadGroundChunk(encodeLand(patterned), 2, 0, 3, 56, 56, 8, 8, f.collisions);
        const [lx, lz] = rotated(2, [3, 4]);
        expect(f.groundh[0][8 + lx][8 + lz]).toBe(-patterned(3, 59, 60).height! * 8);
    });

    test('builds a higher destination level on the height of the level below', () => {
        const f = fixture();
        f.groundh[0][32][40] = -1000;
        f.build.loadGroundChunk(encodeLand(patterned), 0, 1, 2, 16, 24, 32, 40, f.collisions);
        expect(f.groundh[1][32][40]).toBe(-1000 - patterned(2, 16, 24).height! * 8);
    });

    test('clears UNLOADED on that destination level only, for the chunk tiles inside 0 < x, z < 103', () => {
        const f = fixture();
        f.build.loadGroundChunk(encodeLand(patterned), 3, 2, 0, 0, 0, 96, 96, f.collisions);
        for (let level = 0; level < 4; level++) {
            for (let x = 94; x < 104; x++) {
                for (let z = 94; z < 104; z++) {
                    const border = x === 103 || z === 103;
                    const inChunk = x >= 96 && z >= 96 && x < 103 && z < 103;
                    const expected = border ? 0xffffff : level === 2 && inChunk ? CollisionFlag._OPEN : CollisionFlag.UNLOADED;
                    expect(flags(f, level, x, z)).toBe(expected);
                }
            }
        }
    });
});

describe('ClientBuild.clearChunk (Java World.method14)', () => {
    function filled(): Fixture {
        const f = fixture();
        for (let x = 0; x < 104; x++) {
            for (let z = 0; z < 104; z++) {
                f.groundh[2][x][z] = 1000 + x * 100 + z;
            }
        }
        return f;
    }

    test('zeroes the chunk and bleeds the west and south neighbours into its first row and column', () => {
        const f = filled();
        f.build.clearChunk(2, 16, 24);
        for (let dx = 0; dx < 8; dx++) {
            for (let dz = 0; dz < 8; dz++) {
                const expected =
                    dx === 0 && dz === 0 ? f.groundh[2][15][24] : dx === 0 ? 1000 + 15 * 100 + (24 + dz) : dz === 0 ? 1000 + (16 + dx) * 100 + 23 : 0;
                expect(f.groundh[2][16 + dx][24 + dz]).toBe(expected);
            }
        }
        expect(f.groundh[2][15][24]).toBe(1000 + 15 * 100 + 24);
        expect(f.groundh[2][24][24]).toBe(1000 + 24 * 100 + 24);
    });

    test('the corner falls back to the south neighbour, then the diagonal', () => {
        const f = filled();
        f.groundh[2][15][24] = 0;
        f.build.clearChunk(2, 16, 24);
        expect(f.groundh[2][16][24]).toBe(1000 + 16 * 100 + 23);

        const g = filled();
        g.groundh[2][15][24] = 0;
        g.groundh[2][16][23] = 0;
        g.build.clearChunk(2, 16, 24);
        expect(g.groundh[2][16][24]).toBe(1000 + 15 * 100 + 23);
    });

    test('a chunk on the scene edge has no neighbour to bleed from', () => {
        const f = filled();
        f.build.clearChunk(2, 0, 0);
        for (let dx = 0; dx < 8; dx++) {
            for (let dz = 0; dz < 8; dz++) {
                expect(f.groundh[2][dx][dz]).toBe(0);
            }
        }
    });
});

describe('ClientBuild.loadLocsChunk (Java World.method20)', () => {
    const turn = ([x, z]: [number, number]): [number, number] => [z, 7 - x];
    const rotated = (rotation: number, tile: [number, number]): [number, number] => {
        let result = tile;
        for (let i = 0; i < rotation; i++) {
            result = turn(result);
        }
        return result;
    };

    function stubLocs(sizes: Record<number, [number, number]>): void {
        LocType.list = ((id: number): Loc => {
            const loc = Object.create(LocType.prototype) as Loc;
            loc.width = sizes[id][0];
            loc.length = sizes[id][1];
            loc.anim = -1;
            loc.multiloc = [];
            loc.blockwalk = true;
            loc.blockrange = false;
            loc.active = false;
            loc.getModel = (() => null) as Loc['getModel'];
            return loc;
        }) as typeof LocType.list;
    }

    test('turns a multi-tile loc around its chunk: the blocked tiles are the image of the footprint', () => {
        stubLocs({ 1: [3, 2] });
        for (let rotation = 0; rotation < 4; rotation++) {
            for (let locAngle = 0; locAngle < 4; locAngle++) {
                const f = fixture();
                const data = encodeLocs([{ id: 1, plane: 1, x: 8 + 2, z: 16 + 3, shape: 10, angle: locAngle }]);
                f.build.loadLocsChunk(data, rotation, 1, 1, 8, 16, 32, 40, null, f.collisions);

                const sizeX = locAngle & 1 ? 2 : 3;
                const sizeZ = locAngle & 1 ? 3 : 2;
                const expected = new Set<string>();
                for (let i = 0; i < sizeX; i++) {
                    for (let j = 0; j < sizeZ; j++) {
                        const [lx, lz] = rotated(rotation, [2 + i, 3 + j]);
                        expected.add(`${32 + lx},${40 + lz}`);
                    }
                }

                const blocked = new Set<string>();
                for (let x = 24; x < 48; x++) {
                    for (let z = 32; z < 56; z++) {
                        if (flags(f, 1, x, z) & CollisionFlag.WALK_SCENERY) {
                            blocked.add(`${x},${z}`);
                        }
                    }
                }
                expect(blocked).toEqual(expected);
            }
        }
    });

    test('skips locs of another plane or outside the 8x8 window', () => {
        stubLocs({ 1: [1, 1] });
        const f = fixture();
        const data = encodeLocs([
            { id: 1, plane: 0, x: 10, z: 20, shape: 10, angle: 0 },
            { id: 1, plane: 1, x: 7, z: 20, shape: 10, angle: 0 },
            { id: 1, plane: 1, x: 16, z: 20, shape: 10, angle: 0 },
            { id: 1, plane: 1, x: 10, z: 24, shape: 10, angle: 0 },
            { id: 1, plane: 1, x: 10, z: 16, shape: 10, angle: 0 }
        ]);
        f.build.loadLocsChunk(data, 0, 2, 1, 8, 16, 40, 48, null, f.collisions);

        let blocked = 0;
        for (let level = 0; level < 4; level++) {
            for (let x = 1; x < 103; x++) {
                for (let z = 1; z < 103; z++) {
                    if (flags(f, level, x, z) & CollisionFlag.WALK_SCENERY) {
                        blocked++;
                        expect([level, x, z]).toEqual([2, 40 + 2, 48 + 0]);
                    }
                }
            }
        }
        expect(blocked).toBe(1);
    });

    test('uses the collision map one level down where the tile above links to the level below', () => {
        stubLocs({ 1: [1, 1] });
        const f = fixture();
        f.mapl[1][42][52] = 2;
        const data = encodeLocs([{ id: 1, plane: 1, x: 10, z: 20, shape: 10, angle: 0 }]);
        f.build.loadLocsChunk(data, 0, 2, 1, 8, 16, 40, 48, null, f.collisions);
        expect(flags(f, 1, 42, 52) & CollisionFlag.WALK_SCENERY).toBe(CollisionFlag.WALK_SCENERY);
        expect(flags(f, 2, 42, 52) & CollisionFlag.WALK_SCENERY).toBe(0);
    });

    test('drops a loc placed on or beyond the scene edge', () => {
        stubLocs({ 1: [1, 1] });
        const f = fixture();
        const data = encodeLocs([
            { id: 1, plane: 0, x: 8 + 6, z: 16 + 1, shape: 10, angle: 0 },
            { id: 1, plane: 0, x: 8 + 7, z: 16 + 2, shape: 10, angle: 0 },
            { id: 1, plane: 0, x: 8 + 2, z: 16 + 7, shape: 10, angle: 0 }
        ]);
        f.build.loadLocsChunk(data, 0, 0, 0, 8, 16, 96, 96, null, f.collisions);
        // (102,97) is inside the scene; x = 103 and z = 103 are on its border and are dropped
        let blocked = 0;
        for (let x = 1; x < 103; x++) {
            for (let z = 1; z < 103; z++) {
                if (flags(f, 0, x, z) & CollisionFlag.WALK_SCENERY) {
                    blocked++;
                    expect([x, z]).toEqual([102, 97]);
                }
            }
        }
        expect(blocked).toBe(1);
    });
});

describe('lowMem gates (Java World.method21 and method15)', () => {
    function stubSingle(): void {
        LocType.list = ((): Loc => {
            const loc = Object.create(LocType.prototype) as Loc;
            loc.width = 1;
            loc.length = 1;
            loc.anim = -1;
            loc.multiloc = [];
            loc.blockwalk = true;
            loc.active = false;
            loc.getModel = (() => null) as Loc['getModel'];
            return loc;
        }) as typeof LocType.list;
    }

    test('a loc on another level is culled under lowMem unless level 0 links below', () => {
        stubSingle();
        ClientBuild.lowMem = true;
        ClientBuild.minusedlevel = 0;
        const data = encodeLocs([{ id: 1, plane: 1, x: 10, z: 10, shape: 10, angle: 0 }]);

        const culled = fixture();
        culled.build.loadLocations(data, 0, 0, null, culled.collisions);
        expect(flags(culled, 1, 10, 10) & CollisionFlag.WALK_SCENERY).toBe(0);
        expect(ClientBuild.minBuiltLevel).toBe(99);

        const kept = fixture();
        kept.mapl[0][10][10] = 2;
        kept.build.loadLocations(data, 0, 0, null, kept.collisions);
        expect(flags(kept, 1, 10, 10) & CollisionFlag.WALK_SCENERY).toBe(CollisionFlag.WALK_SCENERY);
        expect(ClientBuild.minBuiltLevel).toBe(1);
    });

    test('without lowMem every level is built and minBuiltLevel follows the lowest loc', () => {
        stubSingle();
        const f = fixture();
        const data = encodeLocs([
            { id: 1, plane: 2, x: 10, z: 10, shape: 10, angle: 0 },
            { id: 1, plane: 1, x: 12, z: 10, shape: 10, angle: 0 }
        ]);
        f.build.loadLocations(data, 0, 0, null, f.collisions);
        expect(ClientBuild.minBuiltLevel).toBe(1);
    });

    test('the build resets minBuiltLevel to 99', () => {
        ClientBuild.minBuiltLevel = 2;
        fixture();
        expect(ClientBuild.minBuiltLevel).toBe(99);
    });

    test('finishBuild records the lowest level that passed the tile gate', () => {
        ClientBuild.lowMem = true;
        ClientBuild.minusedlevel = 2;
        const f = fixture();
        f.build.finishBuild(null, f.collisions);
        expect(ClientBuild.minBuiltLevel).toBe(2);

        const linked = fixture();
        linked.mapl[0][50][50] = 2;
        linked.build.finishBuild(null, linked.collisions);
        expect(ClientBuild.minBuiltLevel).toBe(0);
    });

    test('finishBuild without lowMem builds level 0', () => {
        const f = fixture();
        f.build.finishBuild(null, f.collisions);
        expect(ClientBuild.minBuiltLevel).toBe(0);
    });
});

describe('overlay colour of a magenta flo (Java World.method15)', () => {
    test('keeps the flo overlay colour for the minimap and marks the second colour as hidden', () => {
        Pix3D.initColourTable(0.8);
        const flo = new FloType();
        flo.texture = -1;
        flo.colour = Colour.MAGENTA;
        flo.overlayHsl = 0x1c35;
        FloType.list = [flo];

        const f = fixture();
        f.build.loadGround(encodeLand((level, x, z) => (level === 0 && x === 20 && z === 20 ? { height: 10, overlay: { id: 1, shape: 0, rotation: 0 } } : { height: 10 })), 0, 0, 0, 0, f.collisions);

        const grounds: unknown[][] = [];
        const world = {
            setGround: (...args: unknown[]) => grounds.push(args),
            setLayer: () => {},
            shareLight: () => {},
            pushDown: () => {}
        } as unknown as World;
        f.build.finishBuild(world, f.collisions);

        const call = grounds.find(args => args[0] === 0 && args[1] === 20 && args[2] === 20);
        expect(call).toBeDefined();
        const expectedOverlay = Pix3D.colourTable[ClientBuild.getOCol(0x1c35, 96)];
        expect(expectedOverlay).not.toBe(0);
        // texture, then the four second colours (12345678 = no colour), then the minimap underlay and overlay
        expect(call![5]).toBe(-1);
        expect(call!.slice(14, 18)).toEqual([12345678, 12345678, 12345678, 12345678]);
        expect(call![19]).toBe(expectedOverlay);
    });
});

describe('ClientBuild.changeLocUnchecked (Java World.method13)', () => {
    interface Captured {
        shape: number;
        angle: number;
        heights: number[];
    }

    function capture(hillskew: boolean): Captured[] {
        const seen: Captured[] = [];
        LocType.list = ((): Loc => {
            const loc = Object.create(LocType.prototype) as Loc;
            loc.width = 1;
            loc.length = 1;
            loc.anim = -1;
            loc.multiloc = [];
            loc.hillskew = hillskew;
            loc.getModel = ((shape: number, angle: number, sw: number, se: number, ne: number, nw: number) => {
                seen.push({ shape, angle, heights: [sw, se, ne, nw] });
                return null;
            }) as Loc['getModel'];
            return loc;
        }) as typeof LocType.list;
        return seen;
    }

    function heights(): Int32Array[][] {
        const h = new Int32Array3d(4, 105, 105);
        h[1][10][20] = 100;
        h[1][11][20] = 200;
        h[1][11][21] = 300;
        h[1][10][21] = 400;
        return h;
    }

    test('passes the corner heights in south-west, south-east, north-east, north-west order', () => {
        const seen = capture(false);
        ClientBuild.changeLocUnchecked(1, 10, 20, 5, 10, 0, 1, heights(), null, null);
        expect(seen).toEqual([{ shape: 10, angle: 0, heights: [100, 200, 300, 400] }]);
    });

    test('rotates the corners of a hill-skewed wall decoration with its angle', () => {
        const expected = [
            [100, 200, 300, 400],
            [400, 100, 200, 300],
            [300, 400, 100, 200],
            [200, 300, 400, 100]
        ];
        for (let angle = 0; angle < 4; angle++) {
            const seen = capture(true);
            ClientBuild.changeLocUnchecked(1, 10, 20, 5, 4, angle, 1, heights(), null, null);
            expect(seen[0].heights).toEqual(expected[angle]);
        }
    });
});
