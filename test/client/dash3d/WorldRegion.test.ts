import { describe, expect, test } from 'bun:test';

import WorldRegion from '#/client/dash3d/WorldRegion.js';

type Tile = [number, number];

// Java 377 WorldRegion.method461/method462 for one rotation step, written without the helper.
const turn = ([x, z]: Tile): Tile => [z, 7 - x];

function image(rotation: number, tile: Tile): Tile {
    return [WorldRegion.localX(rotation, tile[0], tile[1]), WorldRegion.localZ(tile[1], tile[0], rotation)];
}

describe('WorldRegion tile rotation', () => {
    test('rotation r is r clockwise quarter turns of the 8x8 chunk', () => {
        for (let x = 0; x < 8; x++) {
            for (let z = 0; z < 8; z++) {
                let expected: Tile = [x, z];
                for (let rotation = 0; rotation < 4; rotation++) {
                    expect(image(rotation, [x, z])).toEqual(expected);
                    expected = turn(expected);
                }
                expect(expected).toEqual([x, z]);
            }
        }
    });

    test('masks the rotation to its low two bits like Java', () => {
        expect(image(5, [2, 6])).toEqual(image(1, [2, 6]));
        expect(image(-3, [2, 6])).toEqual(image(1, [2, 6]));
    });

    test('hand-computed corners', () => {
        expect(image(1, [0, 0])).toEqual([0, 7]);
        expect(image(2, [0, 0])).toEqual([7, 7]);
        expect(image(3, [0, 0])).toEqual([7, 0]);
        expect(image(1, [2, 5])).toEqual([5, 5]);
        expect(image(3, [2, 5])).toEqual([2, 2]);
    });
});

describe('WorldRegion loc placement', () => {
    test('a loc origin lands on the south-west tile of the rotated footprint', () => {
        for (let rotation = 0; rotation < 4; rotation++) {
            for (let locAngle = 0; locAngle < 4; locAngle++) {
                for (let width = 1; width <= 3; width++) {
                    for (let length = 1; length <= 3; length++) {
                        const sizeX = locAngle & 1 ? length : width;
                        const sizeZ = locAngle & 1 ? width : length;
                        for (let x = 0; x + sizeX <= 8; x++) {
                            for (let z = 0; z + sizeZ <= 8; z++) {
                                const xs: number[] = [];
                                const zs: number[] = [];
                                for (let i = 0; i < sizeX; i++) {
                                    for (let j = 0; j < sizeZ; j++) {
                                        const [tx, tz] = image(rotation, [x + i, z + j]);
                                        xs.push(tx);
                                        zs.push(tz);
                                    }
                                }

                                expect(WorldRegion.locX(rotation, length, locAngle, x, width, z)).toBe(Math.min(...xs));
                                expect(WorldRegion.locZ(width, rotation, x, z, length, locAngle)).toBe(Math.min(...zs));
                                // a quarter turn swaps the footprint's two sides
                                const turned = rotation & 1;
                                expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(turned ? sizeZ : sizeX);
                                expect(Math.max(...zs) - Math.min(...zs) + 1).toBe(turned ? sizeX : sizeZ);
                            }
                        }
                    }
                }
            }
        }
    });

    test('the Java argument order puts length before width in x and width first in z', () => {
        // a 3 wide by 1 long loc, angle 0, at (1,2), rotation 2: footprint x 1..3 turns to 4..6
        expect(WorldRegion.locX(2, 1, 0, 1, 3, 2)).toBe(7 - 1 - 2);
        expect(WorldRegion.locZ(3, 2, 1, 2, 1, 0)).toBe(7 - 2);
        // the same loc at angle 1 is 1 wide by 3 long, so rotation 3 reaches 3 tiles in z
        expect(WorldRegion.locX(3, 1, 1, 1, 3, 2)).toBe(7 - 2 - 2);
        expect(WorldRegion.locZ(3, 3, 1, 2, 1, 1)).toBe(1);
    });
});
