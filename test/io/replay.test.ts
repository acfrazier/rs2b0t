import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, mock, test } from 'bun:test';

import { CLIENT_VERSION } from '#/client/io/ClientProt.js';
import { assertPacketConsumed } from '#/client/io/packetGuard.js';
import Packet from '#/client/io/Packet.js';

import { skipUnless } from '../lib/skipUnless.js';
import type { FrameRecord, LoginRecord, Protocol } from '../../tools/tap-377/format.js';
import { loadReplayFixture } from './replay/recording.js';
import { decodeRecordedFrame, RecordedStream, replayRecording } from './replay/runtime.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({
    playMidi: (): void => {},
    setMidiVolume: (): void => {},
    stopMidi: (): void => {}
}));

const protocol: Protocol = {
    revision: 289,
    client: [],
    server: [
        { name: 'FIXED', id: 10, length: 2 },
        { name: 'VARIABLE_ONE', id: 11, length: -1 },
        { name: 'VARIABLE_TWO', id: 12, length: -2 }
    ]
};

const login: LoginRecord = {
    type: 'login',
    segment: 1,
    replies: [0, 2],
    staffmodlevel: 4,
    mouseTracked: true,
    reconnect: false
};

function frame(ordinal: number, bytes: string): FrameRecord {
    return { type: 'frame', segment: 1, direction: 'in', tick: 0, ordinal, bytes };
}

describe('recorded packet framing', () => {
    test('accepts fixed and both variable-length packet envelopes', () => {
        expect(decodeRecordedFrame(frame(1, '0a0102'), protocol.server)).toEqual(new Uint8Array([10, 1, 2]));
        expect(decodeRecordedFrame(frame(1, '0b02a1a2'), protocol.server)).toEqual(new Uint8Array([11, 2, 0xa1, 0xa2]));
        expect(decodeRecordedFrame(frame(1, '0c0002a1a2'), protocol.server)).toEqual(new Uint8Array([12, 0, 2, 0xa1, 0xa2]));
    });

    test('rejects unknown opcodes and truncated or mismatched variable lengths', () => {
        expect(() => decodeRecordedFrame(frame(1, '0d00'), protocol.server)).toThrow('no protocol descriptor');
        expect(() => decodeRecordedFrame(frame(1, '0b'), protocol.server)).toThrow();
        expect(() => decodeRecordedFrame(frame(1, '0b03a1a2'), protocol.server)).toThrow();
        expect(() => decodeRecordedFrame(frame(1, '0c00'), protocol.server)).toThrow();
        expect(() => decodeRecordedFrame(frame(1, '0c0003a1a2'), protocol.server)).toThrow();
    });

    test('strict packet guard catches fake handler under-read and over-read', () => {
        expect(() => dispatchFake('0a000c', packet => packet.g1(), 0)).toThrow('packet 10 declared 2 bytes, consumed 1');
        expect(() => dispatchFake('0a000c', packet => { packet.g2(); return packet.g1(); }, 0)).toThrow('packet 10 declared 2 bytes, consumed 3');
    });
    test('a same-length wrong transform fails the decoded-value oracle', () => {
        expect(dispatchFake('0a000c', packet => packet.g2_alt3(), 3200)).toBe(3200);
        expect(() => dispatchFake('0a000c', packet => packet.g2(), 3200)).toThrow('decoded value differs');
    });
});

function dispatchFake(bytes: string, handler: (packet: Packet) => number, expected: number): number {
    const wire = decodeRecordedFrame(frame(1, bytes), protocol.server);
    const packet = new Packet(new Uint8Array(8));
    packet.data.set(wire.subarray(1));
    const value = handler(packet);
    assertPacketConsumed(wire[0], wire.length - 1, packet.pos);
    if (value !== expected) throw new Error('decoded value differs from the independent fixture');
    return value;
}

describe('RecordedStream', () => {
    test('serves the synthetic login reply and never exposes inbound bytes past the recorded count', async () => {
        const packets = [frame(1, '0a0102'), frame(2, '0b02a1a2')];
        const stream = new RecordedStream(login, packets, protocol);

        for (let index = 0; index < 8; index++) expect(await stream.read()).toBe(0);
        expect(await stream.read()).toBe(0);
        const seed = new Uint8Array(8);
        await stream.readBytes(seed, 0, seed.length);
        expect(seed).toEqual(new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]));
        expect(await stream.read()).toBe(2);
        expect(await stream.read()).toBe(login.staffmodlevel);
        expect(await stream.read()).toBe(1);

        stream.beginGame();
        expect(stream.available).toBe(0);
        stream.exposeInboundThrough(1);
        const first = new Uint8Array(3);
        expect(stream.available).toBe(first.length);
        await stream.readBytes(first, 0, first.length);
        expect(first).toEqual(new Uint8Array([10, 1, 2]));
        expect(stream.consumedInboundCount).toBe(1);
        expect(stream.available).toBe(0);
        await expect(stream.readBytes(new Uint8Array(1), 0, 1)).rejects.toThrow('visible packet boundary');

        stream.exposeInboundThrough(2);
        const second = new Uint8Array(4);
        await stream.readBytes(second, 0, second.length);
        expect(second).toEqual(new Uint8Array([11, 2, 0xa1, 0xa2]));
        expect(stream.consumedInboundCount).toBe(2);
    });
});

const recordingIndex = resolve('test/io/recordings/index.json');
const missingIndex = !existsSync(recordingIndex);
if (missingIndex) console.info('SKIP: test/io/replay.test.ts: recording index is not present');
const missingEngine = CLIENT_VERSION === 289 ? skipUnless('engine') : false;
const missingCacheBundle = skipUnless('cache-bundle');

describe.skipIf(missingIndex || missingEngine || missingCacheBundle)('production replay runtime', () => {
    test('boots and replays the current client recording through production mainloop', async () => {
        const fixture = loadReplayFixture();
        const report = await replayRecording(fixture.records, fixture.cacheBundle, fixture.protocol);
        const recordedCheckpoints = fixture.records.filter(record => record.type === 'checkpoint');
        const inboundFrames = fixture.records.filter(record => record.type === 'frame' && record.direction === 'in');

        expect(report.revision).toBe(fixture.indexEntry.revision);
        expect(report.segmentCount).toBeGreaterThan(0);
        expect(report.checkpointCount).toBe(recordedCheckpoints.length);
        expect(report.recordedOpcodeCoverage.inbound.descriptors).toEqual(
            fixture.protocol.server.map(descriptor => descriptor.name).sort()
        );
        expect(report.recordedOpcodeCoverage.outbound.descriptors).toEqual(
            fixture.protocol.client.map(descriptor => descriptor.name).sort()
        );
        expect(report.packetListenerCount).toBe(inboundFrames.length);
        expect(report.checkpoints.map(checkpoint => ({ label: checkpoint.label, inboundCount: checkpoint.inboundCount }))).toEqual(
            recordedCheckpoints.map(checkpoint => ({ label: checkpoint.label, inboundCount: checkpoint.inboundCount }))
        );
        expect(
            report.checkpoints.every(checkpoint => checkpoint.sceneBuild.world && checkpoint.sceneBuild.collisionLevels > 0)
        ).toBe(true);
        expect(report.boot).toEqual({
            mode: 'production-maininit',
            mainredrawCalls: 0,
            onDemandWireParser: false,
            gameSockets: false
        });
    });
});
