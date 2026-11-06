import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

export interface ReplayFixture {
    readonly recordingFile: string;
    readonly records: RecordingRecord[];
    readonly cacheBundle: CacheBundle;
    readonly protocol: Protocol;
    readonly indexEntry: RecordingIndex['recordings'][number];
    readonly recordingSha256: string;
    readonly cacheSha256: string;
}

export interface LoadReplayFixtureOptions {
    /** Index-relative JSONL path; defaults to the first entry for the built client revision. */
    recordingFile?: string;
    /** Caller-selected CacheBundle JSON; normally RS2B0T_CACHE_BUNDLE. */
    cacheBundlePath?: string;
    /** Tests that already resolved descriptors can avoid loading the local engine. */
    protocol?: Protocol;
}

/** Loads one current-revision recording and authenticates both files against the committed index. */
export function loadReplayFixture(options: LoadReplayFixtureOptions = {}): ReplayFixture {
    if (!existsSync(INDEX_PATH)) {
        throw new Error('test/io/recordings/index.json is missing');
    }

    const index = parseIndex(readFileSync(INDEX_PATH, 'utf8'));
    const indexEntry = options.recordingFile
        ? index.recordings.find(entry => entry.file === options.recordingFile)
        : index.recordings.find(entry => entry.revision === CLIENT_VERSION);
    if (!indexEntry) {
        throw new Error('replay index has no recording for this client');
    }
    if (indexEntry.revision !== CLIENT_VERSION) {
        throw new Error('selected replay recording does not match the built client revision');
    }

    const recordingPath = resolveRecordingPath(indexEntry.file);
    const recordingBytes = readFileSync(recordingPath);
    const recordingSha256 = digest(recordingBytes);
    if (recordingSha256 !== indexEntry.sha256) {
        throw new Error('replay recording hash differs from its index');
    }

    const cachePath = options.cacheBundlePath ?? process.env.RS2B0T_CACHE_BUNDLE;
    if (!cachePath) {
        throw new Error('RS2B0T_CACHE_BUNDLE must identify the replay cache JSON');
    }
    const cacheBytes = readFileSync(resolve(cachePath));
    const cacheSha256 = digest(cacheBytes);
    if (cacheSha256 !== indexEntry.cacheSha256) {
        throw new Error('replay cache hash differs from the recording index');
    }

    const records = parseRecording(recordingBytes.toString('utf8'));
    const cacheBundle = parseCacheBundle(cacheBytes.toString('utf8'));
    const protocol = options.protocol ?? protocolFor(CLIENT_VERSION);
    const check = checkRecording(records, protocol, cacheBundle, {
        recordingSha256,
        cacheSha256,
        indexEntry
    });
    if (!check.valid) {
        throw new Error(`recording validation failed: ${check.errors.join(', ')}`);
    }

    return {
        recordingFile: indexEntry.file,
        records,
        cacheBundle,
        protocol,
        indexEntry,
        recordingSha256,
        cacheSha256
    };
}
