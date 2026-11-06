import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import { ARCHIVES, type CacheBundle, type Direction, type Protocol, type RecordingIndex, type RecordingRecord } from './format.js';
import { load377Protocol, loadEngineProtocol, validateProtocolForRevision } from './protocol.js';

export interface CheckOptions {
    recordingSha256?: string;
    cacheSha256?: string;
    indexEntry?: RecordingIndex['recordings'][number];
    requiredOpcodes?: { inbound?: readonly string[]; outbound?: readonly string[] };
}

export interface CheckRecordingResult {
    valid: boolean;
    errors: string[];
    frameCount: number;
    segmentCount: number;
    seenOpcodes: { inbound: string[]; outbound: string[] };
}

const RECORD_KEYS: Record<RecordingRecord['type'], readonly string[]> = {
    header: ['type', 'tapVersion', 'revision', 'engineCommit', 'contentCommit', 'clientCommit', 'accountPrefix', 'archiveHashes', 'tickBasis'],
    login: ['type', 'segment', 'replies', 'staffmodlevel', 'mouseTracked', 'reconnect'],
    frame: ['type', 'segment', 'direction', 'tick', 'ordinal', 'bytes'],
    checkpoint: ['type', 'segment', 'label', 'inboundCount', 'state'],
    end: ['type', 'segment', 'reason', 'inboundCount', 'outboundCount']
};
const HASH40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ACCOUNT_PREFIX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ONDEMAND_KEY = /^([0-3])\/(0|[1-9][0-9]{0,4})$/;
const sensitiveWords = [
    ['pass', 'word'].join(''),
    ['se', 'cret'].join(''),
    ['pri', 'vate'].join(''),
    ['uid'].join(''),
    ['seed'].join(''),
    ['rsa'].join('')
];

export function parseRecording(text: string): RecordingRecord[] {
    if (typeof text !== 'string' || text.length === 0) throw new Error('invalid recording text');
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    if (lines.length === 0 || lines.some(line => line.length === 0)) throw new Error('invalid recording lines');
    const records: RecordingRecord[] = [];
    for (const line of lines) {
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch {
            throw new Error('invalid recording JSON');
        }
        if (!isObject(value) || typeof value.type !== 'string' || !(value.type in RECORD_KEYS)) {
            throw new Error('invalid recording record');
        }
        assertExactKeys(value, RECORD_KEYS[value.type as RecordingRecord['type']]);
        records.push(value as unknown as RecordingRecord);
    }
    return records;
}

export function parseCacheBundle(text: string): CacheBundle {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error('invalid cache JSON');
    }
    if (!isObject(value)) throw new Error('invalid cache bundle');
    assertExactKeys(value, ['format', 'archives', 'ondemand']);
    return value as unknown as CacheBundle;
}

export function checkRecording(
    records: readonly RecordingRecord[],
    protocol: Protocol,
    cacheBundle: CacheBundle,
    expected: CheckOptions = {}
): CheckRecordingResult {
    const errors = new Set<string>();
    const seen = { inbound: new Set<string>(), outbound: new Set<string>() };
    let frameCount = 0;
    let segmentCount = 0;
    const safeProtocol = (() => {
        try {
            return validateProtocolForRevision(protocol);
        } catch {
            errors.add('protocol-invalid');
            return null;
        }
    })();

    if (records.length === 0) errors.add('recording-empty');
    let header: RecordingRecord & { type: 'header' } | null = null;
    const firstRecord = records[0];
    if (firstRecord?.type === 'header') {
        header = firstRecord;
        validateHeader(firstRecord, safeProtocol, errors);
    } else {
        errors.add('header-not-first');
    }
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (!isObject(record) || typeof record.type !== 'string' || !(record.type in RECORD_KEYS)) {
            errors.add('record-invalid');
            continue;
        }
        try {
            assertExactKeys(record, RECORD_KEYS[record.type as RecordingRecord['type']]);
        } catch {
            errors.add('record-fields');
        }
        if (record.type === 'header') {
            if (index !== 0) errors.add('header-position');
            if (index !== 0) validateHeader(record as RecordingRecord & { type: 'header' }, safeProtocol, errors);
        }
    }

    validateCache(cacheBundle, header, expected, errors);
    validateIdentity(expected, header, errors);

    const clientById = new Map(safeProtocol?.client.map(entry => [entry.id, entry]) ?? []);
    const serverById = new Map(safeProtocol?.server.map(entry => [entry.id, entry]) ?? []);
    let current: {
        segment: number;
        inCount: number;
        outCount: number;
        nextInOrdinal: number;
        nextOutOrdinal: number;
        tick: number;
        lastCheckpointInboundCount: number;
        logoutSeen: boolean;
    } | null = null;
    let lastSegment = 0;
    let requiresReconnect = false;

    for (let index = 1; index < records.length; index++) {
        const record = records[index];
        if (!record || !isObject(record) || typeof record.type !== 'string') continue;
        if (record.type === 'header') continue;
        if (record.type === 'login') {
            segmentCount++;
            if (current) errors.add('segment-missing-end');
            if (!Number.isInteger(record.segment) || record.segment !== lastSegment + 1) errors.add('segment-number');
            if (requiresReconnect && record.reconnect !== true) errors.add('reconnect-missing-login');
            requiresReconnect = false;
            lastSegment = Number.isInteger(record.segment) ? record.segment : lastSegment;
            validateLogin(record, errors);
            current = {
                segment: record.segment,
                inCount: 0,
                outCount: 0,
                nextInOrdinal: 1,
                nextOutOrdinal: 1,
                tick: 0,
                lastCheckpointInboundCount: 0,
                logoutSeen: false
            };
            continue;
        }
        if (!current) {
            errors.add(record.type === 'frame' ? 'frame-before-login' : 'record-outside-segment');
            continue;
        }
        if (!Number.isInteger(record.segment) || record.segment !== current.segment) {
            errors.add('segment-mismatch');
            continue;
        }
        if (record.type === 'frame') {
            frameCount++;
            const direction: Direction | null = record.direction === 'in' || record.direction === 'out' ? record.direction : null;
            if (!direction) {
                errors.add('frame-direction');
                continue;
            }
            const nextOrdinal = direction === 'in' ? current.nextInOrdinal : current.nextOutOrdinal;
            if (!Number.isSafeInteger(record.ordinal) || record.ordinal !== nextOrdinal) errors.add('frame-ordinal');
            if (direction === 'in') current.nextInOrdinal++;
            else current.nextOutOrdinal++;

            const inventory = direction === 'in' ? serverById : clientById;
            const frame = decodeFrame(record.bytes, errors);
            if (!frame) continue;
            const descriptor = inventory.get(frame[0]);
            if (!descriptor) {
                errors.add('frame-unknown-opcode');
                continue;
            }
            const size = frameLength(frame, descriptor.length);
            if (size === null || size !== frame.length) errors.add('frame-length');
            if (direction === 'in') {
                if (descriptor.name === 'PLAYER_INFO') current.tick++;
                if (descriptor.name === 'LOGOUT') current.logoutSeen = true;
                current.inCount++;
                seen.inbound.add(descriptor.name);
            } else {
                current.outCount++;
                seen.outbound.add(descriptor.name);
            }
            if (!Number.isSafeInteger(record.tick) || record.tick !== current.tick) errors.add('frame-tick');
            continue;
        }
        if (record.type === 'checkpoint') {
            validateCheckpoint(record, current, errors);
            if (
                Number.isSafeInteger(record.inboundCount) &&
                record.inboundCount >= current.lastCheckpointInboundCount &&
                record.inboundCount <= current.inCount
            ) {
                current.lastCheckpointInboundCount = record.inboundCount;
            }
            continue;
        }
        if (record.type === 'end') {
            if (!Number.isSafeInteger(record.inboundCount) || record.inboundCount !== current.inCount) errors.add('end-inbound-count');
            if (!Number.isSafeInteger(record.outboundCount) || record.outboundCount !== current.outCount) errors.add('end-outbound-count');
            if (record.reason === 'logout') {
                if (!current.logoutSeen) errors.add('logout-not-observed');
                requiresReconnect = false;
            } else if (record.reason === 'reconnect') {
                if (current.logoutSeen) errors.add('reconnect-after-logout');
                requiresReconnect = true;
            } else {
                errors.add('end-reason');
            }
            current = null;
        } else {
            errors.add('record-type');
        }
    }
    if (current) errors.add('segment-missing-end');
    if (requiresReconnect) errors.add('reconnect-missing-login');

    for (const direction of ['inbound', 'outbound'] as const) {
        for (const name of expected.requiredOpcodes?.[direction] ?? []) {
            if (!/^[A-Z0-9_]+$/.test(name) || !seen[direction].has(name)) errors.add(`required-${direction}-opcode`);
        }
    }

    return {
        valid: errors.size === 0,
        errors: [...errors],
        frameCount,
        segmentCount,
        seenOpcodes: { inbound: [...seen.inbound], outbound: [...seen.outbound] }
    };
}

export function protocolForCheck(engineDir?: string): Protocol {
    return engineDir ? loadEngineProtocol(engineDir) : load377Protocol();
}

function validateHeader(
    header: RecordingRecord & { type: 'header' },
    protocol: Protocol | null,
    errors: Set<string>
): void {
    if (header.tapVersion !== 1 || header.tickBasis !== 'player-info') errors.add('header-version');
    if (!Number.isSafeInteger(header.revision) || (protocol && header.revision !== protocol.revision)) errors.add('header-revision');
    if (!HASH40.test(header.engineCommit) || !HASH40.test(header.contentCommit) || !HASH40.test(header.clientCommit)) {
        errors.add('header-commit');
    }
    if (!ACCOUNT_PREFIX.test(header.accountPrefix) || containsSensitiveMarker(header.accountPrefix)) errors.add('header-account-prefix');
    if (!isObject(header.archiveHashes)) {
        errors.add('header-archive-hashes');
        return;
    }
    try {
        assertExactKeys(header.archiveHashes, ARCHIVES);
    } catch {
        errors.add('header-archive-membership');
        return;
    }
    for (const archive of ARCHIVES) {
        if (typeof header.archiveHashes[archive] !== 'string' || !SHA256.test(header.archiveHashes[archive])) {
            errors.add('header-archive-hash');
        }
    }
}

function validateLogin(record: RecordingRecord & { type: 'login' }, errors: Set<string>): void {
    if (!Number.isSafeInteger(record.segment) || record.segment < 1) errors.add('login-segment');
    if (
        !Array.isArray(record.replies) ||
        record.replies.length < 2 ||
        record.replies[0] !== 0 ||
        record.replies[record.replies.length - 1] !== 2 ||
        record.replies.some(reply => !Number.isInteger(reply) || reply < 0 || reply > 255)
    ) {
        errors.add('login-replies');
    }
    if (!Number.isInteger(record.staffmodlevel) || record.staffmodlevel < 0 || record.staffmodlevel > 255) errors.add('login-staff-level');
    if (typeof record.mouseTracked !== 'boolean' || typeof record.reconnect !== 'boolean') errors.add('login-flags');
}

function validateCheckpoint(
    record: RecordingRecord & { type: 'checkpoint' },
    current: { inCount: number; lastCheckpointInboundCount: number },
    errors: Set<string>
): void {
    if (!LABEL.test(record.label) || containsSensitiveMarker(record.label)) errors.add('checkpoint-label');
    if (!Number.isSafeInteger(record.inboundCount) || record.inboundCount < 0 || record.inboundCount > current.inCount) {
        errors.add('checkpoint-inbound-count');
    } else if (record.inboundCount < current.lastCheckpointInboundCount) {
        errors.add('checkpoint-count-order');
    }
    const state = record.state;
    if (!isObject(state)) {
        errors.add('checkpoint-state');
        return;
    }
    try {
        assertExactKeys(state, ['serverTile', 'sceneState', 'ingame', 'sceneInstanced', 'mapBuildBaseX', 'mapBuildBaseZ']);
    } catch {
        errors.add('checkpoint-state-fields');
        return;
    }
    const tile = state.serverTile;
    if (!isObject(tile)) {
        errors.add('checkpoint-tile');
    } else {
        try {
            assertExactKeys(tile, ['x', 'z', 'level']);
        } catch {
            errors.add('checkpoint-tile-fields');
        }
        if (!Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.z) || !Number.isInteger(tile.level) || tile.level < 0 || tile.level > 3) {
            errors.add('checkpoint-tile-values');
        }
    }
    if (!Number.isInteger(state.sceneState) || state.sceneState < 0 || state.sceneState > 2) errors.add('checkpoint-scene-state');
    if (typeof state.ingame !== 'boolean' || typeof state.sceneInstanced !== 'boolean') errors.add('checkpoint-state-flags');
    if (!Number.isSafeInteger(state.mapBuildBaseX) || !Number.isSafeInteger(state.mapBuildBaseZ)) errors.add('checkpoint-map-base');
}

function validateCache(
    bundle: CacheBundle,
    header: (RecordingRecord & { type: 'header' }) | null,
    expected: CheckOptions,
    errors: Set<string>
): void {
    if (!isObject(bundle)) {
        errors.add('cache-invalid');
        return;
    }
    try {
        assertExactKeys(bundle, ['format', 'archives', 'ondemand']);
        if (bundle.format !== 1) throw new Error();
        assertExactKeys(bundle.archives, ARCHIVES);
        if (!isObject(bundle.ondemand)) throw new Error();
    } catch {
        errors.add('cache-membership');
        return;
    }
    for (const archive of ARCHIVES) {
        const encoded = bundle.archives[archive];
        const bytes = decodeBase64(encoded, errors, 'cache-archive-base64');
        if (!bytes || bytes.length === 0) continue;
        if (header && isObject(header.archiveHashes) && header.archiveHashes[archive] !== digest(bytes)) {
            errors.add('cache-archive-hash');
        }
    }
    for (const [key, encoded] of Object.entries(bundle.ondemand)) {
        const match = ONDEMAND_KEY.exec(key);
        if (!match || Number(match[2]) > 65535) {
            errors.add('cache-ondemand-key');
            continue;
        }
        const bytes = decodeBase64(encoded, errors, 'cache-ondemand-base64');
        if (bytes && bytes.length < 2) errors.add('cache-ondemand-size');
    }
    if (expected.cacheSha256 !== undefined && !SHA256.test(expected.cacheSha256)) errors.add('cache-sha-format');
}

function validateIdentity(
    expected: CheckOptions,
    header: (RecordingRecord & { type: 'header' }) | null,
    errors: Set<string>
): void {
    const entry = expected.indexEntry;
    if (entry) {
        try {
            assertExactKeys(entry, ['file', 'sha256', 'cacheSha256', 'revision']);
        } catch {
            errors.add('index-fields');
            return;
        }
        if (
            typeof entry.file !== 'string' ||
            !/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/)*[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.jsonl$/.test(entry.file) ||
            entry.file.includes('..') ||
            !SHA256.test(entry.sha256) ||
            !SHA256.test(entry.cacheSha256) ||
            !Number.isSafeInteger(entry.revision)
        ) {
            errors.add('index-values');
        }
        if (expected.recordingSha256 !== undefined && entry.sha256 !== expected.recordingSha256) errors.add('index-recording-hash');
        if (expected.cacheSha256 !== undefined && entry.cacheSha256 !== expected.cacheSha256) errors.add('index-cache-hash');
        if (header && entry.revision !== header.revision) errors.add('index-revision');
    }
    if (expected.recordingSha256 !== undefined && !SHA256.test(expected.recordingSha256)) errors.add('recording-sha-format');
}

function decodeFrame(value: unknown, errors: Set<string>): Uint8Array | null {
    if (typeof value !== 'string' || value.length < 2 || (value.length & 1) !== 0 || !/^(?:[0-9a-f]{2})+$/.test(value)) {
        errors.add('frame-bytes');
        return null;
    }
    return Buffer.from(value, 'hex');
}

function frameLength(bytes: Uint8Array, declared: number): number | null {
    if (declared >= 0) return 1 + declared;
    if (declared === -1) return bytes.length >= 2 ? 2 + bytes[1] : null;
    if (declared === -2) return bytes.length >= 3 ? 3 + ((bytes[1] << 8) | bytes[2]) : null;
    return null;
}

function decodeBase64(value: unknown, errors: Set<string>, error: string): Uint8Array | null {
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        errors.add(error);
        return null;
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value) {
        errors.add(error);
        return null;
    }
    return bytes;
}

function digest(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function containsSensitiveMarker(value: string): boolean {
    const normalized = value.toLowerCase();
    return sensitiveWords.some(word => normalized.includes(word));
}

function assertExactKeys(value: object, keys: readonly string[]): void {
    const actual = Object.keys(value);
    if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('schema mismatch');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArgs(args: string[]): Map<string, string> {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index++) {
        const key = args[index];
        if (!key?.startsWith('--') || values.has(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
            throw new Error('invalid arguments');
        }
        values.set(key, args[++index]);
    }
    return values;
}

function runCli(): void {
    try {
        const args = readArgs(process.argv.slice(2));
        const recordingPath = args.get('--recording');
        const cachePath = args.get('--cache');
        const engineDir = args.get('--engine');
        if (!recordingPath || !cachePath || (!engineDir && args.get('--protocol'))) throw new Error('required arguments missing');
        const recordingBytes = readFileSync(resolve(recordingPath));
        const cacheBytes = readFileSync(resolve(cachePath));
        const records = parseRecording(recordingBytes.toString('utf8'));
        const cacheBundle = parseCacheBundle(cacheBytes.toString('utf8'));
        const protocol = engineDir ? loadEngineProtocol(engineDir) : load377Protocol();
        if (args.get('--protocol')) throw new Error('use an explicit engine directory for protocol selection');
        const recordingSha256 = digest(recordingBytes);
        const cacheSha256 = digest(cacheBytes);
        let indexEntry: RecordingIndex['recordings'][number] | undefined;
        const indexPath = args.get('--index');
        if (indexPath) {
            const indexFile = resolve(indexPath);
            const index = JSON.parse(readFileSync(indexFile, 'utf8')) as RecordingIndex;
            if (!isObject(index)) throw new Error('invalid index');
            assertExactKeys(index, ['format', 'recordings']);
            if (index.format !== 1 || !Array.isArray(index.recordings)) throw new Error('invalid index');
            const filename = relative(dirname(indexFile), resolve(recordingPath)).split(sep).join('/');
            indexEntry = index.recordings.find(entry => entry.file === filename);
            if (!indexEntry) throw new Error('recording not indexed');
        }
        const result = checkRecording(records, protocol, cacheBundle, {
            recordingSha256,
            cacheSha256,
            ...(indexEntry ? { indexEntry } : {})
        });
        if (!result.valid) throw new Error(result.errors.join(','));
        console.log(`check-recording: OK (${result.segmentCount} segments, ${result.frameCount} frames)`);
    } catch {
        console.error('check-recording: FAILED (invalid recording, cache, protocol, or index)');
        process.exitCode = 1;
    }
}

if (import.meta.main) runCli();
