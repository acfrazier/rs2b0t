import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { CLIENT_VERSION } from '#/client/io/ClientProt.js';

import { checkRecording, parseCacheBundle, parseRecording } from '../../../tools/tap-377/check-recording.js';
import { load377Protocol, loadEngineProtocol } from '../../../tools/tap-377/protocol.js';
import type { CacheBundle, Protocol, RecordingIndex, RecordingRecord } from '../../../tools/tap-377/format.js';

const RECORDINGS_DIR = resolve('test/io/recordings');
const INDEX_PATH = resolve(RECORDINGS_DIR, 'index.json');
const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIndex(text: string): RecordingIndex {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.format !== 1 || !Array.isArray(value.recordings)) {
        throw new Error('invalid replay recording index');
    }

    const recordings: RecordingIndex['recordings'] = [];
    for (const item of value.recordings) {
        if (
            !isRecord(item) ||
            typeof item.file !== 'string' ||
            !item.file ||
            typeof item.sha256 !== 'string' ||
            !SHA256.test(item.sha256) ||
            typeof item.cacheSha256 !== 'string' ||
            !SHA256.test(item.cacheSha256) ||
            typeof item.revision !== 'number' ||
            !Number.isSafeInteger(item.revision) ||
            item.revision <= 0
        ) {
            throw new Error('invalid replay recording index entry');
        }
        if (recordings.some(entry => entry.file === item.file)) {
            throw new Error('duplicate replay recording index entry');
        }

        recordings.push({
            file: item.file,
            sha256: item.sha256,
            cacheSha256: item.cacheSha256,
            revision: item.revision
        });
    }

    return { format: 1, recordings };
}

function digest(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function resolveRecordingPath(file: string): string {
    if (isAbsolute(file) || file.includes('\\') || file.split('/').some(part => part === '..' || part === '')) {
        throw new Error('replay index contains an unsafe recording path');
    }

    const path = resolve(RECORDINGS_DIR, file);
    const rel = relative(RECORDINGS_DIR, path);
    if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
        throw new Error('replay index contains an unsafe recording path');
    }
    return path;
}

function protocolFor(revision: number): Protocol {
    if (revision === 377) {
        return load377Protocol();
    }

    const engineDir = (process.env.ENGINE_DIR ?? '').trim();
    if (!engineDir) {
        throw new Error('ENGINE_DIR is required to resolve replay descriptors for this client revision');
    }

    const protocol = loadEngineProtocol(engineDir);
    if (protocol.revision !== revision) {
        throw new Error('replay engine revision does not match the client');
    }
    return protocol;
}

export interface ReplayRecording {
    readonly recordingFile: string;
    readonly records: RecordingRecord[];
    readonly protocol: Protocol;
    readonly indexEntry: RecordingIndex['recordings'][number];
    readonly recordingSha256: string;
}

export interface ReplayFixture extends ReplayRecording {
    readonly cacheBundle: CacheBundle;
    readonly cacheSha256: string;
}

function readReplayFile(path: string, label: string): Buffer {
    try {
        return readFileSync(path);
    } catch {
        throw new Error(`replay ${label} is not readable`);
    }
}

/** Authenticates every recording for a revision, without requiring any private cache bytes. */
export function loadReplayRecordings(revision = CLIENT_VERSION, protocol = protocolFor(revision)): ReplayRecording[] {
    const index = parseIndex(readReplayFile(INDEX_PATH, 'recording index').toString('utf8'));
    const entries = index.recordings.filter(entry => entry.revision === revision);
    if (entries.length === 0) throw new Error('replay index has no recordings for this revision');
    return entries.map(indexEntry => {
        const recordingBytes = readReplayFile(resolveRecordingPath(indexEntry.file), 'recording');
        const recordingSha256 = digest(recordingBytes);
        const records = parseRecording(recordingBytes.toString('utf8'));
        const check = checkRecording(records, protocol, undefined, { recordingSha256, indexEntry });
        if (!check.valid) throw new Error(`recording validation failed: ${check.errors.join(', ')}`);
        return { recordingFile: indexEntry.file, records, protocol, indexEntry, recordingSha256 };
    });
}

/** Resolves each recording's own pinned cache; a directory contains <cacheSha256>.json files. */
export function loadReplayCaches(recordings: readonly ReplayRecording[], cacheBundlePath: string): ReplayFixture[] {
    let directory: boolean;
    try {
        directory = statSync(cacheBundlePath).isDirectory();
    } catch {
        throw new Error('replay cache location is not readable');
    }
    const caches = new Map<string, CacheBundle>();
    return recordings.map(recording => {
        const cacheSha256 = recording.indexEntry.cacheSha256;
        let cacheBundle = caches.get(cacheSha256);
        if (!cacheBundle) {
            const path = directory ? resolve(cacheBundlePath, `${cacheSha256}.json`) : resolve(cacheBundlePath);
            const bytes = readReplayFile(path, 'cache bundle');
            if (digest(bytes) !== cacheSha256) throw new Error('replay cache hash differs from the recording index');
            cacheBundle = parseCacheBundle(bytes.toString('utf8'));
            caches.set(cacheSha256, cacheBundle);
        }
        const check = checkRecording(recording.records, recording.protocol, cacheBundle, {
            recordingSha256: recording.recordingSha256, cacheSha256, indexEntry: recording.indexEntry
        });
        if (!check.valid) throw new Error(`recording validation failed: ${check.errors.join(', ')}`);
        return { ...recording, cacheBundle, cacheSha256 };
    });
}

/** Loads ALL recordings for the built client, never silently selecting just the first. */
export function loadReplayFixtures(options: { cacheBundlePath?: string; protocol?: Protocol } = {}): ReplayFixture[] {
    const cachePath = options.cacheBundlePath ?? process.env.RS2B0T_CACHE_BUNDLE;
    if (!cachePath) throw new Error('RS2B0T_CACHE_BUNDLE must identify a cache JSON or hash-keyed directory');
    return loadReplayCaches(loadReplayRecordings(CLIENT_VERSION, options.protocol), cachePath);
}
