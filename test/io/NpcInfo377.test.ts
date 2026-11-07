import { describe, expect, test } from 'bun:test';

import { NpcUpdate } from '../../src/client/dash3d/ClientNpc.js';
import { Client } from '../../src/client/shell/Client.js';
import type { Descriptor, FrameRecord, LoginRecord } from '../../tools/tap-377/format.js';
import { BitWriter377, encodeSigned5, signed5 } from './bitWriter377.js';
import { freshClient, runNpcInfo, seedNpcs, useInfoStubs } from './infoClient377.js';
import { loadReplayRecordings } from './replay/recording.js';

useInfoStubs();

const NPC_NEW_INDEX_SENTINEL_377 = 16383;

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

const NPC_BLOCK_MASK = NpcUpdate.CHANGETYPE | NpcUpdate.FACEENTITY | NpcUpdate.HITMARK | NpcUpdate.SPOTANIM | NpcUpdate.SAY | NpcUpdate.FACESQUARE | NpcUpdate.ANIM | NpcUpdate.HITMARK2;

function oldUpdateFrame(mask: number, body: number[]): Uint8Array {
    const bits = new BitWriter377();
    bits.write(8, 1);
    bits.write(1, 1);
    bits.write(2, 0);
    bits.write(14, NPC_NEW_INDEX_SENTINEL_377);
    bits.align();
    return Uint8Array.from([...bits.finish(), mask & 0xff, ...body]);
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
        const client = freshClient();
        seedNpcs(client, 5);
        runNpcInfo(client, Uint8Array.from([...bits.finish(), 0, 0]));
        expect(client.npcCount).toBe(4);
        expect(client.npcIds[0]).toBe(1);
        expect(client.npc[1]?.routeX[0]).toBe(10);
        expect(client.npc[3]?.routeX[0]).toBe(11);
        expect(client.npc[3]?.routeZ[0]).toBe(10);
        expect(client.npc[4]?.routeX[0]).toBe(11);
        expect(client.npc[4]?.routeZ[0]).toBe(10);
        expect(client.npc[5]?.cycle).not.toBe(Client.loopCycle);
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
        const client = freshClient();
        runNpcInfo(client, Uint8Array.from([...bits.finish(), 0]));
        expect(client.npcCount).toBe(1);
        expect(client.npcIds[0]).toBe(10);
        expect(client.npc[10]?.type?.id).toBe(321);
        expect(client.npc[10]?.routeX[0]).toBe(15);
        expect(client.npc[10]?.routeZ[0]).toBe(-16);
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

        const client = freshClient();
        seedNpcs(client, 1);
        runNpcInfo(client, oldUpdateFrame(NPC_BLOCK_MASK, body));
        const npc = client.npc[1];
        expect(npc?.type?.id).toBe(77);
        expect(npc?.faceEntity).toBe(6);
        expect(npc?.damageValues[0]).toBe(10);
        expect(npc?.damageTypes[0]).toBe(11);
        expect(npc?.spotanimId).toBe(4);
        expect(npc?.chatMessage).toBe('yo');
        expect(npc?.faceSquareX).toBe(0x1122);
        expect(npc?.faceSquareZ).toBe(0x3344);
        expect(npc?.primaryAnim).toBe(7);
        expect(npc?.primaryAnimDelay).toBe(8);
        expect(npc?.health).toBe(16);
        expect(npc?.totalHealth).toBe(17);
        expect(npc?.damageValues[1]).toBe(14);
        expect(npc?.damageTypes[1]).toBe(15);
        expect(npc?.combatCycle).toBe(Client.loopCycle + 300);
    });

    test('face-entity 65535 sentinel decodes as -1 and animation sentinels are -1', () => {
        const face = freshClient();
        seedNpcs(face, 1);
        runNpcInfo(face, oldUpdateFrame(NpcUpdate.FACEENTITY, [0xff, 0xff]));
        expect(face.npc[1]?.faceEntity).toBe(-1);

        const body: number[] = [];
        encodeG2(body, 65535);
        encodeG4Alt2(body, 0);
        encodeG2(body, 65535);
        encodeG1Alt3(body, 0);
        const client = freshClient();
        seedNpcs(client, 1);
        runNpcInfo(client, oldUpdateFrame(NpcUpdate.SPOTANIM | NpcUpdate.ANIM, body));
        expect(client.npc[1]?.spotanimId).toBe(-1);
        expect(client.npc[1]?.primaryAnim).toBe(-1);
    });

    test('frame truncation trailing bytes and old-visible count mismatch are rejected', () => {
        expect(() => runNpcInfo(freshClient(), Uint8Array.from([1]))).toThrow();

        const trailing = Uint8Array.from([0, 0]);
        expect(() => runNpcInfo(freshClient(), trailing)).toThrow();

        const bits = new BitWriter377();
        bits.write(8, 1);
        bits.write(1, 0);
        bits.write(14, NPC_NEW_INDEX_SENTINEL_377);
        bits.align();
        const mismatch = freshClient();
        expect(() => runNpcInfo(mismatch, bits.finish())).toThrow();
    });

    test('377 recordings decode NPC_INFO payloads through getNpcPos', () => {
        const recordings = loadReplayRecordings(377);
        const npcInfo = recordings[0]!.protocol.server.find(descriptor => descriptor.name === 'NPC_INFO');
        if (!npcInfo) {
            throw new Error('377 protocol has no NPC_INFO');
        }
        expect(npcInfo.id).toBe(71);
        expect(npcInfo.length).toBe(-2);
        let frames = 0;
        for (const recording of recordings) {
            let client = freshClient();
            for (const record of recording.records) {
                if (record.type === 'login') {
                    if (!(record as LoginRecord).reconnect) {
                        client = freshClient();
                    }
                    continue;
                }
                if (record.type !== 'frame' || record.direction !== 'in') {
                    continue;
                }
                const frame = record as FrameRecord;
                const bytes = Buffer.from(frame.bytes, 'hex');
                if (bytes[0] !== npcInfo.id) {
                    continue;
                }
                const body = frameBody(frame.bytes, npcInfo);
                Client.loopCycle++;
                runNpcInfo(client, body);
                frames++;
            }
        }
        expect(frames).toBeGreaterThan(0);
    });
});
