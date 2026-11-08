import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { mock } from 'bun:test';
import { decode as decodeJpegBytes } from 'jpeg-js';

import * as loginKey from '#/client/config/loginKey.js';
import { TARGET } from '#/client/config/target.js';
import { decodeJpeg } from '#/client/graphics/Jpeg.js';
import CollisionMap, { BuildArea } from '#/client/dash3d/CollisionMap.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import type World from '#/client/dash3d/World.js';

import type { ClientStreamLike } from '#/client/io/ClientStream.js';
import type JagFile from '#/client/io/JagFile.js';
import type { OnDemandWorker, OnDemandWorkerFactory } from '#/client/io/OnDemand.js';

import { checkRecording } from '../../../tools/tap-377/check-recording.js';
import type {
    CacheBundle,
    CheckpointRecord,
    CheckpointState,
    Descriptor,
    EndRecord,
    FrameRecord,
    LoginRecord,
    Protocol,
    RecordingRecord
} from '../../../tools/tap-377/format.js';
import { startReplayArchiveServer, type ReplayArchiveServer } from './server.js';
import { nativeFetch } from '../../setup-dom.js';

const SYNTHETIC_LOGIN_SEED = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
const MAX_FRAMES_PER_CHECKPOINT = 5000;

type FrameDescriptor = ReadonlyMap<number, Descriptor>;

function descriptorMap(descriptors: readonly Descriptor[]): FrameDescriptor {
    return new Map(descriptors.map(descriptor => [descriptor.id, descriptor]));
}

/** Decodes and verifies one tap frame against its supplied direction's descriptors. */
export function decodeRecordedFrame(frame: FrameRecord, descriptors: readonly Descriptor[]): Uint8Array {
    if (frame.bytes.length === 0 || frame.bytes.length % 2 !== 0 || !/^(?:[0-9a-f]{2})+$/.test(frame.bytes)) {
        throw new Error('recorded frame is not lowercase hexadecimal');
    }

    const bytes = Uint8Array.from(Buffer.from(frame.bytes, 'hex'));
    const descriptor = descriptorMap(descriptors).get(bytes[0]!);
    if (!descriptor) {
        throw new Error('recorded frame opcode has no protocol descriptor');
    }
    if (wirePacketEnd(bytes, 0, descriptor) !== bytes.length) {
        throw new Error('recorded frame length differs from its protocol descriptor');
    }
    return bytes;
}

function wirePacketEnd(bytes: Uint8Array, offset: number, descriptor: Descriptor): number {
    const start = offset;
    if (offset >= bytes.length || bytes[offset] !== descriptor.id) {
        throw new Error('packet opcode differs from its protocol descriptor');
    }
    offset++;

    let bodyLength = descriptor.length;
    if (descriptor.length === -1) {
        if (offset >= bytes.length) throw new Error('truncated one-byte packet length');
        bodyLength = bytes[offset++]!;
    } else if (descriptor.length === -2) {
        if (offset + 2 > bytes.length) throw new Error('truncated two-byte packet length');
        bodyLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
        offset += 2;
    } else if (descriptor.length < 0) {
        throw new Error('invalid protocol packet length');
    }

    const end = offset + bodyLength;
    if (end > bytes.length || end < start) {
        throw new Error('truncated packet body');
    }
    return end;
}

export class RecordedStream implements ClientStreamLike {
    private readonly loginBytes: Uint8Array;
    private readonly inboundBytes: Uint8Array;
    private readonly inboundEnds: number[];
    private loginOffset = 0;
    private inboundOffset = 0;
    private visibleInboundEnd = 0;
    private consumedFrames = 0;
    private gamePhase = false;
    private didClose = false;
    readonly outboundChunks: Uint8Array[] = [];

    constructor(login: LoginRecord, inboundFrames: readonly FrameRecord[], protocol: Protocol) {
        const reply = login.replies[1];
        if (login.replies.length !== 2 || login.replies[0] !== 0 || (reply !== 2 && !(reply === 15 && login.reconnect))) {
            throw new Error('replay requires a successful recorded login reply sequence');
        }

        this.loginBytes = new Uint8Array(8 + 1 + SYNTHETIC_LOGIN_SEED.length + 1 + (reply === 2 ? 2 : 0));
        let loginPos = 8;
        this.loginBytes[loginPos++] = login.replies[0]!;
        this.loginBytes.set(SYNTHETIC_LOGIN_SEED, loginPos);
        loginPos += SYNTHETIC_LOGIN_SEED.length;
        this.loginBytes[loginPos++] = reply;
        if (reply === 2) {
            this.loginBytes[loginPos++] = login.staffmodlevel;
            this.loginBytes[loginPos] = login.mouseTracked ? 1 : 0;
        }

        const serverDescriptors = descriptorMap(protocol.server);
        const packets: Uint8Array[] = [];
        this.inboundEnds = [];
        let total = 0;
        for (const frame of inboundFrames) {
            if (frame.direction !== 'in') {
                throw new Error('recorded stream received a non-inbound frame');
            }
            const bytes = decodeRecordedFrame(frame, protocol.server);
            const descriptor = serverDescriptors.get(bytes[0]!);
            if (!descriptor || wirePacketEnd(bytes, 0, descriptor) !== bytes.length) {
                throw new Error('recorded inbound packet framing is invalid');
            }
            packets.push(bytes);
            total += bytes.length;
            this.inboundEnds.push(total);
        }

        this.inboundBytes = new Uint8Array(total);
        let offset = 0;
        for (const packet of packets) {
            this.inboundBytes.set(packet, offset);
            offset += packet.length;
        }
    }

    get closed(): boolean {
        return this.didClose;
    }

    get available(): number {
        return this.gamePhase && !this.didClose ? this.visibleInboundEnd - this.inboundOffset : 0;
    }

    get msSinceData(): number {
        return 0;
    }

    get consumedInboundCount(): number {
        return this.consumedFrames;
    }

    get inboundFrameCount(): number {
        return this.inboundEnds.length;
    }

    exposeInboundThrough(count: number): void {
        if (!Number.isInteger(count) || count < this.consumedFrames || count > this.inboundEnds.length) {
            throw new Error('replay inbound exposure is outside the recorded stream');
        }
        this.visibleInboundEnd = count === 0 ? 0 : this.inboundEnds[count - 1]!;
    }

    beginGame(): void {
        if (this.gamePhase || this.loginOffset !== this.loginBytes.length) {
            throw new Error('synthetic login handshake was not fully consumed');
        }
        this.gamePhase = true;
    }

    write(src: Uint8Array, len: number): void {
        if (this.didClose || !this.gamePhase) return;
        if (!Number.isInteger(len) || len < 0 || len > src.length) {
            throw new Error('invalid replay output write');
        }
        this.outboundChunks.push(src.slice(0, len));
    }

    async read(): Promise<number> {
        if (this.didClose) return -1;
        if (this.gamePhase || this.loginOffset >= this.loginBytes.length) {
            throw new Error('synthetic login stream ran out of bytes');
        }
        return this.loginBytes[this.loginOffset++]!;
    }

    async readBytes(dst: Uint8Array, off: number, len: number): Promise<void> {
        if (!Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 0 || off + len > dst.length) {
            throw new Error('invalid replay stream read');
        }

        if (!this.gamePhase) {
            if (this.loginOffset + len > this.loginBytes.length) {
                throw new Error('synthetic login stream ran out of bytes');
            }
            dst.set(this.loginBytes.subarray(this.loginOffset, this.loginOffset + len), off);
            this.loginOffset += len;
            return;
        }

        if (this.didClose || len > this.available) {
            throw new Error('replay stream read crossed its visible packet boundary');
        }
        dst.set(this.inboundBytes.subarray(this.inboundOffset, this.inboundOffset + len), off);
        this.inboundOffset += len;
        while (this.consumedFrames < this.inboundEnds.length && this.inboundOffset >= this.inboundEnds[this.consumedFrames]!) {
            this.consumedFrames++;
        }
    }

    close(): void {
        this.didClose = true;
    }
}

class CacheReplayWorker implements OnDemandWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    failure: Error | null = null;
    private terminated = false;

    constructor(private readonly files: ReadonlyMap<string, Uint8Array>) {}

    postMessage(message: unknown): void {
        if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string') {
            throw new Error('invalid replay OnDemand worker message');
        }

        if (message.type === 'request') {
            if (!('archive' in message) || typeof message.archive !== 'number' || !('file' in message) || typeof message.file !== 'number') {
                throw new Error('invalid replay OnDemand request');
            }
            const archive = message.archive;
            const file = message.file;
            const data = this.files.get(`${archive}/${file}`);
            if (!data) {
                this.failure = new Error(`missing replay cache file ${archive}/${file}`);
                throw this.failure;
            }

            const copy = new ArrayBuffer(data.length);
            new Uint8Array(copy).set(data);
            queueMicrotask(() => {
                if (!this.terminated) {
                    this.onmessage?.(new MessageEvent('message', {
                        data: { type: 'completed', archive, file, urgent: true, data: copy }
                    }));
                }
            });
            return;
        }

        if (message.type === 'prefetchPriority' && 'id' in message && typeof message.id === 'number') {
            const id = message.id;
            queueMicrotask(() => {
                if (!this.terminated) this.onmessage?.(new MessageEvent('message', { data: { type: 'ack', id } }));
            });
        }
    }

    terminate(): void {
        this.terminated = true;
    }
}

interface ClientReplayMethods {
    logout(): Promise<void>;
    lostCon(): Promise<void>;
}

interface ClientReplayState extends ReplayScene {
    errorLoading: boolean;
    loginAttempt: { done: Promise<void> } | null;
    randomIn: unknown;
    out: { random: unknown };
    localPlayer: object | null;
    statSessionGeneration: number;
    onDemand: { remaining(): number } | null;
}

interface CheckpointReport {
    label: string;
    inboundCount: number;
    frames: number;
    state: CheckpointState;
    sceneBuild: { locCount: number; collisionZoneTiles: number };
}

/** Live adapter at a replay checkpoint; S7a snapshot tests inspect entity/template state here. */
export type ReplayCheckpointObserver = (info: {
    label: string;
    inboundCount: number;
    state: CheckpointState;
    sceneBuild: { locCount: number; collisionZoneTiles: number };
    adapter: {
        locs(): { id: number }[];
        npcs(): { id: number }[];
        templateSource(lx: number, lz: number, level?: number): object | null;
        sceneInstanced(): boolean;
        serverTile(): CheckpointState['serverTile'] | null;
        toLocal(x: number, z: number): { lx: number; lz: number } | null;
        mapBuildBase(): { x: number; z: number } | null;
    };
}) => void;

interface OpcodeCoverage {
    descriptors: string[];
    seen: string[];
    missing: string[];
}

function opcodeCoverage(seen: readonly string[], descriptors: readonly Descriptor[]): OpcodeCoverage {
    const descriptorNames = descriptors.map(descriptor => descriptor.name).sort();
    const seenNames = [...seen].sort();
    const seenSet = new Set(seenNames);
    return {
        descriptors: descriptorNames,
        seen: seenNames,
        missing: descriptorNames.filter(name => !seenSet.has(name))
    };
}

export interface ReplayReport {
    revision: number;
    segmentCount: number;
    checkpointCount: number;
    packetListenerCount: number;
    checkpoints: CheckpointReport[];
    recordedOpcodeCoverage: { inbound: OpcodeCoverage; outbound: OpcodeCoverage };
    runtimeOutbound: { frameCount: number; opcodes: string[] };
    boot: {
        mode: 'production-maininit';
        substitutedSteps: string[];
        mainredrawCalls: 0;
        onDemandWireParser: false;
        gameSockets: false;
    };
}

function clientState(client: object): ClientReplayState {
    return client as unknown as ClientReplayState;
}

interface ReplayScene {
    world: Pick<World, 'wallType' | 'sceneType' | 'gdType' | 'decorType'> | null;
    collision: readonly (CollisionMap | null)[];
    sceneInstanced?: boolean;
}

/** Reads the client-owned instance flag and rejects allocated but unpopulated scene maps. */
export function readReplayCheckpoint(client: ReplayScene, adapter: {
    ingame(): boolean;
    sceneState(): number;
    serverTile(): CheckpointState['serverTile'] | null;
    mapBuildBase(): { x: number; z: number } | null;
}): Pick<CheckpointReport, 'state' | 'sceneBuild'> {
    const serverTile = adapter.serverTile();
    const base = adapter.mapBuildBase();
    if (!serverTile || !base) {
        throw new Error('replay checkpoint has no adapter server tile or map-build base');
    }

    const level = serverTile.level;
    const collision = client.collision[level];
    if (!client.world || !collision) throw new Error('replay checkpoint has no world or collision map');
    const localX = serverTile.x - base.x, localZ = serverTile.z - base.z;
    if (localX < 1 || localZ < 1 || localX >= BuildArea.SIZE - 1 || localZ >= BuildArea.SIZE - 1) {
        throw new Error('replay checkpoint player is outside the built scene interior');
    }
    let locCount = 0;
    for (let x = 1; x < BuildArea.SIZE - 1; x++) {
        for (let z = 1; z < BuildArea.SIZE - 1; z++) {
            locCount += Number(client.world.wallType(level, x, z) !== 0);
            locCount += Number(client.world.sceneType(level, x, z) !== 0);
            locCount += Number(client.world.gdType(level, x, z) !== 0);
            locCount += Number(client.world.decorType(level, z, x) !== 0);
        }
    }
    let collisionZoneTiles = 0;
    const zoneX = localX & ~7, zoneZ = localZ & ~7;
    for (let x = Math.max(1, zoneX); x < Math.min(BuildArea.SIZE - 1, zoneX + 8); x++) {
        for (let z = Math.max(1, zoneZ); z < Math.min(BuildArea.SIZE - 1, zoneZ + 8); z++) {
            const flags = collision.flags[CollisionMap.index(x, z)];
            if (flags !== CollisionFlag._BOUNDS && (flags & CollisionFlag.UNLOADED) === 0 &&
                (flags & (CollisionFlag.WALK_BLOCK_FLAGS | CollisionFlag.WALK_SCENERY | CollisionFlag.WR_GROUND_DECOR | CollisionFlag.WR_GRND)) !== 0) {
                collisionZoneTiles++;
            }
        }
    }
    if (locCount === 0 || collisionZoneTiles === 0) throw new Error('replay checkpoint has no populated world or collision in the player zone');
    const state: CheckpointState = {
        serverTile,
        sceneState: adapter.sceneState(),
        ingame: adapter.ingame(),
        sceneInstanced: client.sceneInstanced === true,
        mapBuildBaseX: base.x,
        mapBuildBaseZ: base.z
    };
    return { state, sceneBuild: { locCount, collisionZoneTiles } };
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
    const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

function decodeRuntimeOutput(chunks: readonly Uint8Array[], descriptors: readonly Descriptor[]): { frameCount: number; opcodes: string[] } {
    const bytes = concatenate(chunks);
    const byId = descriptorMap(descriptors);
    const seen = new Set<string>();
    let offset = 0;
    let frameCount = 0;

    while (offset < bytes.length) {
        const opcode = bytes[offset]!;
        const descriptor = byId.get(opcode);
        if (!descriptor) {
            throw new Error('production client emitted an opcode without a protocol descriptor');
        }
        offset = wirePacketEnd(bytes, offset, descriptor);
        seen.add(descriptor.name);
        frameCount++;
    }

    return { frameCount, opcodes: [...seen].sort() };
}

function replaySegments(records: readonly RecordingRecord[]): {
    login: LoginRecord;
    frames: FrameRecord[];
    checkpoints: CheckpointRecord[];
    end: EndRecord;
}[] {
    const logins = records.filter((record): record is LoginRecord => record.type === 'login');
    return logins.map(login => {
        const frames = records.filter((record): record is FrameRecord => record.type === 'frame' && record.segment === login.segment);
        const checkpoints = records.filter((record): record is CheckpointRecord => record.type === 'checkpoint' && record.segment === login.segment);
        const end = records.find((record): record is EndRecord => record.type === 'end' && record.segment === login.segment);
        if (!end) throw new Error('recording segment has no end record');
        return { login, frames, checkpoints, end };
    });
}

function demandFiles(cache: CacheBundle): ReadonlyMap<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    for (const [key, encoded] of Object.entries(cache.ondemand)) {
        files.set(key, Uint8Array.from(Buffer.from(encoded, 'base64')));
    }
    return files;
}

/** Replays validated packets through Client.mainloop and the production scene-building path. */
export async function replayRecording(
    records: readonly RecordingRecord[],
    cacheBundle: CacheBundle,
    protocol: Protocol,
    onCheckpoint?: ReplayCheckpointObserver
): Promise<ReplayReport> {
    const check = checkRecording(records, protocol, cacheBundle);
    if (!check.valid) {
        throw new Error(`recording validation failed: ${check.errors.join(', ')}`);
    }

    const header = records[0];
    if (!header || header.type !== 'header') throw new Error('recording header is missing');
    const segments = replaySegments(records);
    if (segments.length === 0) throw new Error('recording has no login segments');

    if (typeof document === 'undefined') {
        throw new Error('replay requires the happy-dom test document');
    }
    const restoreCanvas = await installCanvasMock();
    const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const previousTarget = {
        wsHost: TARGET.wsHost,
        tls: TARGET.tls,
        httpPrefix: TARGET.httpPrefix
    };
    const previousSecureOrigin = process.env.SECURE_ORIGIN;
    const previousStrictPackets = process.env.STRICT_PACKETS;
    const previousStrictConfig = process.env.STRICT_CONFIG;

    let archiveServer: ReplayArchiveServer | null = null;
    let replayClient: {
        maininit(): Promise<void>;
        mainloop(): Promise<void>;
        startLogin(username: string, password: string): boolean;
        disposeReplay(): void;
        logoutReplay(): Promise<void>;
        reconnectReplay(): Promise<void>;
        nextLoginAttempt(): Promise<void>;
    } | null = null;
    let detachAdapter: (() => void) | null = null;
    let setPacketListener: ((listener: ((ptype: number) => void) | null) => void) | null = null;
    let restoreClientSettings: (() => void) | null = null;
    let restoreJpegDecoder: (() => void) | null = null;
    let restoreLoginKey: (() => void) | null = null;
    const packetListenerOpcodes: number[] = [];
    const checkpointReports: CheckpointReport[] = [];
    let runtimeOutboundChunks: Uint8Array[] = [];

    try {
        Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: nativeFetch });
        restoreLoginKey = installSyntheticLoginKey();
        const startedServer = startReplayArchiveServer(cacheBundle);
        archiveServer = startedServer;
        TARGET.wsHost = startedServer.host;
        TARGET.tls = false;
        TARGET.httpPrefix = startedServer.origin;
        process.env.SECURE_ORIGIN = 'false';
        process.env.STRICT_PACKETS = '1';
        process.env.STRICT_CONFIG = '1';
        restoreJpegDecoder = installJpegDecoder();
        // Test loading boundary: strict flags, loopback target, and the canvas must exist before client modules capture globals.
        const [{ Client }, { default: OnDemand }, { attach, detach, reader, setPacketListener: setListener }] = await Promise.all([
            import('#/client/shell/Client.js'),
            import('#/client/io/OnDemand.js'),
            import('#/bot/adapter/ClientAdapter.js')
        ]);
        if (!Client.STRICT_PACKETS) {
            throw new Error('strict packet handling was not enabled before Client import');
        }

        const streams = segments.map(segment => new RecordedStream(
            segment.login,
            segment.frames.filter(frame => frame.direction === 'in'),
            protocol
        ));
        const files = demandFiles(cacheBundle);
        const workers: CacheReplayWorker[] = [];
        const workerFactory: OnDemandWorkerFactory = () => {
            const worker = new CacheReplayWorker(files);
            workers.push(worker);
            return worker;
        };

        class ReplayClient extends Client {
            private streamIndex = 0;

            constructor() {
                // The production constructor's undefined-argument path does not start its autonomous browser frame loop.
                super(undefined as never, undefined as never, undefined as never);
            }

            protected override async openLoginStream(): Promise<ClientStreamLike> {
                return this.nextLoginStream();
            }

            protected override createOnDemand(versionlist: JagFile): InstanceType<typeof OnDemand> {
                return new OnDemand(versionlist, this, workerFactory);
            }

            nextLoginStream(): RecordedStream {
                const stream = streams[this.streamIndex++];
                if (!stream) throw new Error('recording supplied more login streams than segments');
                return stream;
            }

            async nextLoginAttempt(): Promise<void> {
                const state = clientState(this);
                const attempt = state.loginAttempt;
                if (!attempt) throw new Error('production login attempt was not created');
                await attempt.done;
                this.finishLogin();
            }

            private finishLogin(): void {
                if (!reader.ingame()) throw new Error('production login did not reach its successful reply path');
                const state = clientState(this);
                state.randomIn = null;
                state.out.random = null;
                streams[this.streamIndex - 1]!.beginGame();
            }

            async reconnectReplay(): Promise<void> {
                await (this as unknown as ClientReplayMethods).lostCon();
                this.finishLogin();
            }

            async logoutReplay(): Promise<void> {
                const privateMethods = this as unknown as ClientReplayMethods;
                await privateMethods.logout();
            }

            disposeReplay(): void {
                this.mainquit();
            }
        }

        replayClient = new ReplayClient();
        const client = replayClient;
        const state = clientState(client);
        const oldClientSettings = {
            nodeId: Client.nodeId,
            memServer: Client.memServer,
            lowMem: Client.lowMem
        };
        restoreClientSettings = () => {
            Client.nodeId = oldClientSettings.nodeId;
            Client.memServer = oldClientSettings.memServer;
            if (oldClientSettings.lowMem) Client.setLowMem();
            else Client.setHighMem();
            Client.lowMem = oldClientSettings.lowMem;
        };
        // Capture uses lowmem=1; replay must request the same boot asset set.
        Client.setLowMem();

        detachAdapter = detach;
        setPacketListener = setListener;
        const missing = attach(client);
        if (missing.length > 0 || !reader.attached()) {
            throw new Error(`client adapter attach failed: ${missing.join(', ') || 'not attached'}`);
        }
        setListener(ptype => packetListenerOpcodes.push(ptype));

        await client.maininit();
        for (const worker of workers) {
            if (worker.failure) throw new Error('production maininit failed on an absent OnDemand cache file');
        }
        if (state.errorLoading) {
            throw new Error('production maininit failed before the replay login');
        }

        let priorPlayer: object | null = null;
        let priorGeneration = state.statSessionGeneration;
        let priorSceneState = 0;
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex]!;
            const stream = streams[segmentIndex]!;
            if (segment.login.replies[1] === 15 && segmentIndex === 0) {
                throw new Error('replay reconnect reply 15 requires a preceding live scene');
            }
            if (segmentIndex > 0 && segment.login.reconnect) {
                await client.reconnectReplay();
            } else {
                if (!client.startLogin('replay', 'replay')) throw new Error('production login was rejected');
                await client.nextLoginAttempt();
            }
            if (segmentIndex > 0) {
                if (state.statSessionGeneration <= priorGeneration) throw new Error('production login did not advance its session generation');
                if (segment.login.replies[1] === 15) {
                    if (reader.sceneState() !== priorSceneState || state.localPlayer !== priorPlayer) {
                        throw new Error('production reconnect discarded its existing scene');
                    }
                } else if (reader.sceneState() !== 0 || state.localPlayer === priorPlayer) {
                    throw new Error('production relogin did not reset the prior session state');
                }
            }

            const inboundCount = stream.inboundFrameCount;
            const packetListenerStart = packetListenerOpcodes.length;
            // tcpIn returns false for LOGOUT to stop the frame; the adapter notifies only true returns.
            const logoutOpcode = protocol.server.find(descriptor => descriptor.name === 'LOGOUT')?.id;
            const expectedListenerOpcodes = segment.frames
                .filter(frame => frame.direction === 'in')
                .map(frame => decodeRecordedFrame(frame, protocol.server)[0]!)
                .filter(opcode => opcode !== logoutOpcode);
            for (const checkpoint of segment.checkpoints) {
                stream.exposeInboundThrough(checkpoint.inboundCount);
                let frames = 0;
                while (
                    stream.consumedInboundCount < checkpoint.inboundCount ||
                    reader.sceneState() !== 2 ||
                    (state.onDemand?.remaining() ?? 0) !== 0
                ) {
                    if (frames >= MAX_FRAMES_PER_CHECKPOINT) {
                        throw new Error(`replay checkpoint ${checkpoint.label} exceeded the 5000-frame limit`);
                    }
                    await client.mainloop();
                    frames++;
                    if (stream.consumedInboundCount > checkpoint.inboundCount) {
                        throw new Error(`replay checkpoint ${checkpoint.label} consumed beyond its inbound count`);
                    }
                    for (const worker of workers) {
                        if (worker.failure) throw new Error('replay requested an OnDemand file absent from the cache bundle');
                    }
                }
                if (stream.consumedInboundCount !== checkpoint.inboundCount) {
                    throw new Error(`replay checkpoint ${checkpoint.label} did not consume its exact inbound count`);
                }

                const { state: actual, sceneBuild } = readReplayCheckpoint(state, reader);
                if (!isDeepStrictEqual(actual, checkpoint.state)) {
                    throw new Error(`replay checkpoint ${checkpoint.label} differs from its captured adapter state`);
                }
                checkpointReports.push({
                    label: checkpoint.label,
                    inboundCount: checkpoint.inboundCount,
                    frames,
                    state: actual,
                    sceneBuild
                });
                onCheckpoint?.({
                    label: checkpoint.label,
                    inboundCount: checkpoint.inboundCount,
                    state: actual,
                    sceneBuild,
                    adapter: reader
                });
            }

            if (segment.end.inboundCount !== inboundCount) {
                throw new Error('recording end inbound count differs from its frames');
            }
            stream.exposeInboundThrough(segment.end.inboundCount);
            let endFrames = 0;
            while (
                stream.consumedInboundCount < segment.end.inboundCount ||
                (state.onDemand?.remaining() ?? 0) !== 0
            ) {
                if (endFrames >= MAX_FRAMES_PER_CHECKPOINT) {
                    throw new Error('replay segment exceeded the 5000-frame packet drain limit');
                }
                await client.mainloop();
                endFrames++;
                if (stream.consumedInboundCount > segment.end.inboundCount) {
                    throw new Error('replay segment consumed beyond its end inbound count');
                }
                for (const worker of workers) {
                    if (worker.failure) throw new Error('replay requested an OnDemand file absent from the cache bundle');
                }
            }
            if (stream.consumedInboundCount !== segment.end.inboundCount) {
                throw new Error('replay segment did not consume its exact end inbound count');
            }
            if (segment.end.reason === 'logout' && reader.ingame()) {
                throw new Error('recorded LOGOUT did not run the production logout path');
            }

            const processedOpcodes = packetListenerOpcodes.slice(packetListenerStart);
            if (
                processedOpcodes.length !== expectedListenerOpcodes.length ||
                expectedListenerOpcodes.some((opcode, index) => processedOpcodes[index] !== opcode)
            ) {
                throw new Error('production packet listener did not process the recorded inbound opcode sequence');
            }
            const recordedOutboundCount = segment.frames.filter(frame => frame.direction === 'out').length;
            if (recordedOutboundCount !== segment.end.outboundCount) {
                throw new Error('recording end outbound count differs from its frames');
            }
            runtimeOutboundChunks = runtimeOutboundChunks.concat(stream.outboundChunks);
            priorPlayer = state.localPlayer;
            priorGeneration = state.statSessionGeneration;
            priorSceneState = reader.sceneState();
            if (!segments[segmentIndex + 1]?.login.reconnect) {
                await client.logoutReplay();
                if (reader.ingame()) throw new Error('production logout did not leave the client logged out');
            } else if (!reader.ingame()) {
                throw new Error('replay reconnect has no live preceding session');
            }
        }

        if (checkpointReports.length === 0) {
            throw new Error('recording contains no replay checkpoints');
        }
        const emitted = decodeRuntimeOutput(runtimeOutboundChunks, protocol.client);
        return {
            revision: header.revision,
            segmentCount: segments.length,
            checkpointCount: checkpointReports.length,
            packetListenerCount: packetListenerOpcodes.length,
            checkpoints: checkpointReports,
            recordedOpcodeCoverage: {
                inbound: opcodeCoverage(check.seenOpcodes.inbound, protocol.server),
                outbound: opcodeCoverage(check.seenOpcodes.outbound, protocol.client)
            },
            runtimeOutbound: emitted,
            boot: {
                mode: 'production-maininit',
                substitutedSteps: ['Jpeg.decodeJpeg: jpeg-js', 'loginKey: synthetic public parameters'],
                mainredrawCalls: 0,
                onDemandWireParser: false,
                gameSockets: false
            }
        };
    } finally {
        try {
            setPacketListener?.(null);
            detachAdapter?.();
            if (replayClient) {
                try {
                    await replayClient.logoutReplay();
                } finally {
                    replayClient.disposeReplay();
                }
            }
        } finally {
            if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
            else Reflect.deleteProperty(globalThis, 'fetch');
            restoreJpegDecoder?.();
            restoreLoginKey?.();
            restoreClientSettings?.();
            archiveServer?.close();
            TARGET.wsHost = previousTarget.wsHost;
            TARGET.tls = previousTarget.tls;
            if (previousTarget.httpPrefix === undefined) delete TARGET.httpPrefix;
            else TARGET.httpPrefix = previousTarget.httpPrefix;
            if (previousSecureOrigin === undefined) delete process.env.SECURE_ORIGIN;
            else process.env.SECURE_ORIGIN = previousSecureOrigin;
            if (previousStrictPackets === undefined) delete process.env.STRICT_PACKETS;
            else process.env.STRICT_PACKETS = previousStrictPackets;
            if (previousStrictConfig === undefined) delete process.env.STRICT_CONFIG;
            else process.env.STRICT_CONFIG = previousStrictConfig;
            restoreCanvas();
        }
    }
}


function installSyntheticLoginKey(): () => void {
    const previous = { ...loginKey };
    // Login writes are discarded. Scope these parameters even when another test already cached the key module.
    mock.module('#/client/config/loginKey.js', () => ({
        ...previous,
        loginModulus: () => 65537n,
        loginExponent: () => 65537n
    }));
    return () => { mock.module('#/client/config/loginKey.js', () => previous); };
}

export async function installCanvasMock(): Promise<() => void> {
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
        throw new Error('replay requires happy-dom canvas globals');
    }
    if (!document.body) throw new Error('replay test document has no body');

    function fake2d(canvas: HTMLCanvasElement) {
        return {
            fillStyle: '#000',
            strokeStyle: '#000',
            font: '10px sans-serif',
            textAlign: 'left' as CanvasTextAlign,
            createImageData(width: number, height: number) {
                return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: 'srgb' as const };
            },
            getImageData(_x: number, _y: number, width: number, height: number) {
                return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: 'srgb' as const };
            },
            putImageData() {},
            fillRect() {},
            strokeRect() {},
            fillText() {},
            measureText: () => ({ width: 8 }),
            drawImage() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            stroke() {},
            save() {},
            restore() {},
            clearRect() {},
            canvas
        };
    }

    const priorContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: function (this: HTMLCanvasElement, type: string) {
            return type === '2d' ? fake2d(this) : null;
        }
    });

    const existingCanvas = document.querySelector<HTMLCanvasElement>('#canvas');
    const canvas = existingCanvas ?? document.createElement('canvas');
    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    if (!existingCanvas) {
        canvas.id = 'canvas';
        document.body.appendChild(canvas);
    }
    canvas.width = 800;
    canvas.height = 600;
    // Test loading boundary: another test may have imported Canvas before a DOM canvas existed.
    const { canvas: priorCanvas, canvas2d: priorCanvas2d } = await import('#/client/graphics/Canvas.js');
    mock.module('#/client/graphics/Canvas.js', () => ({ canvas, canvas2d: fake2d(canvas) }));

    return () => {
        mock.module('#/client/graphics/Canvas.js', () => ({ canvas: priorCanvas, canvas2d: priorCanvas2d }));
        if (existingCanvas) {
            canvas.width = previousWidth;
            canvas.height = previousHeight;
        } else {
            canvas.remove();
        }
        if (priorContext) {
            Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', priorContext);
        } else {
            Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
        }
    };
}

function installJpegDecoder(): () => void {
    const previous = decodeJpeg;
    // happy-dom cannot load an HTMLImageElement. Decode the captured JPEG bytes, not synthetic pixels.
    mock.module('#/client/graphics/Jpeg.js', () => ({
        async decodeJpeg(data: Uint8Array): Promise<ImageData> {
            // Match the production decoder's repair of the cache's JPEG marker.
            if (data[0] !== 0xff) data[0] = 0xff;
            const image = decodeJpegBytes(data, { useTArray: true });
            return {
                width: image.width,
                height: image.height,
                // jpeg-js allocates a new Uint8Array, never a shared buffer; reuse its storage.
                data: new Uint8ClampedArray(image.data.buffer as ArrayBuffer, image.data.byteOffset, image.data.byteLength),
                colorSpace: 'srgb'
            };
        }
    }));
    return () => {
        mock.module('#/client/graphics/Jpeg.js', () => ({ decodeJpeg: previous }));
    };
}
