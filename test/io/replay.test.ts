import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, mock, spyOn, test, type Mock } from 'bun:test';

import * as loginKey from '#/client/config/loginKey.js';
import { CLIENT_VERSION } from '#/client/io/ClientProt.js';
import { assertPacketConsumed } from '#/client/io/packetGuard.js';
import Packet from '#/client/io/Packet.js';
import OnDemand, { type OnDemandWorker } from '#/client/io/OnDemand.js';
import { ServerProt, ServerProtSizes } from '#/client/io/ServerProt.js';

import { skipUnless } from '../lib/skipUnless.js';
import { ARCHIVES, type CacheBundle, type FrameRecord, type LoginRecord, type Protocol, type RecordingHeader, type RecordingRecord } from '../../tools/tap-377/format.js';
import { loadReplayFixtures } from './replay/recording.js';
import { decodeRecordedFrame, installCanvasMock, RecordedStream, replayRecording } from './replay/runtime.js';
import { nativeFetch } from '../setup-dom.js';

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

    test('reply 15 has no metadata bytes and requires a reconnect', async () => {
        const stream = new RecordedStream({ ...login, reconnect: true, replies: [0, 15] }, [frame(1, '0a0102')], protocol);
        const handshake = new Uint8Array(18);
        await stream.readBytes(handshake, 0, handshake.length);
        expect(handshake[17]).toBe(15);
        stream.beginGame();
        stream.exposeInboundThrough(1);
        const packet = new Uint8Array(3);
        await stream.readBytes(packet, 0, packet.length);
        expect(packet).toEqual(Uint8Array.of(10, 1, 2));
        expect(() => new RecordedStream({ ...login, replies: [0, 15] }, [], protocol)).toThrow('successful recorded login');
    });
});

test('OnDemand retains its injected worker, forwards requests, and terminates it once', () => {
    const messages: unknown[] = [];
    let created = 0;
    let terminated = 0;
    const worker: OnDemandWorker = {
        onmessage: null, onerror: null,
        postMessage: message => { messages.push(message); },
        terminate: () => { terminated++; }
    };
    const loader = Object.create(OnDemand.prototype) as OnDemand;
    Object.assign(loader, {
        app: { ingame: false, db: null }, worker: null, versions: [], crcs: [], workerAcks: new Map(),
        workerFactory: () => { created++; return worker; }
    });
    Reflect.get(loader, 'startWorker').call(loader);
    Reflect.get(loader, 'postWorker').call(loader, { type: 'request', archive: 1, file: 7 });
    expect(created).toBe(1);
    expect(loader.worker).toBe(worker);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ type: 'request', archive: 1, file: 7 });
    loader.stop();
    loader.stop();
    expect(terminated).toBe(1);
    expect(loader.worker).toBeNull();
});

test('a failing replay restores preloaded canvas, login-key exports, and the original fetch descriptor', async () => {
    const archives = {} as CacheBundle['archives'];
    const archiveHashes = {} as RecordingHeader['archiveHashes'];
    for (const name of ARCHIVES) {
        const bytes = Uint8Array.of(1, 2);
        archives[name] = Buffer.from(bytes).toString('base64');
        archiveHashes[name] = createHash('sha256').update(bytes).digest('hex');
    }
    const cleanupProtocol: Protocol = {
        revision: 289,
        client: [{ name: 'NO_TIMEOUT', id: 1, length: 0 }],
        server: [{ name: 'LOGOUT', id: 9, length: 0 }]
    };
    const records: RecordingRecord[] = [
        {
            type: 'header', tapVersion: 1, revision: 289,
            engineCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40), clientCommit: 'c'.repeat(40),
            accountPrefix: 'qa', archiveHashes, tickBasis: 'player-info'
        },
        login, frame(1, '09'),
        { type: 'end', segment: 1, reason: 'logout', inboundCount: 1, outboundCount: 0 }
    ];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const fetchBefore = globalThis.fetch;
    // Load this boundary first: the full suite may cache Canvas while no canvas exists.
    const canvasModule = await import('#/client/graphics/Canvas.js');
    const canvasBefore = canvasModule.canvas;
    const canvas2dBefore = canvasModule.canvas2d;
    const loginKeyBefore = { ...loginKey };
    const modulusBefore = loginKey.loginModulus();
    const exponentBefore = loginKey.loginExponent();
    const server = spyOn(Bun, 'serve').mockImplementation(() => {
        expect(globalThis.fetch).toBe(nativeFetch);
        expect(document.querySelector('#canvas')).toBe(canvasModule.canvas);
        expect(canvasModule.canvas).not.toBeNull();
        expect(loginKey.loginModulus()).toBe(65537n);
        expect(loginKey.loginExponent()).toBe(65537n);
        expect(loginKey.parseLoginModulus).toBe(loginKeyBefore.parseLoginModulus);
        throw new Error('synthetic replay archive failure');
    });
    try {
        await expect(replayRecording(records, { format: 1, archives, ondemand: {} }, cleanupProtocol))
            .rejects.toThrow('synthetic replay archive failure');
        expect(server).toHaveBeenCalledTimes(1);
        expect(Object.getOwnPropertyDescriptor(globalThis, 'fetch')).toEqual(descriptor);
        expect(globalThis.fetch).toBe(fetchBefore);
        expect(canvasModule.canvas).toBe(canvasBefore);
        expect(canvasModule.canvas2d).toBe(canvas2dBefore);
        expect({ ...loginKey }).toEqual(loginKeyBefore);
        expect(loginKey.loginModulus()).toBe(modulusBefore);
        expect(loginKey.loginExponent()).toBe(exponentBefore);
    } finally {
        server.mockRestore();
        if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor);
    }
});

const recordingIndex = resolve('test/io/recordings/index.json');
const missingIndex = !existsSync(recordingIndex);
if (missingIndex) console.info('SKIP: test/io/replay.test.ts: recording index is not present');
const missingCacheBundle = skipUnless('cache-bundle');
// Why: each case below boots the production client from the recorded cache bundle and runs its mainloop; the full replay takes 5.3 s on Bun 1.4.4 and 6.5 s on CI's pinned 1.3.14, past bun's 5 s default, and bunfig has no test-timeout key, so the budget is per test here (as `inboundCoverage377.test.ts` does).
// A timed-out replay keeps running into the later tests: under the 5 s default the login-key and login-block tests after it failed as well.
const REPLAY_BUDGET_MS = 120_000;

describe.skipIf(missingIndex || missingCacheBundle)('production replay runtime', () => {
    test('boots and replays every current-client recording through production mainloop', async () => {
        const fixtures = loadReplayFixtures();
        expect(fixtures.length).toBeGreaterThan(0);
        for (const fixture of fixtures) {
            const report = await replayRecording(fixture.records, fixture.cacheBundle, fixture.protocol);
            const recordedCheckpoints = fixture.records.filter(record => record.type === 'checkpoint');
            const inboundFrames = fixture.records.filter((record): record is FrameRecord => record.type === 'frame' && record.direction === 'in');

            expect(report.revision).toBe(fixture.indexEntry.revision);
            expect(report.segmentCount).toBeGreaterThan(0);
            expect(report.checkpointCount).toBe(recordedCheckpoints.length);
            expect(report.recordedOpcodeCoverage.inbound.descriptors).toEqual(
                fixture.protocol.server.map(descriptor => descriptor.name).sort()
            );
            expect(report.recordedOpcodeCoverage.outbound.descriptors).toEqual(
                fixture.protocol.client.map(descriptor => descriptor.name).sort()
            );
            const logoutOpcode = fixture.protocol.server.find(descriptor => descriptor.name === 'LOGOUT')?.id;
            expect(report.packetListenerCount).toBe(inboundFrames.filter(frame => parseInt(frame.bytes.slice(0, 2), 16) !== logoutOpcode).length);
            expect(report.checkpoints.map(checkpoint => ({ label: checkpoint.label, inboundCount: checkpoint.inboundCount }))).toEqual(
                recordedCheckpoints.map(checkpoint => ({ label: checkpoint.label, inboundCount: checkpoint.inboundCount }))
            );
            expect(
                report.checkpoints.every(checkpoint => checkpoint.sceneBuild.locCount > 0 && checkpoint.sceneBuild.collisionZoneTiles > 0)
            ).toBe(true);
            expect(report.boot).toEqual({
                mode: 'production-maininit',
                substitutedSteps: ['Jpeg.decodeJpeg: jpeg-js', 'loginKey: synthetic public parameters'],
                mainredrawCalls: 0,
                onDemandWireParser: false,
                gameSockets: false
            });
        }
    }, REPLAY_BUDGET_MS);

    test('mismatched captured tiles and instance checkpoints fail real replay', async () => {
        const [fixture] = loadReplayFixtures();
        if (!fixture) throw new Error('no replay fixtures');
        for (const field of ['serverTile', 'sceneInstanced'] as const) {
            const records = fixture.records.map(record => record.type === 'checkpoint' ? {
                ...record,
                state: {
                    ...record.state,
                    ...(field === 'serverTile'
                        ? { serverTile: { ...record.state.serverTile, x: record.state.serverTile.x + 1 } }
                        : { sceneInstanced: !record.state.sceneInstanced })
                }
            } : record);
            await expect(replayRecording(records, fixture.cacheBundle, fixture.protocol)).rejects.toThrow('differs from its captured adapter state');
        }
    }, REPLAY_BUDGET_MS);

    test('reply 15 resumes the existing scene through production lostCon and then cleanly logs out', async () => {
        const [fixture] = loadReplayFixtures();
        if (!fixture) throw new Error('no replay fixtures');
        const checkpointIndex = fixture.records.findIndex(record => record.type === 'checkpoint' && record.segment === 1);
        const checkpoint = fixture.records[checkpointIndex];
        const firstLogin = fixture.records.find(record => record.type === 'login');
        if (checkpoint?.type !== 'checkpoint' || firstLogin?.type !== 'login') throw new Error('reconnect fixture has no first checkpoint');
        const prefix = fixture.records.slice(0, checkpointIndex + 1);
        const counts = { in: 0, out: 0 };
        let tick = 0;
        for (const record of prefix) {
            if (record.type === 'frame') { counts[record.direction]++; tick = record.tick; }
        }
        const suffix = fixture.records.slice(checkpointIndex + 1).map((record): RecordingRecord => {
            if (record.type === 'header') throw new Error('unexpected replay header');
            const segment = record.segment + 1;
            if (record.segment !== 1) return { ...record, segment };
            if (record.type === 'frame') return { ...record, segment, ordinal: record.ordinal - counts[record.direction], tick: record.tick - tick };
            if (record.type === 'checkpoint') return { ...record, segment, inboundCount: record.inboundCount - counts.in };
            if (record.type === 'end') return { ...record, segment, inboundCount: record.inboundCount - counts.in, outboundCount: record.outboundCount - counts.out };
            throw new Error('unexpected replay login');
        });
        const records: RecordingRecord[] = [
            ...prefix,
            { type: 'end', segment: 1, reason: 'reconnect', inboundCount: counts.in, outboundCount: counts.out },
            { ...firstLogin, segment: 2, replies: [0, 15], reconnect: true },
            { ...checkpoint, segment: 2, label: 'reconnect-preserved', inboundCount: 0 },
            ...suffix
        ];
        const report = await replayRecording(records, fixture.cacheBundle, fixture.protocol);
        expect(report.segmentCount).toBe(fixture.records.filter(record => record.type === 'login').length + 1);
        const preserved = report.checkpoints.find(record => record.label === 'reconnect-preserved');
        expect(preserved?.state).toEqual(checkpoint.state);
        expect(preserved?.frames).toBe(0);
    }, REPLAY_BUDGET_MS);

    test('a validly framed handler under-read propagates through replayRecording and production mainloop', async () => {
        const [fixture] = loadReplayFixtures();
        if (!fixture) throw new Error('no replay fixtures');
        const message = fixture.protocol.server.find(descriptor => descriptor.name === 'MESSAGE_GAME');
        if (!message || message.length !== -1) throw new Error('replay fixture has no variable MESSAGE_GAME descriptor');
        let changed = false;
        const records = fixture.records.map(record => {
            if (changed || record.type !== 'frame' || record.direction !== 'in' || parseInt(record.bytes.slice(0, 2), 16) !== message.id) return record;
            const bytes = Buffer.from(record.bytes, 'hex');
            if (bytes[1] === 255) throw new Error('replay message is too long for corruption fixture');
            bytes[1]!++;
            changed = true;
            return { ...record, bytes: bytes.toString('hex') + '00' };
        });
        expect(changed).toBe(true);
        await expect(replayRecording(records, fixture.cacheBundle, fixture.protocol)).rejects.toThrow(`packet ${message.id} declared`);
    }, REPLAY_BUDGET_MS);
});

test('production HINT_ARROW consumes entity and clear padding without skipping the packet guard', async () => {
    // Load the browser client after the test preload and audio boundaries have been installed.
    const { Client } = await import('#/client/shell/Client.js');
    const client = Object.create(Client.prototype) as InstanceType<typeof Client>;
    Object.assign(client, { in: new Packet(new Uint8Array(32)), ptype: -1, ptype0: -1, ptype1: -1, ptype2: -1, psize: 0, randomIn: null });
    const decode = async (body: number[]): Promise<void> => {
        const wire = Uint8Array.from([ServerProt.HINT_ARROW, ...body]);
        let position = 0;
        Reflect.set(client, 'stream', {
            get available() { return wire.length - position; },
            msSinceData: 0,
            async read() { return wire[position++]; },
            async readBytes(destination: Uint8Array, offset: number, length: number) {
                destination.set(wire.subarray(position, position + length), offset);
                position += length;
            },
            write() {}, close() {}
        });
        expect(await Reflect.get(client, 'tcpIn').call(client)).toBe(true);
        expect(Reflect.get(client, 'in').pos).toBe(6);
        expect(position).toBe(wire.length);
    };
    await decode([1, 1, 44, 0, 0, 0]);
    expect(Reflect.get(client, 'hintNpc')).toBe(300);
    await decode([10, 0, 7, 0, 0, 0]);
    expect(Reflect.get(client, 'hintPlayer')).toBe(7);
    await decode([2, 12, 128, 12, 129, 16]);
    expect(Reflect.get(client, 'hintTileX')).toBe(3200);
    expect(Reflect.get(client, 'hintTileZ')).toBe(3201);
    await decode([255, 0, 0, 0, 0, 0]);
    expect(Reflect.get(client, 'hintType')).toBe(255);
});

describe('production tcpIn fail-closed replay path', () => {
    async function dispatch(
        opcode: number, body: readonly number[],
        assertion: (client: object, run: () => Promise<boolean>, logout: Mock<() => Promise<void>>, stream: RecordedStream) => Promise<void>,
        prepare?: (client: object) => void
    ): Promise<void> {
        const restoreCanvas = await installCanvasMock();
        try {
            const [{ Client }, adapter] = await Promise.all([import('#/client/shell/Client.js'), import('#/bot/adapter/ClientAdapter.js')]);
            const client = new Client(undefined as never, undefined as never, undefined as never);
            const size = ServerProtSizes[opcode] ?? 0;
            const wire = [opcode, ...(size === -1 ? [body.length] : size === -2 ? [body.length >> 8, body.length & 255] : []), ...body];
            const stream = new RecordedStream(login, [frame(1, Buffer.from(wire).toString('hex'))], {
                revision: CLIENT_VERSION, client: [], server: [{ name: 'NEGATIVE', id: opcode, length: size }]
            });
            await stream.readBytes(new Uint8Array(20), 0, 20);
            stream.beginGame();
            stream.exposeInboundThrough(1);
            Object.assign(client, { stream, randomIn: null, ingame: true, ptype: -1, ptype0: -1, ptype1: -1, ptype2: -1, psize: 0 });
            const logout = spyOn(client as unknown as { logout(): Promise<void> }, 'logout');
            const errors = spyOn(console, 'error').mockImplementation(() => {});
            try {
                expect(adapter.attach(client)).toEqual([]);
                expect(adapter.reader.attached()).toBe(true);
                adapter.setPacketListener(mock(() => {}));
                prepare?.(client);
                await assertion(client, () => Reflect.get(client, 'tcpIn').call(client), logout, stream);
            } finally {
                adapter.setPacketListener(null);
                adapter.detach();
                logout.mockRestore();
                errors.mockRestore();
                stream.close();
            }
        } finally {
            restoreCanvas();
        }
    }

    test('unknown zero-sized opcode is rejected by membership as StrictPacketError, not swallowed by T2', async () => {
        await dispatch(0, [], async (_client, run, logout) => {
            const error = await run().then(() => null, error => error as Error);
            expect(error?.constructor.name).toBe('StrictPacketError');
            expect(error?.message).toContain('T1 - unknown opcode 0,0');
            expect(logout).not.toHaveBeenCalled();
        });
    });

    test('T1 unhandled-dispatch StrictPacketError is rethrown without logout', async () => {
        // A resumed packet has already passed admission. Seed an unmapped dispatch value
        // to exercise the final T1 branch separately from membership rejection.
        await dispatch(0, [], async (_client, run, logout) => {
            const error = await run().then(() => null, error => error as Error);
            expect(error?.constructor.name).toBe('StrictPacketError');
            expect(error?.message).toContain('T1 - 256,0');
            expect(logout).not.toHaveBeenCalled();
        }, client => Object.assign(client, { ptype: 256, psize: 0 }));
    });

    test('real MESSAGE_GAME handler under-read and over-read reach the strict consumption guard', async () => {
        for (const [body, consumed] of [[[10, 99], 1], [[65], 2]] as const) {
            await dispatch(ServerProt.MESSAGE_GAME, body, async (_client, run, logout) => {
                await expect(run()).rejects.toThrow(`packet ${ServerProt.MESSAGE_GAME} declared ${body.length} bytes, consumed ${consumed}`);
                expect(logout).not.toHaveBeenCalled();
            }, client => {
                // Stale bytes past psize must not turn a handler over-read into success.
                Reflect.get(client, 'in').data[1] = 10;
            });
        }
    });

    test('a real handler exception takes T2 logout and is still rethrown', async () => {
        // Java dereferences the unloaded component list entry here; with no local player the handler returns before that read.
        await dispatch(ServerProt.IF_SETPLAYERHEAD, [255, 255], async (_client, run, logout, stream) => {
            await expect(run()).rejects.toBeInstanceOf(TypeError);
            expect(logout).toHaveBeenCalledTimes(1);
            expect(stream.closed).toBe(true);
        }, client => Object.assign(client, { localPlayer: { routeX: [0], routeZ: [0] } }));
    });

    test('same-length wrong transform reaches the handler but fails the independent value oracle', async () => {
        await dispatch(ServerProt.HINT_ARROW, [2, 12, 128, 12, 129, 16], async (client, run) => {
            expect(await run()).toBe(true);
            expect(Reflect.get(client, 'hintTileX')).toBe(3200);
        });
        await dispatch(ServerProt.HINT_ARROW, [2, 0, 12, 12, 129, 16], async (client, run) => {
            expect(await run()).toBe(true);
            expect(() => {
                if (Reflect.get(client, 'hintTileX') !== 3200) throw new Error('decoded tile differs from fixture');
            }).toThrow('decoded tile differs from fixture');
        });
    });
});
