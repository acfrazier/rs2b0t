import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { hasArrived, isSetCustomTile, MAP_PICK, resolveWalkTarget } from '#/bot/scripts/WalkToBot/WalkToLogic.js';

describe('hasArrived', () => {
    const dest = { x: 3221, z: 3218, level: 0 };

    test('radius 0 requires the destination tile', () => {
        expect(hasArrived(dest, dest, 0)).toBe(true);
        expect(hasArrived({ x: 3222, z: 3218, level: 0 }, dest, 0)).toBe(false);
    });

    test('does not grant a bonus tile of slack', () => {
        expect(hasArrived({ x: 3225, z: 3218, level: 0 }, dest, 3)).toBe(false);
        expect(hasArrived({ x: 3224, z: 3218, level: 0 }, dest, 3)).toBe(true);
    });
});

describe('resolveWalkTarget', () => {
    const alkharid = { x: 3269, z: 3167, level: 0 };

    test('a named destination beats a leftover map pick', () => {
        const got = resolveWalkTarget('Varrock', alkharid);
        expect(got?.label).toBe('Varrock');
        expect(got?.tile).toEqual(new Tile(3213, 3424, 0));
        expect(got?.named).toBe(true);
    });


    test('Map pick uses the custom tile', () => {
        const got = resolveWalkTarget(MAP_PICK, alkharid);
        expect(got?.named).toBe(false);
        expect(got?.tile).toEqual(new Tile(3269, 3167, 0));
        expect(got?.label).toBe('Map pick 3269,3167');
    });

    test('Map pick with no tile is unset', () => {
        expect(resolveWalkTarget(MAP_PICK, { x: 0, z: 0, level: 0 })).toBeNull();
        expect(isSetCustomTile({ x: 0, z: 0 })).toBe(false);
        expect(isSetCustomTile(alkharid)).toBe(true);
    });
});
