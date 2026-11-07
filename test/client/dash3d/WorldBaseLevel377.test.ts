import { describe, expect, test } from 'bun:test';

import ModelSource from '#/client/dash3d/ModelSource.js';
import type Square from '#/client/dash3d/Square.js';
import World, { TEXTURE_AVERAGE } from '#/client/dash3d/World.js';
import { Int32Array3d } from '#/client/util/Arrays.js';

interface SquareGrid {
    squares: (Square | null)[][][];
}

function newWorld(): World {
    return new World(new Int32Array3d(4, 105, 105), 104, 4, 104);
}

describe('World.fillBaseLevel (Java World3D.method275)', () => {
    test('allocates the missing squares of the level and records it as the base level', () => {
        const world = newWorld();
        const grid = world as unknown as SquareGrid;
        expect(grid.squares[1][3][4]).toBeNull();

        world.fillBaseLevel(1);

        expect(grid.squares[1][3][4]).not.toBeNull();
        expect(grid.squares[1][103][103]).not.toBeNull();
        expect(grid.squares[0][3][4]).toBeNull();
        expect(grid.squares[2][3][4]).toBeNull();
    });

    test('keeps the squares and their content that the build already created', () => {
        const world = newWorld();
        const grid = world as unknown as SquareGrid;
        world.setWall(1, 10, 11, 0, 1, 0, new ModelSource(), null, (2 << 14) | 10 | (11 << 7), 0);
        const built = grid.squares[1][10][11];
        expect(built).not.toBeNull();
        expect(world.wallType(1, 10, 11)).not.toBe(0);

        world.fillBaseLevel(1);

        expect(grid.squares[1][10][11]).toBe(built);
        expect(world.wallType(1, 10, 11)).not.toBe(0);
    });
});

describe('World texture averages (Java World3D.field1062)', () => {
    test('is the 377 table: texture 35 is the new 7079 entry', () => {
        // The table in Client-Java 377 World3D.java:104; every other texture keeps its 289 value.
        const java = [41, 39248, 41, 4643, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 43086, 41, 41, 41, 41, 41, 41, 41, 8602, 41, 28992, 41, 41, 41, 41, 41, 5056, 41, 41, 41, 7079, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 3131, 41, 41, 41];
        expect(Array.from(TEXTURE_AVERAGE)).toEqual(java);
        expect(TEXTURE_AVERAGE[35]).toBe(7079);
    });
});
