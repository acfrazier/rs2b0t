import { describe, expect, test } from 'bun:test';

import ClientPlayer, { PlayerUpdate } from '../../src/client/dash3d/ClientPlayer.js';
import Packet from '../../src/client/io/Packet.js';
import { Client } from '../../src/client/shell/Client.js';
import type { Descriptor, FrameRecord, LoginRecord, CheckpointRecord } from '../../tools/tap-377/format.js';
import { BitWriter377, encodeSigned5, signed5 } from './bitWriter377.js';
import { freshClient, runPlayerInfo, seedPlayers, useInfoStubs } from './infoClient377.js';
import { loadReplayRecordings } from './replay/recording.js';

useInfoStubs();

const PLAYER_NEW_INDEX_SENTINEL_377 = 2047;

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
        player.setAppearance(new Packet(Uint8Array.from(appearance)));
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
            const client = freshClient();
            client.localPlayer.routeX[0] = 10;
            client.localPlayer.routeZ[0] = 10;
            client.ptype = 90;
            runPlayerInfo(client, Uint8Array.from(bytes));
            expect(client.ptype).toBe(-1);
            if (operation === 0) {
                expect(client.localPlayer.routeX[0]).toBe(10);
                expect(client.localPlayer.routeZ[0]).toBe(10);
            } else if (operation === 1) {
                expect(client.localPlayer.routeX[0]).toBe(10);
                expect(client.localPlayer.routeZ[0]).toBe(9);
            } else if (operation === 2) {
                expect(client.localPlayer.routeX[0]).toBe(12);
                expect(client.localPlayer.routeZ[0]).toBe(10);
            } else {
                expect(client.minusedlevel).toBe(3);
                expect(client.localPlayer.routeX[0]).toBe(37);
                expect(client.localPlayer.routeZ[0]).toBe(91);
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
        const client = freshClient();
        seedPlayers(client, 5);
        runPlayerInfo(client, Uint8Array.from([...bits.finish(), 0, 0]));
        expect(client.playerCount).toBe(4);
        expect(client.playerIds[0]).toBe(1);
        expect(client.players[1]?.routeX[0]).toBe(10);
        expect(client.players[3]?.routeX[0]).toBe(11);
        expect(client.players[3]?.routeZ[0]).toBe(10);
        expect(client.players[4]?.routeX[0]).toBe(11);
        expect(client.players[4]?.routeZ[0]).toBe(10);
        expect(client.players[5]?.cycle).not.toBe(Client.loopCycle);
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
        const client = freshClient();
        runPlayerInfo(client, bits.finish());
        expect(client.playerCount).toBe(1);
        expect(client.playerIds[0]).toBe(7);
        expect(client.players[7]?.routeX[0]).toBe(-16);
        expect(client.players[7]?.routeZ[0]).toBe(15);
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

        const client = freshClient();
        runPlayerInfo(client, localUpdateFrame(PLAYER_BLOCK_MASK | PlayerUpdate.BIG_UPDATE, body));
        const player = client.localPlayer;
        expect(player.primaryAnim).toBe(0x1234);
        expect(player.primaryAnimDelay).toBe(9);
        expect(player.chatColour).toBe(0xa1);
        expect(player.chatEffect).toBe(0xb2);
        expect(player.exactStartX).toBe(3);
        expect(player.exactStartZ).toBe(4);
        expect(player.exactEndX).toBe(5);
        expect(player.exactEndZ).toBe(6);
        expect(player.exactMoveEnd).toBe(0x0102 + Client.loopCycle);
        expect(player.exactMoveStart).toBe(0x0304 + Client.loopCycle);
        expect(player.exactMoveFacing).toBe(7);
        expect(player.faceEntity).toBe(5);
        expect(player.faceSquareX).toBe(0x1122);
        expect(player.faceSquareZ).toBe(0x3344);
        expect(player.spotanimId).toBe(2);
        expect(player.headiconPk).toBe(-2);
        expect(player.headiconPrayer).toBe(-1);
        expect(player.gender).toBe(1);
        expect(player.combatLevel).toBe(99);
        expect(player.skillLevel).toBe(1200);
        expect(player.damageValues[0]).toBe(10);
        expect(player.damageTypes[0]).toBe(11);
        expect(player.health).toBe(16);
        expect(player.totalHealth).toBe(17);
        expect(player.combatCycle).toBe(Client.loopCycle + 300);
        expect(player.damageValues[1]).toBe(14);
        expect(player.damageTypes[1]).toBe(15);
    });

    test('say block sets chatMessage from gjstr', () => {
        const client = freshClient();
        runPlayerInfo(client, localUpdateFrame(PlayerUpdate.SAY, [...Buffer.from('hey\n')]));
        expect(client.localPlayer.chatMessage).toBe('hey');
        expect(client.localPlayer.chatTimer).toBe(150);
    });

    test('animation and spotanim 65535 sentinels decode as -1', () => {
        const body: number[] = [];
        encodeG2(body, 65535);
        encodeG1Alt3(body, 0);
        encodeG2Alt2(body, 65535);
        encodeG4Alt2(body, 0);
        const client = freshClient();
        runPlayerInfo(client, localUpdateFrame(PlayerUpdate.ANIM | PlayerUpdate.SPOTANIM, body));
        expect(client.localPlayer.primaryAnim).toBe(-1);
        expect(client.localPlayer.spotanimId).toBe(-1);
    });

    test('face-entity 65535 sentinel and 32768+2047 player slot', () => {
        const absentBody: number[] = [];
        encodeG2Alt2(absentBody, 65535);
        const absent = freshClient();
        runPlayerInfo(absent, localUpdateFrame(PlayerUpdate.FACEENTITY, absentBody));
        expect(absent.localPlayer.faceEntity).toBe(-1);

        const body: number[] = [];
        encodeG2Alt2(body, 32768 + 2047);
        const client = freshClient();
        runPlayerInfo(client, localUpdateFrame(PlayerUpdate.FACEENTITY, body));
        expect(client.localPlayer.faceEntity).toBe(32768 + 2047);
    });

    test('appearance trailing bytes fail closed and truncation throws', () => {
        const short = appearanceBytesForTest();
        short.pop();
        const shortBody = [short.length, ...[...short].reverse()];
        expect(() => runPlayerInfo(freshClient(), localUpdateFrame(PlayerUpdate.APPEARANCE, shortBody))).toThrow();

        const long = appearanceBytesForTest();
        long.push(0);
        const longBody = [long.length, ...[...long].reverse()];
        expect(() => runPlayerInfo(freshClient(), localUpdateFrame(PlayerUpdate.APPEARANCE, longBody))).toThrow();
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
        const body = [appearance.length, ...[...appearance].reverse()];
        const client = freshClient();
        runPlayerInfo(client, localUpdateFrame(PlayerUpdate.APPEARANCE, body));
        expect(client.localPlayer.appearance[0]).toBe(65535);
        expect(client.localPlayer.transmog?.id).toBe(77);
        expect(client.localPlayer.headiconPk).toBe(1);
        expect(client.localPlayer.headiconPrayer).toBe(0);
    });

    test('frame truncation trailing bytes and old-visible count mismatch are rejected', () => {
        expect(() => runPlayerInfo(freshClient(), Uint8Array.from([0]))).toThrow();

        const trailing = localUpdateFrame(0, []);
        const withTrail = Uint8Array.from([...trailing, 0]);
        const trailClient = freshClient();
        trailClient.ptype = 90;
        expect(() => runPlayerInfo(trailClient, withTrail)).toThrow();
        expect(trailClient.ptype).toBe(90);

        const bits = new BitWriter377();
        bits.write(1, 0);
        bits.write(8, 2);
        bits.write(1, 0);
        bits.write(1, 0);
        bits.write(11, PLAYER_NEW_INDEX_SENTINEL_377);
        bits.align();
        const mismatch = freshClient();
        seedPlayers(mismatch, 1);
        expect(() => runPlayerInfo(mismatch, bits.finish())).toThrow();
    });

    test('377 recordings decode PLAYER_INFO payloads through getPlayerPos', () => {
        const recordings = loadReplayRecordings(377);
        const playerInfo = recordings[0]!.protocol.server.find(descriptor => descriptor.name === 'PLAYER_INFO');
        if (!playerInfo) {
            throw new Error('377 protocol has no PLAYER_INFO');
        }
        expect(playerInfo.id).toBe(90);
        expect(playerInfo.length).toBe(-2);
        let frames = 0;
        let checkpointsCompared = 0;
        let checkpointMismatches = 0;
        for (const recording of recordings) {
            let client = freshClient();
            for (const record of recording.records) {
                if (record.type === 'login') {
                    if (!(record as LoginRecord).reconnect) {
                        client = freshClient();
                    }
                    continue;
                }
                if (record.type === 'checkpoint') {
                    const checkpoint = record as CheckpointRecord;
                    if (checkpoint.state.ingame) {
                        checkpointsCompared++;
                        const x = checkpoint.state.mapBuildBaseX + client.localPlayer.routeX[0];
                        const z = checkpoint.state.mapBuildBaseZ + client.localPlayer.routeZ[0];
                        if (x !== checkpoint.state.serverTile.x || z !== checkpoint.state.serverTile.z || client.minusedlevel !== checkpoint.state.serverTile.level) {
                            checkpointMismatches++;
                        }
                    }
                    continue;
                }
                if (record.type !== 'frame' || record.direction !== 'in') {
                    continue;
                }
                const frame = record as FrameRecord;
                const bytes = Buffer.from(frame.bytes, 'hex');
                if (bytes[0] !== playerInfo.id) {
                    continue;
                }
                const body = frameBody(frame.bytes, playerInfo);
                Client.loopCycle++;
                runPlayerInfo(client, body);
                frames++;
            }
        }
        expect(frames).toBeGreaterThan(0);
        expect(checkpointsCompared).toBeGreaterThan(0);
        expect(checkpointMismatches).toBe(0);
    });
});
