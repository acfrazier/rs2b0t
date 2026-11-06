import { describe, expect, test } from 'bun:test';
import { LocDef, Reader, loadLocTypes } from '../../tools/nav/lib.js';

function decode(bytes: number[], revision: number): { config: LocDef; reader: Reader } {
    const reader = new Reader(Uint8Array.from(bytes));
    const config = new LocDef();
    config.decodeType(reader, revision);
    return { config, reader };
}

describe('LocDef', () => {
    test('keeps opcode 61 category without disturbing following fields', () => {
        const { config, reader } = decode([61, 0x12, 0x34, 14, 2, 0], 377);

        expect(config.category).toBe(0x1234);
        expect(config.width).toBe(2);
        expect(reader.available).toBe(0);
    });

    test('reads the 289 opcode 77 layout', () => {
        const { config, reader } = decode([77, 0, 5, 1, 0, 42, 0, 43, 14, 2, 0], 289);

        expect(config.width).toBe(2);
        expect(reader.available).toBe(0);
    });

    test('reads the 377 opcode 77 varbit and varp layout', () => {
        const { config, reader } = decode([77, 0, 5, 0, 7, 1, 0, 42, 0, 43, 14, 2, 0], 377);

        expect(config.width).toBe(2);
        expect(reader.available).toBe(0);
    });

    test('preserves the first 377 model list but keeps the 289 overwrite behavior', () => {
        const revision377 = decode([1, 1, 0, 10, 10, 1, 1, 0, 20, 0, 0], 377).config;
        revision377.postDecode();
        expect(Array.from(revision377.models ?? [])).toEqual([10]);
        expect(revision377.active).toBe(1);

        const revision289 = decode([1, 1, 0, 10, 10, 1, 1, 0, 20, 0, 0], 289).config;
        revision289.postDecode();
        expect(Array.from(revision289.models ?? [])).toEqual([20]);
        expect(revision289.active).toBe(0);
    });

    test('ignores zero-count opcode 5 only for revision 377', () => {
        const revision377 = decode([5, 0, 0], 377).config;
        expect(revision377.models).toBeNull();
        revision377.postDecode();
        expect(revision377.active).toBe(0);

        const revision289 = decode([5, 0, 0], 289).config;
        expect(Array.from(revision289.models ?? [])).toEqual([]);
        revision289.postDecode();
        expect(revision289.active).toBe(1);
    });

    test('matches 377 active and breakroutefinding semantics while keeping 289 behavior', () => {
        const revision377 = decode([19, 2, 74, 0], 377).config;
        revision377.postDecode();
        expect(revision377.active).toBe(0);
        expect(revision377.blockwalk).toBe(false);
        expect(revision377.blockrange).toBe(false);

        const repeatedActive = decode([19, 1, 19, 2, 0], 377).config;
        repeatedActive.postDecode();
        expect(repeatedActive.active).toBe(1);

        const revision289 = decode([19, 2, 74, 0], 289).config;
        revision289.postDecode();
        expect(revision289.active).toBe(2);
        expect(revision289.blockwalk).toBe(true);
        expect(revision289.blockrange).toBe(true);
    });

    test('fails when opcode 77 is decoded with the other revision layout', () => {
        const revision377 = [77, 0, 9, 0x45, 0x67, 1, 0, 42, 0, 43, 0];
        const revision289 = [77, 0, 9, 1, 0, 42, 0, 43, 0];

        expect(() => decode(revision377, 289)).toThrow();
        expect(() => decode(revision289, 377)).toThrow();
    });

    test('still rejects unknown opcodes and unsupported revisions', () => {
        expect(() => decode([76, 0], 377)).toThrow('Unrecognized loc config code: 76');
        expect(() => decode([0], 468)).toThrow('Unsupported loc config revision: 468');
        expect(() => loadLocTypes('unused', 468)).toThrow('Unsupported loc config revision: 468');
    });
});
