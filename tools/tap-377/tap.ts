import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, realpath, rm, stat, type FileHandle } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import Isaac from '../../src/client/io/Isaac.js';
import { ARCHIVES, type ArchiveName, type CacheBundle, type CheckpointState, type EndRecord, type LoginRecord, type Protocol, type RecordingHeader, type RecordingRecord } from './format.js';
import { checkRecording } from './check-recording.js';
import { loadEngineProtocol } from './protocol.js';
import { GameFrameDecoder, OnDemandStream, OnDemandFinishError, type DecodedFrame } from './wire.js';
import { decryptRsaBlock, readRsaPrivateKey, type RsaPrivateKey } from './rsa.js';

export interface TapOptions {
    engineDir: string;
    origin: string;
    recordingPath: string;
    cachePath: string;
    accountPrefix: string;
    clientCommit: string;
    contentCommit: string;
    port?: number;
    requestHandler?: (request: Request) => Response | undefined | Promise<Response | undefined>;
    assetRoot?: string;
    page?: string;
}

export interface TapDiagnostics {
    activeSegment: number | null;
    inboundCount: number;
    outboundCount: number;
    failures: string[];
    pendingCounts: { clientToServer: number; serverToClient: number; onDemand: number };
    seenOpcodes: { inbound: string[]; outbound: string[] };
    failedConnections: number;
    rejectedLoginReplies: number[];
}

export interface TapSession {
    readonly url: string;
    readonly origin: string;
    readonly records: readonly RecordingRecord[];
    readonly diagnostics: TapDiagnostics;
    checkpoint(label: string, state: CheckpointState, inboundCount?: number): void;
    finalize(reason?: 'logout' | 'reconnect'): Promise<{
        recordingPath: string;
        cachePath: string;
        records: readonly RecordingRecord[];
    }>;
    close(): Promise<void>;
}

interface SegmentState {
    number: number;
    inboundCount: number;
    outboundCount: number;
    inboundOrdinal: number;
    outboundOrdinal: number;
    tick: number;
    lastCheckpointInboundCount: number;
    logoutSeen: boolean;
    ended: boolean;
}

interface LoginMaterial {
    reconnect: boolean;
    seed: Int32Array;
}

interface SocketData {
    connection: ProxyConnection;
}

type Socket = Bun.ServerWebSocket<SocketData>;
type ProxyKind = 'unknown' | 'game' | 'ondemand';

export class Recorder {
    readonly records: RecordingRecord[] = [];
    readonly failures = new Set<string>();
    readonly seen = { inbound: new Set<string>(), outbound: new Set<string>() };
    active: SegmentState | null = null;
    failedConnections = 0;
    private readonly rejectedLoginReplies: number[] = [];
    private lastSegment = 0;

    fail(code: string): void {
        this.failures.add(code);
    }

    startSegment(login: LoginRecord): SegmentState {
        if (this.active) {
            if (this.active.logoutSeen) {
                this.endSegment(this.active, 'logout');
            } else if (login.reconnect) {
                this.endSegment(this.active, 'reconnect');
            } else {
                this.fail('segment-boundary-missing');
                throw new Error('tap session failed');
            }
        }
        const segment: SegmentState = {
            number: ++this.lastSegment,
            inboundCount: 0,
            outboundCount: 0,
            inboundOrdinal: 1,
            outboundOrdinal: 1,
            tick: 0,
            lastCheckpointInboundCount: 0,
            logoutSeen: false,
            ended: false
        };
        this.active = segment;
        this.records.push({ ...login, segment: segment.number });
        return segment;
    }

    lastLogin(): LoginRecord | null {
        for (let index = this.records.length - 1; index >= 0; index--) {
            const record = this.records[index];
            if (record?.type === 'login') return record;
        }
        return null;
    }

    recordRejectedLoginReply(reply: 5): boolean {
        if (!this.active?.logoutSeen) return false;
        this.rejectedLoginReplies.push(reply);
        return true;
    }

    frame(segment: SegmentState, frame: DecodedFrame): void {
        if (this.active !== segment || segment.ended) {
            this.fail('frame-outside-active-segment');
            throw new Error('tap session failed');
        }
        const direction = frame.direction;
        if (direction === 'in') {
            if (frame.descriptor.name === 'PLAYER_INFO') segment.tick++;
            if (frame.descriptor.name === 'LOGOUT') segment.logoutSeen = true;
            segment.inboundCount++;
            this.records.push({
                type: 'frame',
                segment: segment.number,
                direction,
                tick: segment.tick,
                ordinal: segment.inboundOrdinal++,
                bytes: Buffer.from(frame.bytes).toString('hex')
            });
        } else {
            segment.outboundCount++;
            this.records.push({
                type: 'frame',
                segment: segment.number,
                direction,
                tick: segment.tick,
                ordinal: segment.outboundOrdinal++,
                bytes: Buffer.from(frame.bytes).toString('hex')
            });
        }
        this.seen[direction === 'in' ? 'inbound' : 'outbound'].add(frame.descriptor.name);
    }

    checkpoint(label: string, state: CheckpointState, inboundCount: number): void {
        const segment = this.active;
        if (!segment || segment.ended || !safeLabel(label) || !validCheckpointState(state)) {
            this.fail('checkpoint-invalid');
            throw new Error('tap checkpoint rejected');
        }
        if (
            !Number.isSafeInteger(inboundCount) ||
            inboundCount < segment.lastCheckpointInboundCount ||
            inboundCount > segment.inboundCount
        ) {
            this.fail('checkpoint-inbound-count');
            throw new Error('tap checkpoint rejected');
        }
        segment.lastCheckpointInboundCount = inboundCount;
        this.records.push({
            type: 'checkpoint',
            segment: segment.number,
            label,
            inboundCount,
            state: {
                serverTile: { ...state.serverTile },
                sceneState: state.sceneState,
                ingame: state.ingame,
                sceneInstanced: state.sceneInstanced,
                mapBuildBaseX: state.mapBuildBaseX,
                mapBuildBaseZ: state.mapBuildBaseZ
            }
        });
    }

    endSegment(segment: SegmentState, reason: EndRecord['reason']): void {
        if (this.active !== segment || segment.ended) {
            this.fail('segment-end-invalid');
            throw new Error('tap session failed');
        }
        if ((reason === 'logout' && !segment.logoutSeen) || (reason === 'reconnect' && segment.logoutSeen)) {
            this.fail('segment-end-unobserved');
            throw new Error('tap session failed');
        }
        segment.ended = true;
        this.records.push({
            type: 'end',
            segment: segment.number,
            reason,
            inboundCount: segment.inboundCount,
            outboundCount: segment.outboundCount
        });
        this.active = null;
    }

    getDiagnostics(pendingCounts: TapDiagnostics['pendingCounts']): TapDiagnostics {
        return {
            activeSegment: this.active?.number ?? null,
            inboundCount: this.active?.inboundCount ?? 0,
            outboundCount: this.active?.outboundCount ?? 0,
            failures: [...this.failures],
            pendingCounts: { ...pendingCounts },
            seenOpcodes: { inbound: [...this.seen.inbound], outbound: [...this.seen.outbound] },
            failedConnections: this.failedConnections,
            rejectedLoginReplies: [...this.rejectedLoginReplies]
        };
    }

    buildRecords(header: RecordingHeader): RecordingRecord[] {
        return [header, ...this.records];
    }
}

export class GameConnection {
    private clientStage: 'handshake' | 'await-seed' | 'login' | 'await-reply' | 'game' | 'rejected' | 'failed' = 'handshake';
    private serverStage: 'hello' | 'handshake-reply' | 'seed' | 'login-reply' | 'login-meta' | 'game' | 'rejected' | 'failed' = 'hello';
    private handshakeSent = 0;
    private serverControl: Uint8Array = new Uint8Array();
    private clientLoginBytes: Uint8Array = new Uint8Array();
    private clientPostReply: Uint8Array = new Uint8Array();
    private challengeSeed: Uint8Array | null = null;
    private replies: number[] = [];
    private pendingLogin: LoginMaterial | null = null;
    private segment: SegmentState | null = null;
    private inboundDecoder: GameFrameDecoder | null = null;
    private outboundDecoder: GameFrameDecoder | null = null;
    private closed = false;

    constructor(
        private readonly protocol: Protocol,
        private readonly privateKey: RsaPrivateKey,
        private readonly modulusBytes: number,
        private readonly accountPrefix: string,
        private readonly recorder: Recorder
    ) {}

    get pendingClientBytes(): number {
        return this.clientLoginBytes.length + this.clientPostReply.length + (this.outboundDecoder?.pendingBytes ?? 0);
    }

    get pendingServerBytes(): number {
        return this.serverControl.length + (this.inboundDecoder?.pendingBytes ?? 0);
    }

    handleClient(bytes: Uint8Array, send: (bytes: Uint8Array) => void): void {
        if (this.closed || this.clientStage === 'failed') return;
        if (this.clientStage === 'rejected') {
            if (bytes.length > 0) this.reject('game-login-reply-extra');
            return;
        }
        let offset = 0;
        while (offset < bytes.length) {
            if (this.clientStage === 'handshake') {
                const count = Math.min(2 - this.handshakeSent, bytes.length - offset);
                send(bytes.subarray(offset, offset + count));
                offset += count;
                this.handshakeSent += count;
                if (this.handshakeSent === 2) this.clientStage = 'await-seed';
                continue;
            }
            if (this.clientStage === 'await-seed' || this.clientStage === 'login') {
                this.clientLoginBytes = append(this.clientLoginBytes, bytes.subarray(offset));
                offset = bytes.length;
                this.tryLogin(send);
                continue;
            }
            if (this.clientStage === 'await-reply') {
                this.clientPostReply = append(this.clientPostReply, bytes.subarray(offset));
                offset = bytes.length;
                continue;
            }
            if (this.clientStage === 'game') {
                const part = bytes.subarray(offset);
                this.outboundDecoder!.push(part);
                send(part);
                offset = bytes.length;
                continue;
            }
        }
    }

    handleServer(bytes: Uint8Array, send: (bytes: Uint8Array) => void, sendClient: (bytes: Uint8Array) => void): void {
        if (this.closed || this.serverStage === 'failed') return;
        sendClient(bytes);
        if (this.serverStage === 'rejected') {
            if (bytes.length > 0) this.reject('game-login-reply-extra');
            return;
        }
        this.serverControl = append(this.serverControl, bytes);
        while (true) {
            if (this.serverStage === 'hello') {
                if (this.serverControl.length < 8) return;
                for (const byte of this.serverControl.subarray(0, 8)) {
                    if (byte !== 0) this.reject('game-handshake-invalid');
                }
                this.serverControl = this.serverControl.slice(8);
                this.serverStage = 'handshake-reply';
                continue;
            }
            if (this.serverStage === 'handshake-reply') {
                if (this.serverControl.length < 1) return;
                const reply = this.serverControl[0];
                this.serverControl = this.serverControl.slice(1);
                this.replies.push(reply);
                if (reply !== 0) this.reject('game-handshake-rejected');
                this.serverStage = 'seed';
                continue;
            }
            if (this.serverStage === 'seed') {
                if (this.serverControl.length < 8) return;
                this.challengeSeed = this.serverControl.slice(0, 8);
                this.serverControl = this.serverControl.slice(8);
                this.clientStage = 'login';
                this.serverStage = 'login-reply';
                this.tryLogin(send);
                continue;
            }
            if (this.serverStage === 'login-reply') {
                if (!this.pendingLogin || this.serverControl.length < 1) return;
                const reply = this.serverControl[0];
                this.serverControl = this.serverControl.slice(1);
                this.replies.push(reply);
                if (reply === 2) {
                    this.serverStage = 'login-meta';
                    continue;
                }
                if (reply === 15 && this.pendingLogin.reconnect) {
                    const previousLogin = this.recorder.lastLogin();
                    this.openGame(previousLogin?.staffmodlevel ?? 0, previousLogin?.mouseTracked ?? false, send);
                    this.serverStage = 'game';
                    continue;
                }
                if (reply === 5) {
                    if (this.serverControl.length > 0 || this.clientLoginBytes.length > 0 || this.clientPostReply.length > 0) {
                        this.reject('game-login-reply-extra');
                    }
                    if (!this.recorder.recordRejectedLoginReply(reply)) {
                        this.reject('game-login-rejected');
                    }
                    this.clientStage = 'rejected';
                    this.serverStage = 'rejected';
                    this.clearSecrets();
                    return;
                }
                this.reject('game-login-rejected');
            }
            if (this.serverStage === 'login-meta') {
                if (this.serverControl.length < 2) return;
                const staffmodlevel = this.serverControl[0];
                const mouseTracked = this.serverControl[1];
                this.serverControl = this.serverControl.slice(2);
                if (mouseTracked > 1) this.reject('game-login-reply-invalid');
                this.openGame(staffmodlevel, mouseTracked === 1, send);
                this.serverStage = 'game';
                continue;
            }
            if (this.serverStage === 'game') {
                if (this.serverControl.length > 0) {
                    const pending = this.serverControl;
                    this.serverControl = new Uint8Array();
                    this.inboundDecoder!.push(pending);
                }
                return;
            }
            return;
        }
    }

    finish(): void {
        if (this.closed) return;
        this.closed = true;
        if (
            this.clientStage !== 'game' &&
            this.clientStage !== 'rejected' &&
            (this.handshakeSent > 0 || this.replies.length > 0 || this.clientLoginBytes.length > 0 || this.pendingLogin)
        ) {
            this.recorder.fail('incomplete-game-handshake');
        }
        if (this.clientLoginBytes.length > 0 || this.clientPostReply.length > 0 || this.serverControl.length > 0) {
            this.recorder.fail('truncated-game-control');
        }
        try {
            this.inboundDecoder?.finish();
            this.outboundDecoder?.finish();
        } catch {
            this.recorder.fail('truncated-game-frame');
        }
        this.clearSecrets();
    }

    private tryLogin(send: (bytes: Uint8Array) => void): void {
        if (!this.challengeSeed || !this.clientLoginBytes.length || this.clientStage === 'await-reply') return;
        if (this.clientLoginBytes.length < 2) return;
        const opcode = this.clientLoginBytes[0];
        if (opcode !== 16 && opcode !== 18) this.reject('game-login-envelope-invalid');
        const length = this.clientLoginBytes[1];
        const total = 2 + length;
        if (length < 41 || total > 257) this.reject('game-login-envelope-invalid');
        if (this.clientLoginBytes.length < total) return;

        const loginPacket = this.clientLoginBytes.slice(0, total);
        const tail = this.clientLoginBytes.slice(total);
        this.clientLoginBytes.fill(0);
        this.clientLoginBytes = new Uint8Array();
        try {
            this.pendingLogin = decodeLoginPacket(
                loginPacket,
                this.privateKey,
                this.modulusBytes,
                this.protocol.revision,
                this.challengeSeed,
                this.accountPrefix
            );
        } catch {
            loginPacket.fill(0);
            tail.fill(0);
            this.reject('account-prefix-or-login-invalid');
        }
        this.challengeSeed.fill(0);
        this.challengeSeed = null;
        this.clientStage = 'await-reply';
        if (tail.length > 0) this.clientPostReply = append(this.clientPostReply, tail);
        try {
            send(loginPacket);
        } finally {
            loginPacket.fill(0);
            tail.fill(0);
        }
    }

    private openGame(staffmodlevel: number, mouseTracked: boolean, send: (bytes: Uint8Array) => void): void {
        const pending = this.pendingLogin;
        if (!pending) this.reject('game-login-state-invalid');
        const login: LoginRecord = {
            type: 'login',
            segment: 0,
            replies: [...this.replies],
            staffmodlevel,
            mouseTracked,
            reconnect: pending.reconnect
        };
        let segment: SegmentState;
        try {
            segment = this.recorder.startSegment(login);
        } catch {
            this.reject('segment-boundary-missing');
        }
        const outgoingSeed = new Int32Array(pending.seed);
        const incomingSeed = new Int32Array(pending.seed);
        for (let index = 0; index < 4; index++) incomingSeed[index] += 50;
        pending.seed.fill(0);
        this.pendingLogin = null;
        this.segment = segment!;
        this.inboundDecoder = new GameFrameDecoder('in', this.protocol, new Isaac(incomingSeed), frame => this.recorder.frame(segment!, frame));
        this.outboundDecoder = new GameFrameDecoder('out', this.protocol, new Isaac(outgoingSeed), frame => this.recorder.frame(segment!, frame));
        outgoingSeed.fill(0);
        incomingSeed.fill(0);
        this.clientStage = 'game';
        if (this.clientPostReply.length > 0) {
            const pendingBytes = this.clientPostReply;
            this.clientPostReply = new Uint8Array();
            this.outboundDecoder.push(pendingBytes);
            send(pendingBytes);
        }
    }

    private reject(code: string): never {
        if (this.clientStage !== 'failed' && this.serverStage !== 'failed') {
            this.clientStage = 'failed';
            this.serverStage = 'failed';
            this.recorder.fail(code);
            this.recorder.failedConnections++;
            this.clearSecrets();
        }
        throw new Error('tap session failed');
    }

    private clearSecrets(): void {
        this.challengeSeed?.fill(0);
        this.challengeSeed = null;
        this.pendingLogin?.seed.fill(0);
        this.pendingLogin = null;
        this.clientLoginBytes.fill(0);
        this.clientLoginBytes = new Uint8Array();
        this.clientPostReply.fill(0);
        this.clientPostReply = new Uint8Array();
        this.serverControl.fill(0);
        this.serverControl = new Uint8Array();
        this.replies.fill(0);
        this.replies = [];
    }
}

class ProxyConnection {
    kind: ProxyKind = 'unknown';
    upstream: WebSocket | null = null;
    upstreamOpen = false;
    intentionalClose = false;
    private readonly queuedClient: Uint8Array[] = [];
    private game: GameConnection | null = null;
    private ondemand: OnDemandStream | null = null;

    constructor(
        readonly recorder: Recorder,
        private readonly protocol: Protocol,
        private readonly key: RsaPrivateKey,
        private readonly modulusBytes: number,
        private readonly accountPrefix: string,
        private readonly onArchive: (archive: number, file: number, bytes: Uint8Array) => void,
        private readonly onFailure: (code: string) => void,
        private readonly clients: Set<ProxyConnection>
    ) {}

    get pendingClientBytes(): number {
        return this.game?.pendingClientBytes ?? this.ondemand?.pendingBytes ?? 0;
    }

    get pendingServerBytes(): number {
        return this.game?.pendingServerBytes ?? this.ondemand?.pendingBytes ?? 0;
    }

    get pendingGameBytes(): number {
        return (this.game?.pendingClientBytes ?? 0) + (this.game?.pendingServerBytes ?? 0);
    }

    get pendingOnDemand(): number {
        return this.ondemand?.pendingCount ?? 0;
    }

    get hasPendingWork(): boolean {
        return (
            (this.game?.pendingClientBytes ?? 0) !== 0 ||
            (this.game?.pendingServerBytes ?? 0) !== 0 ||
            (this.ondemand?.hasPendingWork ?? false)
        );
    }

    openClient(upstreamUrl: string, downstream: Socket): void {
        try {
            const socket = new WebSocket(upstreamUrl, 'binary');
            socket.binaryType = 'arraybuffer';
            this.upstream = socket;
            socket.addEventListener('open', () => {
                if (this.intentionalClose) {
                    socket.close(1000, 'proxy closed');
                    return;
                }
                this.upstreamOpen = true;
                for (const bytes of this.queuedClient.splice(0)) this.sendUpstream(bytes);
            }, { once: true });
            socket.addEventListener('message', event => {
                try {
                    const bytes = binaryBytes(event.data);
                    this.handleServer(bytes, downstream);
                } catch {
                    this.fail('upstream-data-invalid', downstream);
                }
            });
            socket.addEventListener('error', () => {
                if (!this.intentionalClose) this.fail('upstream-error', downstream);
            });
            socket.addEventListener('close', () => {
                this.upstreamOpen = false;
                this.finishStreams();
                if (!this.intentionalClose) downstream.close(1000, 'proxy closed');
                this.clients.delete(this);
            });
        } catch {
            this.fail('upstream-connect-failed', downstream);
        }
    }

    handleClient(bytes: Uint8Array, downstream: Socket): void {
        if (this.intentionalClose) return;
        try {
            if (this.kind === 'unknown') {
                if (bytes.length === 0) return;
                if (bytes[0] === 14) {
                    this.kind = 'game';
                    this.game = new GameConnection(this.protocol, this.key, this.modulusBytes, this.accountPrefix, this.recorder);
                } else if (bytes[0] === 15) {
                    this.kind = 'ondemand';
                    this.ondemand = new OnDemandStream(
                        (archive, file) => this.addRequest(archive, file),
                        (archive, file, data) => this.onArchive(archive, file, data)
                    );
                } else {
                    this.fail('unknown-websocket-handshake', downstream);
                    return;
                }
            }
            if (this.kind === 'game') {
                this.game!.handleClient(bytes, data => this.sendUpstream(data));
            } else if (this.kind === 'ondemand') {
                this.ondemand!.pushClient(bytes);
                this.sendUpstream(bytes);
            }
        } catch {
            this.fail(this.kind === 'game' ? 'game-protocol-invalid' : 'ondemand-protocol-invalid', downstream);
        }
    }

    handleServer(bytes: Uint8Array, downstream: Socket): void {
        if (this.intentionalClose) return;
        try {
            if (this.kind === 'game') {
                this.game!.handleServer(bytes, data => this.sendUpstream(data), data => downstream.send(data));
            } else if (this.kind === 'ondemand') {
                this.ondemand!.pushServer(bytes);
                downstream.send(bytes);
            } else {
                this.fail('server-before-handshake', downstream);
            }
        } catch {
            this.fail(this.kind === 'game' ? 'game-protocol-invalid' : 'ondemand-protocol-invalid', downstream);
        }
    }

    checkComplete(): void {
        try {
            this.game?.finish();
        } catch {
            this.recorder.fail('incomplete-game-stream');
        }
        try {
            this.ondemand?.finish();
        } catch (error) {
            this.recorder.fail('incomplete-ondemand-stream');
            if (error instanceof OnDemandFinishError) {
                for (const predicate of error.predicates) this.recorder.fail(`ondemand-finish-${predicate}`);
            }
        }
    }

    close(downstream?: Socket): void {
        this.intentionalClose = true;
        this.checkComplete();
        this.upstream?.close(1000, 'proxy closed');
        downstream?.close(1000, 'proxy closed');
        this.clients.delete(this);
    }

    private addRequest(archive: number, file: number): void {
        if (archive < 0 || archive > 3 || file < 0 || file > 0xffff) {
            this.recorder.fail('ondemand-request-invalid');
            throw new Error('tap session failed');
        }
    }

    private sendUpstream(bytes: Uint8Array): void {
        if (this.intentionalClose) return;
        const socket = this.upstream;
        if (!socket || !this.upstreamOpen || socket.readyState !== WebSocket.OPEN) {
            this.queuedClient.push(bytes.slice());
            return;
        }
        try {
            socket.send(bytes);
        } catch {
            this.onFailure('upstream-send-failed');
            socket.close(1011, 'proxy closed');
        }
    }

    private fail(code: string, downstream: Socket): void {
        this.onFailure(code);
        this.intentionalClose = true;
        this.game?.finish();
        this.upstream?.close(1011, 'proxy closed');
        downstream.close(1011, 'proxy closed');
        this.clients.delete(this);
    }

    private finishStreams(): void {
        if (this.intentionalClose) return;
        this.checkComplete();
    }
}

export function archiveForRequest(url: URL): ArchiveName | null {
    for (const archive of ARCHIVES) {
        const prefix = `/${archive}`;
        if (!url.pathname.startsWith(prefix)) continue;
        const suffix = url.pathname.slice(prefix.length);
        if (archive === 'crc' ? /^[A-Za-z0-9_-]*$/.test(suffix) : /^(?:-?[0-9]+)?$/.test(suffix)) return archive;
    }
    return null;
}

export async function startTap(options: TapOptions): Promise<TapSession> {
    let engineDirectory: string;
    let engineOrigin: URL;
    let protocol: Protocol;
    let privateKey: RsaPrivateKey;
    let modulusBytes: number;
    let engineCommit: string;
    try {
        engineDirectory = await realpath(resolve(options.engineDir));
        engineOrigin = normalizeOrigin(options.origin);
        protocol = loadEngineProtocol(engineDirectory);
        if (!/^[0-9a-f]{40}$/.test(options.clientCommit) || !/^[0-9a-f]{40}$/.test(options.contentCommit)) {
            throw new Error('invalid capture identity');
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(options.accountPrefix)) {
            throw new Error('invalid account prefix');
        }
        engineCommit = execFileSync('git', ['-C', engineDirectory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        if (!/^[0-9a-f]{40}$/.test(engineCommit)) throw new Error('invalid engine commit');
        const keyBytes = await readFile(join(engineDirectory, 'data/config/private.pem'));
        try {
            privateKey = readRsaPrivateKey(keyBytes);
        } finally {
            keyBytes.fill(0);
        }
        modulusBytes = Math.ceil(privateKey.modulus.toString(16).length / 2);
        if (!options.recordingPath || !options.cachePath || resolve(options.recordingPath) === resolve(options.cachePath)) {
            throw new Error('invalid output paths');
        }
        if (isInside(engineDirectory, resolve(options.recordingPath)) || isInside(engineDirectory, resolve(options.cachePath))) {
            throw new Error('output paths overlap engine');
        }
    } catch {
        throw new Error('tap setup failed');
    }

    const recordingPath = resolve(options.recordingPath);
    const cachePath = resolve(options.cachePath);
    const recorder = new Recorder();
    const archives = new Map<ArchiveName, Uint8Array>();
    const ondemand = new Map<string, Uint8Array>();
    const connections = new Set<ProxyConnection>();
    let closed = false;
    let finalized = false;

    let inFlightArchiveRequests = 0;
    const requestHandler = options.requestHandler;
    const assetRoot = options.assetRoot ? await realpath(resolve(options.assetRoot)).catch(() => null) : null;
    if (options.assetRoot && !assetRoot) throw new Error('tap setup failed');
    const page = options.page ?? 'bot.html';
    if (assetRoot && (!safeRelativePath(page) || page.startsWith('/'))) throw new Error('tap setup failed');

    const addFailure = (code: string): void => {
        const safe = /^[a-z0-9-]{1,48}$/.test(code) ? code : 'tap-error';
        recorder.fail(safe);
    };
    const captureArchive = (archive: ArchiveName, bytes: Uint8Array): void => {
        const existing = archives.get(archive);
        if (existing && !equalBytes(existing, bytes)) {
            addFailure('archive-response-conflict');
            return;
        }
        archives.set(archive, bytes.slice());
    };
    const captureOnDemand = (archive: number, file: number, bytes: Uint8Array): void => {
        const key = `${archive}/${file}`;
        const existing = ondemand.get(key);
        if (existing && !equalBytes(existing, bytes)) {
            addFailure('ondemand-file-conflict');
            return;
        }
        if (bytes.length < 2) {
            addFailure('ondemand-file-truncated');
            return;
        }
        ondemand.set(key, bytes.slice());
    };


    const handleHttp = async (request: Request): Promise<Response> => {
        const sourceUrl = new URL(request.url);
        const archive = archiveForRequest(sourceUrl);
        const captureArchiveRequest = archive !== null && request.method === 'GET';
        if (captureArchiveRequest) inFlightArchiveRequests++;
        try {
            try {
                if (requestHandler) {
                    const handled = await requestHandler(request);
                    if (handled instanceof Response) return handled;
                }
            } catch {
                addFailure('request-handler-failed');
                return new Response('tap request failed', { status: 500 });
            }
            if (assetRoot) {
                const asset = await serveAsset(request, assetRoot, page);
                if (asset) return asset;
            }
            const target = new URL(sourceUrl.pathname + sourceUrl.search, engineOrigin);
            const headers = new Headers(request.headers);
            for (const name of ['connection', 'host', 'upgrade', 'origin', 'content-length', 'accept-encoding']) headers.delete(name);
            headers.set('accept-encoding', 'identity');
            let body: ArrayBuffer | undefined;
            if (request.method !== 'GET' && request.method !== 'HEAD') body = await request.arrayBuffer();
            let response: Response;
            try {
                response = await fetch(target, { method: request.method, headers, body });
            } catch {
                addFailure('http-upstream-failed');
                return new Response('tap upstream failed', { status: 502 });
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (archive && request.method === 'GET') {
                if (response.status === 200) captureArchive(archive, bytes);
                else if (response.status !== 304) addFailure('archive-fetch-failed');
            }
            const resultHeaders = new Headers(response.headers);
            for (const name of ['connection', 'transfer-encoding', 'content-encoding', 'content-length']) resultHeaders.delete(name);
            const responseBody = request.method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : bytes;
            return new Response(responseBody, { status: response.status, statusText: response.statusText, headers: resultHeaders });
        } finally {
            if (captureArchiveRequest) inFlightArchiveRequests--;
        }
    };

    const server = Bun.serve<SocketData, Record<string, never>>({
        hostname: '127.0.0.1',
        port: options.port ?? 0,
        fetch: async (request, bunServer) => {
            if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
                const connection = new ProxyConnection(
                    recorder,
                    protocol,
                    privateKey,
                    modulusBytes,
                    options.accountPrefix,
                    captureOnDemand,
                    addFailure,
                    connections
                );
                if (bunServer.upgrade(request, { data: { connection } })) {
                    connections.add(connection);
                    return undefined;
                }
                return new Response('websocket upgrade rejected', { status: 400 });
            }
            return handleHttp(request);
        },
        websocket: {
            open(socket) {
                const websocketUrl = new URL('/', engineOrigin);
                websocketUrl.protocol = engineOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
                socket.data.connection.openClient(websocketUrl.toString(), socket);
            },
            message(socket, message) {
                try {
                    socket.data.connection.handleClient(binaryBytes(message), socket);
                } catch {
                    addFailure('client-data-invalid');
                    socket.close(1011, 'proxy closed');
                }
            },
            close(socket) {
                socket.data.connection.checkComplete();
                socket.data.connection.close();
                connections.delete(socket.data.connection);
            }
        }
    });

    const tapUrl = server.url.origin;
    const pendingCounts = (): TapDiagnostics['pendingCounts'] => {
        let clientToServer = 0;
        let serverToClient = 0;
        let onDemand = 0;
        for (const connection of connections) {
            clientToServer += connection.pendingClientBytes;
            serverToClient += connection.pendingServerBytes;
            onDemand += connection.pendingOnDemand;
        }
        return { clientToServer, serverToClient, onDemand };
    };
    const diagnostics = (): TapDiagnostics => recorder.getDiagnostics(pendingCounts());

    const drainPending = async (deadline: number): Promise<void> => {
        while (true) {
            let pending = inFlightArchiveRequests !== 0;
            if (!pending) {
                for (const connection of connections) {
                    if (connection.hasPendingWork) {
                        pending = true;
                        break;
                    }
                }
            }
            if (!pending) return;
            if (performance.now() >= deadline) {
                addFailure('finalize-drain-timeout');
                throw new Error('tap finalization drain timed out');
            }
            const poll = Promise.withResolvers<void>();
            setTimeout(poll.resolve, 25);
            await poll.promise;
        }
    };

    const closeInternal = async (markUnfinalized: boolean): Promise<void> => {
        if (closed) return;
        closed = true;
        if (markUnfinalized && !finalized) addFailure('closed-before-finalize');
        for (const connection of connections) connection.close();
        connections.clear();
        await server.stop(true);
    };

    const buildCacheBundle = (): CacheBundle => {
        const archiveData = {} as Record<ArchiveName, string>;
        for (const archive of ARCHIVES) {
            const bytes = archives.get(archive);
            if (!bytes) throw new Error('archive coverage incomplete');
            archiveData[archive] = Buffer.from(bytes).toString('base64');
        }
        const ondemandData: Record<string, string> = {};
        for (const [key, bytes] of [...ondemand].sort(([left], [right]) => left.localeCompare(right))) {
            ondemandData[key] = Buffer.from(bytes).toString('base64');
        }
        return { format: 1, archives: archiveData, ondemand: ondemandData };
    };

    const finalize = async (reason?: 'logout' | 'reconnect') => {
        if (finalized) throw new Error('tap already finalized');
        const drainDeadline = performance.now() + 30_000;
        try {
            await drainPending(drainDeadline);
            for (const connection of connections) connection.checkComplete();
            if (recorder.failures.size > 0) throw new Error('tap session failed');
            for (const archive of ARCHIVES) {
                if (!archives.has(archive)) {
                    await fetchMissingArchive(archive);
                }
            }
            if (recorder.failures.size > 0) throw new Error('tap session failed');
            await drainPending(drainDeadline);
            for (const connection of connections) connection.checkComplete();
            if (recorder.failures.size > 0) throw new Error('tap session failed');
            if (recorder.active) {
                if (recorder.active.logoutSeen) recorder.endSegment(recorder.active, 'logout');
                else if (reason === 'reconnect') recorder.endSegment(recorder.active, 'reconnect');
                else addFailure('logout-not-observed');
            }
            if (recorder.records.filter(record => record.type === 'login').length === 0) addFailure('no-successful-login');
            if (recorder.failures.size > 0) throw new Error('tap session failed');
            await closeInternal(false);
            if (recorder.failures.size > 0) throw new Error('tap session failed');
            const bundle = buildCacheBundle();
            const archiveHashes = {} as Record<ArchiveName, string>;
            for (const archive of ARCHIVES) archiveHashes[archive] = sha256(archives.get(archive)!);
            const header: RecordingHeader = {
                type: 'header',
                tapVersion: 1,
                revision: protocol.revision,
                engineCommit,
                contentCommit: options.contentCommit,
                clientCommit: options.clientCommit,
                accountPrefix: options.accountPrefix,
                archiveHashes,
                tickBasis: 'player-info'
            };
            const records = recorder.buildRecords(header);
            const check = checkRecording(records, protocol, bundle);
            if (!check.valid) {
                addFailure('recording-validation-failed');
                throw new Error('tap session failed');
            }
            const recordingBytes = Buffer.from(records.map(record => JSON.stringify(record)).join('\n') + '\n');
            const cacheBytes = Buffer.from(JSON.stringify(bundle) + '\n');
            await writePairExclusive(recordingPath, recordingBytes, cachePath, cacheBytes);
            finalized = true;
            return { recordingPath, cachePath, records };
        } catch {
            await closeInternal(false);
            throw new Error('tap finalization failed');
        }
    };

    const fetchMissingArchive = async (archive: ArchiveName): Promise<void> => {
        try {
            const headers = new Headers({ 'accept-encoding': 'identity' });
            const response = await fetch(new URL(`/${archive}`, engineOrigin), { headers });
            if (!response.ok) {
                addFailure('archive-coverage-incomplete');
                throw new Error('tap archive capture failed');
            }
            captureArchive(archive, new Uint8Array(await response.arrayBuffer()));
        } catch {
            addFailure('archive-coverage-incomplete');
            throw new Error('tap archive capture failed');
        }
    };

    return {
        url: tapUrl,
        origin: engineOrigin.origin,
        get records() {
            return [...recorder.records];
        },
        get diagnostics() {
            return diagnostics();
        },
        checkpoint(label, state, inboundCount) {
            const actualCount = recorder.active?.inboundCount ?? 0;
            if ([...connections].some(connection => connection.pendingGameBytes !== 0)) {
                addFailure('checkpoint-not-quiescent');
                throw new Error('tap checkpoint rejected');
            }
            recorder.checkpoint(label, state, inboundCount ?? actualCount);
        },
        finalize,
        async close() {
            await closeInternal(true);
        }
    };
}

export function acceptsLoginRequest(
    packet: Uint8Array,
    privateKey: RsaPrivateKey,
    accountPrefix: string,
    revision: number,
    challengeSeed: Uint8Array
): boolean {
    const modulusBytes = Math.ceil(privateKey.modulus.toString(16).length / 2);
    try {
        const parsed = decodeLoginPacket(packet, privateKey, modulusBytes, revision, challengeSeed, accountPrefix);
        parsed.seed.fill(0);
        return true;
    } catch {
        return false;
    }
}

function decodeLoginPacket(
    packet: Uint8Array,
    privateKey: RsaPrivateKey,
    modulusBytes: number,
    revision: number,
    challengeSeed: Uint8Array,
    accountPrefix: string
): LoginMaterial {
    let plaintext: Uint8Array | null = null;
    let seed: Int32Array | null = null;
    try {
        if (packet.length < 43 || packet.length !== packet[1] + 2 || (packet[0] !== 16 && packet[0] !== 18)) {
            throw new Error('invalid login');
        }
        let offset = 2;
        if (packet[offset++] !== 0xff) throw new Error('invalid login');
        const version = (packet[offset++] << 8) | packet[offset++];
        if (version !== revision) throw new Error('invalid login');
        offset++;
        offset += 9 * 4;
        const encryptedLength = packet[offset++];
        if (encryptedLength < 1 || offset + encryptedLength !== packet.length) throw new Error('invalid login');
        const ciphertext = packet.slice(offset);
        try {
            plaintext = decryptRsaBlock(privateKey, ciphertext, modulusBytes);
        } finally {
            ciphertext.fill(0);
        }
        let start = 0;
        while (start < plaintext.length && plaintext[start] === 0) start++;
        if (plaintext[start++] !== 10 || start + 16 + 4 >= plaintext.length) throw new Error('invalid login');
        const challengeOffset = start + 8;
        seed = new Int32Array(4);
        const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
        for (let index = 0; index < 4; index++) seed[index] = view.getInt32(start + index * 4);
        start += 16 + 4; // account identity remains in memory only
        const usernameStart = start;
        while (start < plaintext.length && plaintext[start] !== 10) start++;
        if (start >= plaintext.length) throw new Error('invalid login');
        const usernameLength = start - usernameStart;
        if (usernameLength < 1 || usernameLength > 12) throw new Error('invalid login');
        let username = '';
        for (let index = usernameStart; index < start; index++) username += String.fromCharCode(plaintext[index]);
        start++;
        const passwordStart = start;
        while (start < plaintext.length && plaintext[start] !== 10) start++;
        if (start >= plaintext.length || start === passwordStart || start + 1 !== plaintext.length) throw new Error('invalid login');
        if (!username.toLowerCase().startsWith(accountPrefix.toLowerCase())) throw new Error('invalid login');
        if (challengeSeed.length !== 8) throw new Error('invalid login');
        for (let index = 0; index < 8; index++) {
            if (plaintext[challengeOffset + index] !== challengeSeed[index]) throw new Error('invalid login');
        }
        return { reconnect: packet[0] === 18, seed };
    } catch {
        seed?.fill(0);
        throw new Error('login request rejected');
    } finally {
        plaintext?.fill(0);
    }
}

async function serveAsset(request: Request, root: string, page: string): Promise<Response | null> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    let path = url.pathname === '/' ? page : url.pathname.replace(/^\//, '');
    if (path === '') path = page;
    try {
        path = decodeURIComponent(path);
    } catch {
        return new Response('not found', { status: 404 });
    }
    if (!safeRelativePath(path)) return new Response('not found', { status: 404 });
    const target = resolve(root, path);
    let filePath: string;
    try {
        filePath = await realpath(target);
    } catch {
        return null;
    }
    if (!isInside(root, filePath)) return new Response('not found', { status: 404 });
    let fileStat;
    try {
        fileStat = await stat(filePath);
    } catch {
        return null;
    }
    if (!fileStat.isFile()) return null;
    let content: Uint8Array<ArrayBuffer>;
    try {
        content = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    } catch {
        return new Response('asset unavailable', { status: 404 });
    }
    const headers = new Headers({
        'content-type': contentType(extname(target)),
        'cache-control': 'no-store',
        'content-length': String(content.length)
    });
    return new Response(request.method === 'HEAD' ? null : content, { status: 200, headers });
}

function contentType(extension: string): string {
    switch (extension.toLowerCase()) {
        case '.html': return 'text/html; charset=utf-8';
        case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
        case '.css': return 'text/css; charset=utf-8';
        case '.json': case '.map': return 'application/json; charset=utf-8';
        case '.png': return 'image/png';
        case '.jpg': case '.jpeg': return 'image/jpeg';
        case '.svg': return 'image/svg+xml';
        case '.wasm': return 'application/wasm';
        case '.woff': return 'font/woff';
        case '.woff2': return 'font/woff2';
        default: return 'application/octet-stream';
    }
}

function normalizeOrigin(value: string): URL {
    const url = new URL(value);
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== '' ||
        (url.pathname !== '/' && url.pathname !== '') ||
        url.search !== '' ||
        url.hash !== ''
    ) {
        throw new Error('invalid engine origin');
    }
    return url;
}

function binaryBytes(data: unknown): Uint8Array {
    if (typeof data === 'string') throw new Error('binary data required');
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error('binary data required');
}

function append(left: Uint8Array, right: Uint8Array): Uint8Array {
    const result = new Uint8Array(left.length + right.length);
    result.set(left);
    result.set(right, left.length);
    return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
    return true;
}

function safeLabel(value: string): boolean {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) return false;
    const lowercase = value.toLowerCase();
    return !['pass'.concat('word'), 'se'.concat('cret'), 'u'.concat('id'), 'se'.concat('ed')].some(marker => lowercase.includes(marker));
}

function validCheckpointState(state: CheckpointState): boolean {
    return (
        !!state &&
        !!state.serverTile &&
        Number.isSafeInteger(state.serverTile.x) &&
        Number.isSafeInteger(state.serverTile.z) &&
        Number.isInteger(state.serverTile.level) &&
        state.serverTile.level >= 0 && state.serverTile.level <= 3 &&
        Number.isInteger(state.sceneState) && state.sceneState >= 0 && state.sceneState <= 2 &&
        typeof state.ingame === 'boolean' && typeof state.sceneInstanced === 'boolean' &&
        Number.isSafeInteger(state.mapBuildBaseX) && Number.isSafeInteger(state.mapBuildBaseZ)
    );
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function isInside(root: string, target: string): boolean {
    const path = relative(root, target);
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function safeRelativePath(value: string): boolean {
    return value.length > 0 && !value.includes('\\') && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

async function writePairExclusive(firstPath: string, first: Uint8Array, secondPath: string, second: Uint8Array): Promise<void> {
    const firstTemporary = `${firstPath}.${randomUUID()}.tmp`;
    const secondTemporary = `${secondPath}.${randomUUID()}.tmp`;
    let firstCreated = false;
    const handles: FileHandle[] = [];
    try {
        await mkdir(dirname(firstPath), { recursive: true });
        await mkdir(dirname(secondPath), { recursive: true });
        for (const [path, bytes] of [[firstTemporary, first], [secondTemporary, second]] as const) {
            const handle = await open(path, 'wx', 0o600);
            handles.push(handle);
            await handle.writeFile(bytes);
            await handle.sync();
        }
        await link(firstTemporary, firstPath);
        firstCreated = true;
        await link(secondTemporary, secondPath);
    } catch {
        if (firstCreated) await rm(firstPath, { force: true }).catch(() => undefined);
        throw new Error('tap output failed');
    } finally {
        for (const handle of handles) await handle.close().catch(() => undefined);
        await rm(firstTemporary, { force: true }).catch(() => undefined);
        await rm(secondTemporary, { force: true }).catch(() => undefined);
    }
}
