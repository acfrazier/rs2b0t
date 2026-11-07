import { describe, expect, test } from 'bun:test';

import ClientPlayer, { PlayerUpdate } from '../../src/client/dash3d/ClientPlayer.js';
import { BitWriter377, PLAYER_NEW_INDEX_SENTINEL_377, decodePlayerInfo377, parsePlayerAppearance377, signed5 } from '../../src/client/dash3d/playerInfo377.js';
import Packet from '../../src/client/io/Packet.js';
import type { Descriptor, FrameRecord } from '../../tools/tap-377/format.js';
import { loadReplayRecordings } from './replay/recording.js';

function packet(bytes: number[] | Uint8Array): Packet {
    return new Packet(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
}

function encodeG2(out: number[], value: number): void {
    out.push((value >> 8) & 0xff, value & 0xff);
}

function encodeG2Alt2(out: number[], value: number): void {
    out.push((value >> 8) & 0xff, (value + 128) & 0xff);
}

function encodeG1Alt1(out: number[], value: number): void {
    out.push((value + 128) & 0xff);
}

function encodeG1Alt2(out: number[], value: number): void {
    out.push(-value & 0xff);
}

function encodeG1Alt3(out: number[], value: number): void {
    out.push((128 - value) & 0xff);
}

function encodeG4Alt2(out: number[], value: number): void {
    const raw = new Uint8Array(4);
    new DataView(raw.buffer).setInt32(0, value);
    out.push(raw[2]!, raw[3]!, raw[0]!, raw[1]!);
}

function encodeSigned5(value: number): number {
    return value & 31;
}

const PLAYER_BLOCK_MASK =
    PlayerUpdate.ANIM | PlayerUpdate.SAY | PlayerUpdate.EXACTMOVE | PlayerUpdate.FACEENTITY | PlayerUpdate.FACESQUARE | PlayerUpdate.SPOTANIM | PlayerUpdate.APPEARANCE | PlayerUpdate.HITMARK | PlayerUpdate.CHAT | PlayerUpdate.HITMARK2;

function localUpdateFrame(mask: number, body: number[]): Uint8Array {
    const bits = new BitWriter377();
    bits.write(1, 1);
    bits.write(2, 0);
    bits.write(8, 0);
    bits.write(11, PLAYER_NEW_INDEX_SENTINEL_377);
    bits.align();
    const bytes = [...bits.finish()];
    if (mask > 0xff) {
        bytes.push((mask & 0xff) | PlayerUpdate.BIG_UPDATE);
        bytes.push((mask >> 8) & 0xff);
    } else {
        bytes.push(mask & 0xff);
    }
    bytes.push(...body);
    return Uint8Array.from(bytes);
}

function appearanceBytesForTest(): number[] {
    const bytes = [1, 0xfe, 0xff];
    bytes.push(...new Array(12).fill(0));
    bytes.push(0, 1, 2, 3, 4);
    for (const sequence of [65535, 1, 65535, 2, 3, 4, 5]) {
        encodeG2(bytes, sequence);
    }
    const name = 0x0102_0304_0506_0708n;
    for (let shift = 56; shift >= 0; shift -= 8) {
        bytes.push(Number((name >> BigInt(shift)) & 0xffn));
    }
    bytes.push(99);
    encodeG2(bytes, 1200);
    return bytes;
}

function frameBody(hex: string, descriptor: Descriptor): Uint8Array {
    const bytes = Buffer.from(hex, 'hex');
    if (bytes[0] !== descriptor.id) {
        throw new Error('frame opcode differs from PLAYER_INFO');
    }
    if (descriptor.length !== -2) {
        throw new Error('PLAYER_INFO length is not -2');
    }
    const bodyLength = (bytes[1]! << 8) | bytes[2]!;
    return bytes.subarray(3, 3 + bodyLength);
}

describe('377 player info', () => {
    test('mask bits match Java getPlayerExtendedInfo', () => {
        expect(PlayerUpdate.FACEENTITY).toBe(0x1);
        expect(PlayerUpdate.FACESQUARE).toBe(0x2);
        expect(PlayerUpdate.APPEARANCE).toBe(0x4);
        expect(PlayerUpdate.ANIM).toBe(0x8);
        expect(PlayerUpdate.SAY).toBe(0x10);
        expect(PlayerUpdate.BIG_UPDATE).toBe(0x20);
        expect(PlayerUpdate.CHAT).toBe(0x40);
        expect(PlayerUpdate.HITMARK2).toBe(0x80);
        expect(PlayerUpdate.EXACTMOVE).toBe(0x100);
        expect(PlayerUpdate.SPOTANIM).toBe(0x200);
        expect(PlayerUpdate.HITMARK).toBe(0x400);
    });

    test('setAppearance reads two signed head-icon bytes and not a 289 bitmask', () => {
        const appearance = appearanceBytesForTest();
        const player = new ClientPlayer();
        player.setAppearance(packet(appearance));
        expect(player.gender).toBe(1);
        expect(player.headiconPk).toBe(-2);
        expect(player.headiconPrayer).toBe(-1);
        expect(player.combatLevel).toBe(99);
        expect(player.skillLevel).toBe(1200);
        expect(player.readyanim).toBe(-1);
        expect(player.turnanim).toBe(1);
        expect(player.team).toBe(0);
        expect(player.ready).toBe(true);
    });

    test('local movement decodes idle walk run and teleport bit order', () => {
        for (const operation of [0, 1, 2, 3]) {
            const bits = new BitWriter377();
            bits.write(1, 1);
            bits.write(2, operation);
            if (operation === 1) {
                bits.write(3, 6);
                bits.write(1, 0);
            } else if (operation === 2) {
                bits.write(3, 2);
                bits.write(3, 7);
                bits.write(1, 0);
            } else if (operation === 3) {
                bits.write(1, 1);
                bits.write(2, 3);
                bits.write(7, 91);
                bits.write(7, 37);
                bits.write(1, 0);
            }
            bits.write(8, 0);
            bits.write(11, PLAYER_NEW_INDEX_SENTINEL_377);
            bits.align();
            const bytes = [...bits.finish()];
            if (operation === 0) {
                bytes.push(0);
            }
            const decoded = decodePlayerInfo377(packet(bytes));
            if (operation === 0) {
                expect(decoded.localMovement).toBeNull();
                expect(decoded.updates).toHaveLength(1);
                expect(decoded.updates[0]?.actor).toEqual({ kind: 'local' });
            } else if (operation === 1) {
                expect(decoded.localMovement).toEqual({ kind: 'step', firstDirection: 6, secondDirection: null });
            } else if (operation === 2) {
                expect(decoded.localMovement).toEqual({ kind: 'step', firstDirection: 2, secondDirection: 7 });
            } else {
                expect(decoded.localMovement).toEqual({ kind: 'teleport', plane: 3, x: 37, z: 91, jump: true });
            }
        }
    });

    test('old-visible idle update walk run and removal keep ordinals', () => {
        const bits = new BitWriter377();
        bits.write(1, 0);
        bits.write(8, 5);
        bits.write(1, 0);
        bits.write(1, 1);
        bits.write(2, 0);
        bits.write(1, 1);
        bits.write(2, 1);
        bits.write(3, 4);
        bits.write(1, 0);
        bits.write(1, 1);
        bits.write(2, 2);
        bits.write(3, 1);
        bits.write(3, 7);
        bits.write(1, 1);
        bits.write(1, 1);
        bits.write(2, 3);
        bits.write(11, PLAYER_NEW_INDEX_SENTINEL_377);
        bits.align();
        const bytes = [...bits.finish(), 0, 0];
        const decoded = decodePlayerInfo377(packet(bytes));
        expect(decoded.oldVisibleCount).toBe(5);
        expect(decoded.oldVisible[0]?.removed).toBe(false);
        expect(decoded.oldVisible[0]?.movement).toBeNull();
        expect(decoded.oldVisible[2]?.movement).toEqual({ kind: 'step', firstDirection: 4, secondDirection: null });
        expect(decoded.oldVisible[3]?.movement).toEqual({ kind: 'step', firstDirection: 1, secondDirection: 7 });
        expect(decoded.oldVisible[4]?.removed).toBe(true);
        expect(decoded.updates[0]?.actor).toEqual({ kind: 'old', ordinal: 1 });
        expect(decoded.updates[1]?.actor).toEqual({ kind: 'old', ordinal: 3 });
    });

    test('new-player offsets are signed and the stop sentinel is not added', () => {
        const bits = new BitWriter377();
        bits.write(1, 0);
        bits.write(8, 0);
        bits.write(11, 7);
        bits.write(5, encodeSigned5(-16));
        bits.write(1, 0);
        bits.write(1, 1);
        bits.write(5, encodeSigned5(15));
        bits.write(11, PLAYER_NEW_INDEX_SENTINEL_377);
        bits.align();
        const decoded = decodePlayerInfo377(packet(bits.finish()));
        expect(decoded.additions).toHaveLength(1);
        expect(decoded.additions[0]?.index).toBe(7);
        expect(decoded.additions[0]?.movement).toEqual({ kind: 'offset', dx: -16, dz: 15, jump: true });
        expect(signed5(encodeSigned5(-16))).toBe(-16);
        expect(signed5(encodeSigned5(15))).toBe(15);
    });

    test('every mask block decodes in Java wire order with alt transforms', () => {
        const body: number[] = [];
        encodeG2(body, 0x1234);
        encodeG1Alt3(body, 9);
        body.push(...Buffer.from('hey\n'));
        encodeG1Alt1(body, 3);
        encodeG1Alt2(body, 4);
        encodeG1Alt3(body, 5);
        body.push(6);
        encodeG2(body, 0x0102);
        encodeG2Alt2(body, 0x0304);
        body.push(7);
        encodeG2Alt2(body, 5);
        encodeG2(body, 0x1122);
        encodeG2(body, 0x3344);
        encodeG2Alt2(body, 2);
        encodeG4Alt2(body, 0xfffe1234 << 0);
        const appearance = appearanceBytesForTest();
        body.push(appearance.length);
        body.push(...[...appearance].reverse());
        encodeG1Alt1(body, 10);
        encodeG1Alt3(body, 11);
        encodeG1Alt2(body, 12);
        body.push(13);
        encodeG2(body, 0xa1b2);
        encodeG1Alt2(body, 2);
        encodeG1Alt1(body, 3);
        body.push(0x81, 0x00, 0x7f);
        encodeG1Alt3(body, 14);
        encodeG1Alt2(body, 15);
        encodeG1Alt3(body, 16);
        body.push(17);

        const decoded = decodePlayerInfo377(packet(localUpdateFrame(PLAYER_BLOCK_MASK | PlayerUpdate.BIG_UPDATE, body)));
        expect(decoded.updates).toHaveLength(1);
        expect(decoded.updates[0]?.actor).toEqual({ kind: 'local' });
        const blocks = decoded.updates[0]!.blocks;
        expect(blocks.map(block => block.kind)).toEqual(['anim', 'say', 'exactMove', 'faceEntity', 'faceCoordinate', 'spotanim', 'appearance', 'damage', 'chat', 'damage2']);
        expect(blocks[0]).toEqual({ kind: 'anim', seqId: 0x1234, delay: 9 });
        expect(blocks[1]).toEqual({ kind: 'say', text: 'hey' });
        expect(blocks[2]).toEqual({
            kind: 'exactMove',
            startX: 3,
            startZ: 4,
            endX: 5,
            endZ: 6,
            startDelay: 0x0102,
            endDelay: 0x0304,
            direction: 7
        });
        expect(blocks[3]).toEqual({ kind: 'faceEntity', wireValue: 5 });
        expect(blocks[4]).toEqual({ kind: 'faceCoordinate', x: 0x1122, z: 0x3344 });
        expect(blocks[5]).toEqual({ kind: 'spotanim', id: 2, height: -2, delay: 0x1234 });
        const appearanceBlock = blocks[6];
        if (appearanceBlock?.kind !== 'appearance') {
            throw new Error('expected appearance block');
        }
        expect(appearanceBlock.appearance.gender).toBe(1);
        expect(appearanceBlock.appearance.headiconPk).toBe(-2);
        expect(appearanceBlock.appearance.headiconPrayer).toBe(-1);
        expect(appearanceBlock.appearance.equipment).toEqual(new Array(12).fill(0));
        expect(appearanceBlock.appearance.colours).toEqual([0, 1, 2, 3, 4]);
        expect(appearanceBlock.appearance.sequences).toEqual([-1, 1, -1, 2, 3, 4, 5]);
        expect(appearanceBlock.appearance.usernameBase37).toBe(0x0102_0304_0506_0708n);
        expect(appearanceBlock.appearance.combatLevel).toBe(99);
        expect(appearanceBlock.appearance.skillLevel).toBe(1200);
        expect(blocks[7]).toEqual({ kind: 'damage', amount: 10, type: 11, health: 12, totalHealth: 13 });
        const chat = blocks[8];
        if (chat?.kind !== 'chat') {
            throw new Error('expected chat block');
        }
        expect(chat.colour).toBe(0xa1);
        expect(chat.effect).toBe(0xb2);
        expect(chat.rights).toBe(2);
        expect([...chat.packed]).toEqual([1, 128, 255]);
        expect(blocks[9]).toEqual({ kind: 'damage2', amount: 14, type: 15, health: 16, totalHealth: 17 });
    });

    test('animation and spotanim 65535 sentinels decode as -1', () => {
        const body: number[] = [];
        encodeG2(body, 65535);
        encodeG1Alt3(body, 0);
        encodeG2Alt2(body, 65535);
        encodeG4Alt2(body, 0);
        const decoded = decodePlayerInfo377(packet(localUpdateFrame(PlayerUpdate.ANIM | PlayerUpdate.SPOTANIM, body)));
        expect(decoded.updates[0]?.blocks).toEqual([
            { kind: 'anim', seqId: -1, delay: 0 },
            { kind: 'spotanim', id: -1, height: 0, delay: 0 }
        ]);
    });

    test('appearance trailing bytes fail closed and truncation throws', () => {
        const short = appearanceBytesForTest();
        short.pop();
        const shortBody = [short.length, ...[...short].reverse()];
        expect(() => decodePlayerInfo377(packet(localUpdateFrame(PlayerUpdate.APPEARANCE, shortBody)))).toThrow();

        const long = appearanceBytesForTest();
        long.push(0);
        const longBody = [long.length, ...[...long].reverse()];
        expect(() => decodePlayerInfo377(packet(localUpdateFrame(PlayerUpdate.APPEARANCE, longBody)))).toThrow('appearance_block_trailing_bytes');
    });

    test('appearance transmog branch stops equipment after the 65535 prefix', () => {
        const appearance = [2, 1, 0, 0xff, 0xff];
        encodeG2(appearance, 77);
        appearance.push(1, 2, 3, 4, 5);
        for (let i = 0; i < 7; i++) {
            encodeG2(appearance, 65535);
        }
        appearance.push(0, 0, 0, 0, 0, 0, 0, 0, 1);
        encodeG2(appearance, 2);
        const parsed = parsePlayerAppearance377(Uint8Array.from(appearance));
        expect(parsed.equipment[0]).toBe(65535);
        expect(parsed.equipment.slice(1).every(part => part === undefined)).toBe(true);
        expect(parsed.npcTransform).toBe(77);
        expect(parsed.headiconPk).toBe(1);
        expect(parsed.headiconPrayer).toBe(0);
    });

    test('377 recordings decode PLAYER_INFO payloads through the 377 handler', () => {
        const recordings = loadReplayRecordings(377);
        const playerInfo = recordings[0]!.protocol.server.find(descriptor => descriptor.name === 'PLAYER_INFO');
        if (!playerInfo) {
            throw new Error('377 protocol has no PLAYER_INFO');
        }
        expect(playerInfo.id).toBe(90);
        expect(playerInfo.length).toBe(-2);
        let frames = 0;
        for (const recording of recordings) {
            for (const record of recording.records) {
                if (record.type !== 'frame' || record.direction !== 'in') {
                    continue;
                }
                const frame = record as FrameRecord;
                const bytes = Buffer.from(frame.bytes, 'hex');
                if (bytes[0] !== playerInfo.id) {
                    continue;
                }
                const body = frameBody(frame.bytes, playerInfo);
                decodePlayerInfo377(packet(body), body.length);
                frames++;
            }
        }
        expect(frames).toBeGreaterThan(0);
    });
});
