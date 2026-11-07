import { describe, expect, test } from 'bun:test';

import { NpcUpdate } from '../../src/client/dash3d/ClientNpc.js';
import { decodeNpcInfo377, NPC_NEW_INDEX_SENTINEL_377 } from '../../src/client/dash3d/npcInfo377.js';
import { BitWriter377, signed5 } from '../../src/client/dash3d/playerInfo377.js';
import Packet from '../../src/client/io/Packet.js';
import type { Descriptor, FrameRecord } from '../../tools/tap-377/format.js';
import { loadReplayRecordings } from './replay/recording.js';

function packet(bytes: number[] | Uint8Array): Packet {
    return new Packet(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
}

function encodeG2(out: number[], value: number): void {
    out.push((value >> 8) & 0xff, value & 0xff);
}

function encodeG2Alt1(out: number[], value: number): void {
    out.push(value & 0xff, (value >> 8) & 0xff);
}

function encodeG2Alt2(out: number[], value: number): void {
    out.push((value >> 8) & 0xff, (value + 128) & 0xff);
}

function encodeG2Alt3(out: number[], value: number): void {
    out.push((value + 128) & 0xff, (value >> 8) & 0xff);
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

const NPC_BLOCK_MASK = NpcUpdate.CHANGETYPE | NpcUpdate.FACEENTITY | NpcUpdate.HITMARK | NpcUpdate.SPOTANIM | NpcUpdate.SAY | NpcUpdate.FACESQUARE | NpcUpdate.ANIM | NpcUpdate.HITMARK2;

function oldUpdateFrame(mask: number, body: number[]): Uint8Array {
    const bits = new BitWriter377();
    bits.write(8, 1);
    bits.write(1, 1);
    bits.write(2, 0);
    bits.write(14, NPC_NEW_INDEX_SENTINEL_377);
    bits.align();
    const bytes = [...bits.finish(), mask & 0xff, ...body];
    return Uint8Array.from(bytes);
}

function frameBody(hex: string, descriptor: Descriptor): Uint8Array {
    const bytes = Buffer.from(hex, 'hex');
    if (bytes[0] !== descriptor.id) {
        throw new Error('frame opcode differs from NPC_INFO');
    }
    if (descriptor.length !== -2) {
        throw new Error('NPC_INFO length is not -2');
    }
    const bodyLength = (bytes[1]! << 8) | bytes[2]!;
    return bytes.subarray(3, 3 + bodyLength);
}

describe('377 npc info', () => {
    test('mask bits match Java getNpcPosExtended', () => {
        expect(NpcUpdate.CHANGETYPE).toBe(0x1);
        expect(NpcUpdate.ANIM).toBe(0x2);
        expect(NpcUpdate.SPOTANIM).toBe(0x4);
        expect(NpcUpdate.FACESQUARE).toBe(0x8);
        expect(NpcUpdate.HITMARK2).toBe(0x10);
        expect(NpcUpdate.SAY).toBe(0x20);
        expect(NpcUpdate.FACEENTITY).toBe(0x40);
        expect(NpcUpdate.HITMARK).toBe(0x80);
        expect(NPC_BLOCK_MASK).toBe(0xff);
    });

    test('old-visible idle update walk run and removal keep ordinals', () => {
        const bits = new BitWriter377();
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
        bits.write(14, NPC_NEW_INDEX_SENTINEL_377);
        bits.align();
        const decoded = decodeNpcInfo377(packet([...bits.finish(), 0, 0]));
        expect(decoded.oldVisibleCount).toBe(5);
        expect(decoded.oldVisible[0]?.movement).toBeNull();
        expect(decoded.oldVisible[2]?.movement).toEqual({ kind: 'step', firstDirection: 4, secondDirection: null });
        expect(decoded.oldVisible[3]?.movement).toEqual({ kind: 'step', firstDirection: 1, secondDirection: 7 });
        expect(decoded.oldVisible[4]?.removed).toBe(true);
        expect(decoded.updates[0]?.actor).toEqual({ kind: 'old', ordinal: 1 });
        expect(decoded.updates[1]?.actor).toEqual({ kind: 'old', ordinal: 3 });
    });

    test('new-npc signed offsets definition and stop sentinel decode', () => {
        const bits = new BitWriter377();
        bits.write(8, 0);
        bits.write(14, 10);
        bits.write(1, 1);
        bits.write(5, encodeSigned5(-16));
        bits.write(5, encodeSigned5(15));
        bits.write(1, 1);
        bits.write(13, 321);
        bits.write(14, NPC_NEW_INDEX_SENTINEL_377);
        bits.align();
        const decoded = decodeNpcInfo377(packet([...bits.finish(), 0]));
        expect(decoded.additions).toHaveLength(1);
        expect(decoded.updates[0]?.actor).toEqual({ kind: 'new', index: 10 });
        expect(decoded.updates[0]?.blocks).toEqual([]);
        expect(decoded.additions[0]?.index).toBe(10);
        expect(decoded.additions[0]?.typeId).toBe(321);
        expect(decoded.additions[0]?.movement).toEqual({ kind: 'offset', dx: 15, dz: -16, jump: true });
        expect(signed5(encodeSigned5(-16))).toBe(-16);
    });

    test('every mask block decodes in Java wire order with alt transforms', () => {
        const body: number[] = [];
        encodeG2Alt2(body, 77);
        encodeG2Alt1(body, 6);
        encodeG1Alt1(body, 10);
        encodeG1Alt1(body, 11);
        body.push(12);
        encodeG1Alt3(body, 13);
        encodeG2(body, 4);
        encodeG4Alt2(body, 0xfffd4567 << 0);
        body.push(...Buffer.from('yo\n'));
        encodeG2Alt3(body, 0x1122);
        encodeG2Alt1(body, 0x3344);
        encodeG2(body, 7);
        encodeG1Alt3(body, 8);
        encodeG1Alt3(body, 14);
        encodeG1Alt3(body, 15);
        body.push(16);
        encodeG1Alt2(body, 17);

        const decoded = decodeNpcInfo377(packet(oldUpdateFrame(NPC_BLOCK_MASK, body)));
        expect(decoded.updates[0]?.blocks.map(block => block.kind)).toEqual(['changeType', 'faceEntity', 'damage', 'spotanim', 'say', 'faceCoordinate', 'anim', 'damage2']);
        const blocks = decoded.updates[0]!.blocks;
        expect(blocks[0]).toEqual({ kind: 'changeType', typeId: 77 });
        expect(blocks[1]).toEqual({ kind: 'faceEntity', wireValue: 6 });
        expect(blocks[2]).toEqual({ kind: 'damage', amount: 10, type: 11, health: 12, totalHealth: 13 });
        expect(blocks[3]).toEqual({ kind: 'spotanim', id: 4, height: -3, delay: 0x4567 });
        expect(blocks[4]).toEqual({ kind: 'say', text: 'yo' });
        expect(blocks[5]).toEqual({ kind: 'faceCoordinate', x: 0x1122, z: 0x3344 });
        expect(blocks[6]).toEqual({ kind: 'anim', seqId: 7, delay: 8 });
        expect(blocks[7]).toEqual({ kind: 'damage2', amount: 14, type: 15, health: 16, totalHealth: 17 });
    });

    test('face-entity 65535 sentinel decodes as 65535 wire and animation sentinels are -1', () => {
        const decodedFace = decodeNpcInfo377(packet(oldUpdateFrame(NpcUpdate.FACEENTITY, [0xff, 0xff])));
        expect(decodedFace.updates[0]?.blocks).toEqual([{ kind: 'faceEntity', wireValue: 65535 }]);

        const body: number[] = [];
        encodeG2(body, 65535);
        encodeG4Alt2(body, 0);
        encodeG2(body, 65535);
        encodeG1Alt3(body, 0);
        const decoded = decodeNpcInfo377(packet(oldUpdateFrame(NpcUpdate.SPOTANIM | NpcUpdate.ANIM, body)));
        expect(decoded.updates[0]?.blocks).toEqual([
            { kind: 'spotanim', id: -1, height: 0, delay: 0 },
            { kind: 'anim', seqId: -1, delay: 0 }
        ]);
    });

    test('377 recordings decode NPC_INFO payloads through the 377 handler', () => {
        const recordings = loadReplayRecordings(377);
        const npcInfo = recordings[0]!.protocol.server.find(descriptor => descriptor.name === 'NPC_INFO');
        if (!npcInfo) {
            throw new Error('377 protocol has no NPC_INFO');
        }
        expect(npcInfo.id).toBe(71);
        expect(npcInfo.length).toBe(-2);
        let frames = 0;
        for (const recording of recordings) {
            for (const record of recording.records) {
                if (record.type !== 'frame' || record.direction !== 'in') {
                    continue;
                }
                const frame = record as FrameRecord;
                const bytes = Buffer.from(frame.bytes, 'hex');
                if (bytes[0] !== npcInfo.id) {
                    continue;
                }
                const body = frameBody(frame.bytes, npcInfo);
                decodeNpcInfo377(packet(body), body.length);
                frames++;
            }
        }
        expect(frames).toBeGreaterThan(0);
    });
});
