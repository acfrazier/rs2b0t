import { describe, expect, test } from 'bun:test';

import Packet from '../../src/client/io/Packet.js';

function packet(bytes: number[]): Packet {
    return new Packet(Uint8Array.from(bytes));
}

describe('377 packet transforms', () => {
    test('matches Rust PacketReader377 byte, word, 3-byte, and dword transforms', () => {
        // Expected transforms follow packet_377.rs:729-787; Rust's exact edge vectors are copied below.
        const cases: Array<{ name: string; bytes: number[]; expected: number; read: (packet: Packet) => number }> = [
            { name: 'g1_alt1', bytes: [0xb4], expected: 0x34, read: packet => packet.g1_alt1() },
            { name: 'g1_alt2', bytes: [0xcc], expected: 0x34, read: packet => packet.g1_alt2() },
            { name: 'g1_alt3', bytes: [0x4c], expected: 0x34, read: packet => packet.g1_alt3() },
            { name: 'g1b_alt1', bytes: [0x53], expected: -45, read: packet => packet.g1b_alt1() },
            { name: 'g1b_alt2', bytes: [0x2d], expected: -45, read: packet => packet.g1b_alt2() },
            { name: 'g1b_alt3', bytes: [0xad], expected: -45, read: packet => packet.g1b_alt3() },
            { name: 'g2_alt1', bytes: [0x34, 0x12], expected: 0x1234, read: packet => packet.g2_alt1() },
            { name: 'g2_alt2', bytes: [0x12, 0xb4], expected: 0x1234, read: packet => packet.g2_alt2() },
            { name: 'g2_alt3', bytes: [0xb4, 0x12], expected: 0x1234, read: packet => packet.g2_alt3() },
            { name: 'g2b_alt1', bytes: [0xcc, 0xed], expected: -0x1234, read: packet => packet.g2b_alt1() },
            { name: 'g2b_alt2', bytes: [0xed, 0x4c], expected: -0x1234, read: packet => packet.g2b_alt2() },
            { name: 'g3_alt3', bytes: [0x12, 0x34, 0x56], expected: 0x341256, read: packet => packet.g3_alt3() },
            { name: 'g4_alt1', bytes: [0x12, 0x34, 0x56, 0x78], expected: 0x78563412, read: packet => packet.g4_alt1() },
            { name: 'g4_alt2', bytes: [0x12, 0x34, 0x56, 0x78], expected: 0x56781234, read: packet => packet.g4_alt2() },
            { name: 'g4_alt3', bytes: [0x12, 0x34, 0x56, 0x78], expected: 0x34127856, read: packet => packet.g4_alt3() },
            { name: 'g4_alt1 signed', bytes: [0x12, 0x34, 0x56, 0xf8], expected: -0x07a9cbee, read: packet => packet.g4_alt1() },
            { name: 'g4_alt2 signed', bytes: [0x12, 0x34, 0xf8, 0x78], expected: -0x0787edcc, read: packet => packet.g4_alt2() },
            { name: 'g4_alt3 signed', bytes: [0x12, 0xf8, 0x56, 0x78], expected: -0x07ed87aa, read: packet => packet.g4_alt3() }
        ];

        for (const vector of cases) {
            const input = packet(vector.bytes);
            expect(vector.read(input), vector.name).toBe(vector.expected);
            expect(input.pos, `${vector.name} consumed bytes`).toBe(vector.bytes.length);
        }
    });

    test('matches Rust signed and mixed-endian reader edge vectors', () => {
        // Exact input and result vectors from crates/client/tests/revision_377_packets.rs:709-717.
        const signed = packet([0xff, 0xff, 0x00, 0x80, 0x7f, 0xff, 0x80, 0xff]);
        expect(signed.g1b()).toBe(-1);
        expect(signed.g1b_alt1()).toBe(127);
        expect(signed.g1b_alt2()).toBe(0);
        expect(signed.g1b_alt3()).toBe(0);
        expect(signed.g2b_alt1()).toBe(-129);
        expect(signed.g2b_alt2()).toBe(-32641);
        expect(signed.pos).toBe(8);

        const mixedDword = packet([0x34, 0x12, 0x78, 0x56]);
        expect(mixedDword.g4_alt3()).toBe(0x12345678);
        expect(mixedDword.pos).toBe(4);
    });

    test('keeps Client-TS 377 signed aliases and engine-compatible wider transforms', () => {
        const signedWord = packet([0xcc, 0xed]);
        expect(signedWord.g2s_alt1()).toBe(-0x1234);

        const signedBiasedWord = packet([0xed, 0x4c]);
        expect(signedBiasedWord.g2s_alt2()).toBe(-0x1234);
        expect(packet([0xb4, 0x12]).g2s_alt3()).toBe(0x1234);

        expect(packet([0x56, 0x34, 0x12]).g3_alt1()).toBe(0x123456);
        expect(packet([0x12, 0x56, 0x34]).g3_alt2()).toBe(0x123456);
        expect(packet([0x56, 0x34, 0x12]).g3s_alt1()).toBe(0x123456);
        expect(packet([0x12, 0x56, 0x34]).g3s_alt2()).toBe(0x123456);
        expect(packet([0x34, 0x12, 0x56]).g3s_alt3()).toBe(0x123456);

        expect(packet([0x12, 0x34, 0x56, 0x78]).g4s_alt1()).toBe(0x78563412);
        expect(packet([0x12, 0x34, 0x56, 0x78]).g4s_alt2()).toBe(0x56781234);
        expect(packet([0x12, 0x34, 0x56, 0x78]).g4s_alt3()).toBe(0x34127856);

        expect(packet([0x12, 0x34, 0x56, 0xf8]).g4s_alt1()).toBe(-0x07a9cbee);
        expect(packet([0x12, 0x34, 0xf8, 0x78]).g4s_alt2()).toBe(-0x0787edcc);
        expect(packet([0x12, 0xf8, 0x56, 0x78]).g4s_alt3()).toBe(-0x07ed87aa);
    });

    test('sign-extends negative signed alternate words and 24-bit values', () => {
        const cases: Array<{ name: string; bytes: number[]; expected: number; read: (packet: Packet) => number }> = [
            { name: 'g3s_alt1 minimum', bytes: [0x00, 0x00, 0x80], expected: -0x800000, read: packet => packet.g3s_alt1() },
            { name: 'g3s_alt2 minimum', bytes: [0x80, 0x00, 0x00], expected: -0x800000, read: packet => packet.g3s_alt2() },
            { name: 'g3s_alt3 minimum', bytes: [0x00, 0x80, 0x00], expected: -0x800000, read: packet => packet.g3s_alt3() },
            { name: 'g3s_alt1 negative', bytes: [0xaa, 0xcb, 0xed], expected: -0x123456, read: packet => packet.g3s_alt1() },
            { name: 'g3s_alt2 negative', bytes: [0xed, 0xaa, 0xcb], expected: -0x123456, read: packet => packet.g3s_alt2() },
            { name: 'g3s_alt3 negative', bytes: [0xcb, 0xed, 0xaa], expected: -0x123456, read: packet => packet.g3s_alt3() },
            { name: 'g2s_alt3 minimum', bytes: [0x80, 0x80], expected: -0x8000, read: packet => packet.g2s_alt3() },
            { name: 'g2s_alt3 negative', bytes: [0x4c, 0xed], expected: -0x1234, read: packet => packet.g2s_alt3() }
        ];

        for (const vector of cases) {
            const input = packet(vector.bytes);
            expect(vector.read(input), vector.name).toBe(vector.expected);
            expect(input.pos, `${vector.name} consumed bytes`).toBe(vector.bytes.length);
        }
    });

    test('copies reverse and minus-128 blocks', () => {
        const reversed = packet([0x12, 0x34, 0x56]);
        const reversedDest = new Uint8Array(5);
        reversed.gdata_alt1(reversedDest, 1, 3);
        expect([...reversedDest]).toEqual([0, 0x56, 0x34, 0x12, 0]);
        expect(reversed.pos).toBe(3);

        const minus128 = packet([0x00, 0x7f, 0x80, 0xff]);
        const minus128Dest = new Uint8Array(4);
        minus128.gdata_alt2(minus128Dest, 0, 4);
        expect([...minus128Dest]).toEqual([0x80, 0xff, 0x00, 0x7f]);
        expect(minus128.pos).toBe(4);

        const reversedMinus128 = packet([0x00, 0x7f, 0x80]);
        const reversedMinus128Dest = new Uint8Array(3);
        reversedMinus128.gdata_alt3(reversedMinus128Dest, 0, 3);
        expect([...reversedMinus128Dest]).toEqual([0x00, 0xff, 0x80]);
        expect(reversedMinus128.pos).toBe(3);
    });

    test('writes byte and word transforms that Rust packet readers decode', () => {
        const byteWriter = packet([0, 0, 0]);
        byteWriter.p1_alt1(0x34);
        byteWriter.p1_alt2(0x34);
        byteWriter.p1_alt3(0x34);
        expect([...byteWriter.data.subarray(0, byteWriter.pos)]).toEqual([0xb4, 0xcc, 0x4c]);
        expect(packet([byteWriter.data[0]]).g1_alt1()).toBe(0x34);
        expect(packet([byteWriter.data[1]]).g1_alt2()).toBe(0x34);
        expect(packet([byteWriter.data[2]]).g1_alt3()).toBe(0x34);

        const wordWriter = packet([0, 0, 0, 0, 0, 0]);
        wordWriter.p2_alt1(0x1234);
        wordWriter.p2_alt2(0x1234);
        wordWriter.p2_alt3(0x1234);
        expect([...wordWriter.data.subarray(0, wordWriter.pos)]).toEqual([0x34, 0x12, 0x12, 0xb4, 0xb4, 0x12]);
        expect(packet([wordWriter.data[0], wordWriter.data[1]]).g2_alt1()).toBe(0x1234);
        expect(packet([wordWriter.data[2], wordWriter.data[3]]).g2_alt2()).toBe(0x1234);
        expect(packet([wordWriter.data[4], wordWriter.data[5]]).g2_alt3()).toBe(0x1234);
    });
});
