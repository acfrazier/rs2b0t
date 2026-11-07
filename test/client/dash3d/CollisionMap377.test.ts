import { describe, expect, test } from 'bun:test';

import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import CollisionMap, { BuildArea } from '#/client/dash3d/CollisionMap.js';
import { LocAngle } from '#/client/dash3d/LocAngle.js';
import { LocShape } from '#/client/dash3d/LocShape.js';

const SIDE = BuildArea.SIZE;

describe('CollisionFlag path masks (Client-Java 377 CollisionMap)', () => {
    test('walk masks carry the UNLOADED bit', () => {
        // The literals are the Java 377 masks in CollisionMap.method541 (0x1280xxx).
        expect(CollisionFlag.SQ_BLOCKED).toBe(0x1280100);
        expect(CollisionFlag.PL_WALK_N).toBe(0x1280102);
        expect(CollisionFlag.PL_WALK_E).toBe(0x1280108);
        expect(CollisionFlag.PL_WALK_NE).toBe(0x128010e);
        expect(CollisionFlag.PL_WALK_S).toBe(0x1280120);
        expect(CollisionFlag.PL_WALK_SE).toBe(0x1280138);
        expect(CollisionFlag.PL_WALK_W).toBe(0x1280180);
        expect(CollisionFlag.PL_WALK_NW).toBe(0x1280183);
        expect(CollisionFlag.PL_WALK_SW).toBe(0x12801e0);
    });

    test('each walk mask is SQ_BLOCKED plus its wall bits', () => {
        const wall = (...bits: number[]): number => bits.reduce((a, b) => a | b, CollisionFlag.SQ_BLOCKED);
        expect(CollisionFlag.PL_WALK_N).toBe(wall(CollisionFlag.W_N));
        expect(CollisionFlag.PL_WALK_E).toBe(wall(CollisionFlag.W_E));
        expect(CollisionFlag.PL_WALK_NE).toBe(wall(CollisionFlag.W_NE, CollisionFlag.W_N, CollisionFlag.W_E));
        expect(CollisionFlag.PL_WALK_SE).toBe(wall(CollisionFlag.W_SE, CollisionFlag.W_S, CollisionFlag.W_E));
        expect(CollisionFlag.PL_WALK_NW).toBe(wall(CollisionFlag.W_NW, CollisionFlag.W_N, CollisionFlag.W_W));
        expect(CollisionFlag.PL_WALK_SW).toBe(wall(CollisionFlag.W_SW, CollisionFlag.W_S, CollisionFlag.W_W));
        expect(CollisionFlag.SQ_BLOCKED).toBe(CollisionFlag.UNLOADED | CollisionFlag.WR_GRND | CollisionFlag.BLOCK_NPCS_AND_PLAYERS | CollisionFlag.WALK_SCENERY);
    });
});

describe('CollisionMap reset', () => {
    test('the border is 0xFFFFFF and every interior tile starts UNLOADED', () => {
        const map = new CollisionMap();
        for (let x = 0; x < SIDE; x++) {
            for (let z = 0; z < SIDE; z++) {
                const border = x === 0 || z === 0 || x === SIDE - 1 || z === SIDE - 1;
                expect(map.flags[CollisionMap.index(x, z)]).toBe(border ? 0xffffff : 0x1000000);
            }
        }
    });

    test('reset discards loc flags and restores UNLOADED', () => {
        const map = new CollisionMap();
        map.flags[CollisionMap.index(10, 10)] = CollisionFlag._OPEN;
        map.addLoc(10, 10, 2, 2, LocAngle.WEST, true);
        map.reset();
        expect(map.flags[CollisionMap.index(10, 10)]).toBe(CollisionFlag.UNLOADED);
        expect(map.flags[CollisionMap.index(11, 11)]).toBe(CollisionFlag.UNLOADED);
    });
});

describe('CollisionMap ground and loc flags', () => {
    test('unblockGround applies Java 0xDFFFFF: it clears WR_GRND and every bit from 24 up', () => {
        const map = new CollisionMap();
        const index = CollisionMap.index(20, 21);
        map.flags[index] = CollisionFlag.UNLOADED | CollisionFlag.NPCS_OR_PLAYERS | CollisionFlag.WR_GRND | CollisionFlag.WALK_SCENERY | CollisionFlag.W_N;
        map.unblockGround(20, 21);
        expect(map.flags[index]).toBe(CollisionFlag.WALK_SCENERY | CollisionFlag.W_N);
    });

    test('blockGround sets only WR_GRND', () => {
        const map = new CollisionMap();
        const index = CollisionMap.index(20, 21);
        map.flags[index] = CollisionFlag._OPEN;
        map.blockGround(20, 21);
        expect(map.flags[index]).toBe(CollisionFlag.WR_GRND);
    });

    test('delLoc clears the loc bits and, like Java method539, everything from bit 24 up', () => {
        const map = new CollisionMap();
        const index = CollisionMap.index(30, 30);
        map.flags[index] = CollisionFlag.UNLOADED;
        map.addLoc(30, 30, 1, 1, LocAngle.WEST, false);
        expect(map.flags[index]).toBe(CollisionFlag.UNLOADED | CollisionFlag.WALK_SCENERY);
        map.delLoc(30, 30, 1, 1, LocAngle.WEST, false);
        expect(map.flags[index]).toBe(CollisionFlag._OPEN);
    });
});

describe('CollisionMap approach tests on unloaded tiles', () => {
    test('an UNLOADED source tile is not an approach tile for a wall', () => {
        const map = new CollisionMap();
        // Java method541, shape 0 angle 0: the tile north of the wall must be free of PL_WALK_S (0x1280120)
        expect(map.testWall(40, 41, 40, 40, LocShape.WALL_STRAIGHT, LocAngle.WEST)).toBe(false);

        map.flags[CollisionMap.index(40, 41)] &= ~CollisionFlag.UNLOADED;
        expect(map.testWall(40, 41, 40, 40, LocShape.WALL_STRAIGHT, LocAngle.WEST)).toBe(true);

        map.blockGround(40, 41);
        expect(map.testWall(40, 41, 40, 40, LocShape.WALL_STRAIGHT, LocAngle.WEST)).toBe(false);
    });
});
