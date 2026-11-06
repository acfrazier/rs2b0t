import { describe, expect, test } from 'bun:test';
import { constants, createHash, generateKeyPairSync, publicEncrypt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Isaac from '../../src/client/io/Isaac.js';
import { checkRecording, parseRecording } from '../../tools/tap-377/check-recording.js';
import { ARCHIVES, type ArchiveName, type Descriptor, type Protocol, type RecordingHeader, type RecordingRecord } from '../../tools/tap-377/format.js';
import { load377Protocol } from '../../tools/tap-377/protocol.js';
import { acceptsLoginRequest, archiveForRequest } from '../../tools/tap-377/tap.js';
import { GameFrameDecoder, OnDemandStream } from '../../tools/tap-377/wire.js';
import { decryptRsaBlock, readRsaPrivateKey, type RsaPrivateKey } from '../../tools/tap-377/rsa.js';

const protocol = load377Protocol();

test('archive capture recognizes signed CRC suffixes without changing the request path', () => {
    for (const archive of ARCHIVES) {
        const url = new URL(`http://capture.invalid/${archive}${archive === 'crc' ? '' : '-564448443'}`);
        expect(archiveForRequest(url)).toBe(archive);
    }
    expect(archiveForRequest(new URL('http://capture.invalid/title--1'))).toBeNull();
    expect(archiveForRequest(new URL('http://capture.invalid/config1/other'))).toBeNull();
});

describe('tap game wire decoder', () => {
    test('decrypts both directions and handles ISAAC and variable framing across arbitrary chunks', () => {
        const inboundSeed = new Int32Array([11, 22, 33, 44]);
        const outboundSeed = new Int32Array([55, 66, 77, 88]);
        const playerInfo = descriptor(protocol, 'server', 'PLAYER_INFO');
        const logout = descriptor(protocol, 'server', 'LOGOUT');
        const publicMessage = descriptor(protocol, 'client', 'MESSAGE_PUBLIC');
        const inboundIsaac = new Isaac(new Int32Array(inboundSeed));
        const inboundWire = concat(
            encodeGameFrame(inboundIsaac, playerInfo, Uint8Array.of(0xaa, 0x55)),
            encodeGameFrame(inboundIsaac, logout, new Uint8Array(Math.max(0, logout.length)))
        );
        const decodedInbound: { name: string; bytes: number[] }[] = [];
        const inboundDecoder = new GameFrameDecoder('in', protocol, new Isaac(new Int32Array(inboundSeed)), frame => {
            decodedInbound.push({ name: frame.descriptor.name, bytes: [...frame.bytes] });
        });
        for (const byte of inboundWire) inboundDecoder.push(Uint8Array.of(byte));
        inboundDecoder.finish();
        expect(decodedInbound).toEqual([
            { name: 'PLAYER_INFO', bytes: [...plainFrame(playerInfo, Uint8Array.of(0xaa, 0x55))] },
            { name: 'LOGOUT', bytes: [...plainFrame(logout, new Uint8Array(Math.max(0, logout.length)))] }
        ]);

        const outboundIsaac = new Isaac(new Int32Array(outboundSeed));
        const outboundBody = Uint8Array.of(0x31, 0x42, 0x53);
        const outboundWire = encodeGameFrame(outboundIsaac, publicMessage, outboundBody);
        const decodedOutbound: { name: string; bytes: number[] }[] = [];
        const outboundDecoder = new GameFrameDecoder('out', protocol, new Isaac(new Int32Array(outboundSeed)), frame => {
            decodedOutbound.push({ name: frame.descriptor.name, bytes: [...frame.bytes] });
        });
        outboundDecoder.push(outboundWire.subarray(0, 1));
        outboundDecoder.push(outboundWire.subarray(1, 3));
        outboundDecoder.push(outboundWire.subarray(3));
        outboundDecoder.finish();
        expect(decodedOutbound).toEqual([{ name: 'MESSAGE_PUBLIC', bytes: [...plainFrame(publicMessage, outboundBody)] }]);
    });
});

describe('tap OnDemand stream', () => {
    test('reassembles out-of-order chunks when handshake, header, and payload are split', () => {
        const archive = 2;
        const file = 0x1234;
        const fileBytes = Uint8Array.from({ length: 701 }, (_, index) => (index * 37 + 9) & 0xff);
        fileBytes.set([0xa5, 0x5a], fileBytes.length - 2);
        const requests: [number, number][] = [];
        const completed: { archive: number; file: number; bytes: Uint8Array }[] = [];
        const stream = new OnDemandStream(
            (requestedArchive, requestedFile) => requests.push([requestedArchive, requestedFile]),
            (completedArchive, completedFile, bytes) => completed.push({ archive: completedArchive, file: completedFile, bytes })
        );
        const request = Uint8Array.of(15, archive, file >> 8, file & 0xff, 1);
        stream.pushClient(request.subarray(0, 2));
        stream.pushClient(request.subarray(2));

        const serverHelloAndPart = concat(
            new Uint8Array(8),
            onDemandChunk(archive, file, fileBytes.length, 1, fileBytes.subarray(500))
        );
        for (const byte of serverHelloAndPart) stream.pushServer(Uint8Array.of(byte));
        expect(stream.pendingCount).toBe(1);
        const firstPart = onDemandChunk(archive, file, fileBytes.length, 0, fileBytes.subarray(0, 500));
        for (const byte of firstPart) stream.pushServer(Uint8Array.of(byte));
        stream.finish();

        expect(requests).toEqual([[archive, file]]);
        expect(completed).toHaveLength(1);
        expect(completed[0]).toMatchObject({ archive, file });
        expect(completed[0]?.bytes).toEqual(fileBytes);
        expect(completed[0]?.bytes.slice(-2)).toEqual(Uint8Array.of(0xa5, 0x5a));
    });

    test('rejects a stream that closes before a requested chunk is complete', () => {
        const stream = new OnDemandStream(() => undefined, () => undefined);
        stream.pushClient(Uint8Array.of(15, 0, 0, 7, 0));
        stream.pushServer(concat(new Uint8Array(8), onDemandHeader(0, 7, 1, 0)));
        expect(() => stream.finish()).toThrow();
    });
});

describe('tap RSA login guard', () => {
    test('accepts a synthetic login for the account prefix and rejects mismatched identity or challenge', () => {
        const { privateKey, packet, challenge } = syntheticLogin('qaGuest');
        const wrongChallenge = new Uint8Array(challenge);
        wrongChallenge[0] ^= 0xff;
        try {
            expect(acceptsLoginRequest(packet, privateKey, 'qa', 377, challenge)).toBe(true);
            expect(acceptsLoginRequest(packet, privateKey, 'zz', 377, challenge)).toBe(false);
            expect(acceptsLoginRequest(packet, privateKey, 'qa', 377, wrongChallenge)).toBe(false);
        } finally {
            packet.fill(0);
            challenge.fill(0);
            wrongChallenge.fill(0);
        }
    });
    test('accepts the leading sign byte emitted by the client BigInteger encoder', () => {
        const { privateKey, packet, challenge } = syntheticLogin('qaGuest');
        const signed = new Uint8Array(packet.length + 1);
        signed.set(packet.subarray(0, 43));
        signed[1]++;
        signed[42]++;
        signed.set(packet.subarray(43), 44);
        expect(acceptsLoginRequest(signed, privateKey, 'qa', 377, challenge)).toBe(true);
        packet.fill(0); signed.fill(0); challenge.fill(0);
    });
    test('decodes a PKCS#1 key with a public exponent larger than a machine integer', () => {
        // Textbook RSA numbers are a synthetic arithmetic fixture, not engine key material.
        const fields = [0n, 3233n, 17n + 3120n * (1n << 64n), 2753n, 61n, 53n, 53n, 49n, 38n];
        const integers = fields.map(value => {
            let hex = value.toString(16);
            if (hex.length % 2) hex = '0' + hex;
            if (parseInt(hex.slice(0, 2), 16) & 0x80) hex = '00' + hex;
            const body = Buffer.from(hex, 'hex');
            return Buffer.concat([Buffer.from([2, body.length]), body]);
        });
        const body = Buffer.concat(integers);
        const der = Buffer.concat([Buffer.from([0x30, body.length]), body]);
        const fence = '-'.repeat(5);
        const pem = Buffer.from(`${fence}BEGIN RSA PRIVATE KEY${fence}\n${der.toString('base64')}\n${fence}END RSA PRIVATE KEY${fence}\n`);
        const key = readRsaPrivateKey(pem);
        expect([...decryptRsaBlock(key, Uint8Array.of(0x0a, 0xe6), 2)]).toEqual([65]);
        expect(() => readRsaPrivateKey(pem.subarray(0, pem.length - 8))).toThrow('invalid engine key');
        expect(() => decryptRsaBlock(key, Uint8Array.of(0xff, 0xff), 2)).toThrow('invalid login');
        pem.fill(0); der.fill(0);
    });
});

describe('tap recording checker', () => {
    test('accepts a complete reconnect recording and parses its JSONL form', () => {
        const { records, bundle } = sampleRecording();
        const result = checkRecording(records, protocol, bundle, {
            requiredOpcodes: { inbound: ['PLAYER_INFO', 'LOGOUT'], outbound: ['MESSAGE_PUBLIC'] }
        });
        expect(result.valid).toBe(true);
        expect(result.segmentCount).toBe(2);
        expect(result.frameCount).toBe(4);
        expect(parseRecording(records.map(record => JSON.stringify(record)).join('\n'))).toEqual(records);
    });

    test('CLI resolves a nested recording relative to its index and checks both hashes', () => {
        const { records, bundle } = sampleRecording();
        const root = mkdtempSync(join(tmpdir(), 'tap-check-'));
        try {
            mkdirSync(join(root, '377'));
            const recording = records.map(record => JSON.stringify(record)).join('\n') + '\n';
            const cache = JSON.stringify(bundle);
            const entry = {
                file: '377/sample.jsonl',
                revision: 377,
                sha256: createHash('sha256').update(recording).digest('hex'),
                cacheSha256: createHash('sha256').update(cache).digest('hex')
            };
            const recordingPath = join(root, entry.file);
            const cachePath = join(root, 'cache.json');
            const indexPath = join(root, 'index.json');
            writeFileSync(recordingPath, recording);
            writeFileSync(cachePath, cache);
            writeFileSync(indexPath, JSON.stringify({ format: 1, recordings: [entry] }));
            const command = [process.execPath, fileURLToPath(new URL('../../tools/tap-377/check-recording.ts', import.meta.url)),
                '--recording', recordingPath, '--cache', cachePath, '--index', indexPath];
            expect(Bun.spawnSync(command).exitCode).toBe(0);
            writeFileSync(indexPath, JSON.stringify({ format: 1, recordings: [{ ...entry, cacheSha256: '0'.repeat(64) }] }));
            expect(Bun.spawnSync(command).exitCode).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects corrupted variable-frame lengths', () => {
        const { records, bundle } = sampleRecording();
        const player = descriptor(protocol, 'server', 'PLAYER_INFO');
        const corrupted = records.map(record => {
            if (record.type === 'frame' && record.direction === 'in' && record.bytes.startsWith(player.id.toString(16).padStart(2, '0'))) {
                return { ...record, bytes: Buffer.from([player.id, 0, 2, 0xaa]).toString('hex') };
            }
            return record;
        });
        const result = checkRecording(corrupted, protocol, bundle);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('frame-length');
    });

    test('rejects sensitive header values and unexpected credential-shaped fields', () => {
        const { records, bundle } = sampleRecording();
        const header = records[0];
        if (!header || header.type !== 'header') throw new Error('sample header missing');
        const sensitivePrefix: RecordingHeader = { ...header, accountPrefix: ['se', 'cret'].join('') };
        expect(checkRecording([sensitivePrefix, ...records.slice(1)], protocol, bundle).errors).toContain('header-account-prefix');

        const extraField = ['pass', 'word'].join('');
        const unapprovedHeader = { ...header, [extraField]: 'never-record-this' };
        const text = [JSON.stringify(unapprovedHeader), ...records.slice(1).map(record => JSON.stringify(record))].join('\n');
        expect(() => parseRecording(text)).toThrow();
    });
});

function descriptor(value: Protocol, direction: 'client' | 'server', name: string): Descriptor {
    const entry = value[direction].find(item => item.name === name);
    if (!entry) throw new Error(`missing ${direction} descriptor ${name}`);
    return entry;
}

function encodeGameFrame(isaac: Isaac, entry: Descriptor, body: Uint8Array): Uint8Array {
    const plain = plainFrame(entry, body);
    const wire = new Uint8Array(plain);
    wire[0] = (entry.id + isaac.nextInt) & 0xff;
    return wire;
}

function plainFrame(entry: Descriptor, body: Uint8Array): Uint8Array {
    let prefixLength = 0;
    if (entry.length >= 0) {
        if (entry.length !== body.length) throw new Error('fixed frame body size mismatch');
    } else if (entry.length === -1) {
        if (body.length > 0xff) throw new Error('one-byte frame body too large');
        prefixLength = 1;
    } else if (entry.length === -2) {
        if (body.length > 0xffff) throw new Error('two-byte frame body too large');
        prefixLength = 2;
    } else {
        throw new Error('unknown frame size');
    }
    const bytes = new Uint8Array(1 + prefixLength + body.length);
    bytes[0] = entry.id;
    if (prefixLength === 1) bytes[1] = body.length;
    if (prefixLength === 2) {
        bytes[1] = body.length >>> 8;
        bytes[2] = body.length & 0xff;
    }
    bytes.set(body, 1 + prefixLength);
    return bytes;
}

function onDemandHeader(archive: number, file: number, size: number, part: number): Uint8Array {
    return Uint8Array.of(archive, file >> 8, file & 0xff, size >> 8, size & 0xff, part);
}

function onDemandChunk(archive: number, file: number, size: number, part: number, body: Uint8Array): Uint8Array {
    return concat(onDemandHeader(archive, file, size, part), body);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function syntheticLogin(username: string): { privateKey: RsaPrivateKey; packet: Uint8Array; challenge: Uint8Array } {
    const pair = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const modulusLength = pair.privateKey.asymmetricKeyDetails?.modulusLength;
    if (!modulusLength || modulusLength % 8 !== 0) throw new Error('synthetic key invalid');
    const modulusBytes = modulusLength / 8;
    const challenge = Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
    const seedWords = Buffer.alloc(16);
    seedWords.writeInt32BE(0x10203040, 0);
    seedWords.writeInt32BE(0x50607080, 4);
    seedWords.set(challenge, 8);
    const identity = Buffer.concat([
        Buffer.from([10]),
        seedWords,
        Buffer.from([0, 0, 5, 57]),
        Buffer.from(username, 'ascii'), Buffer.from([10]),
        Buffer.from('pw', 'ascii'), Buffer.from([10])
    ]);
    const plaintext = Buffer.alloc(modulusBytes);
    plaintext.set(identity, modulusBytes - identity.length);
    let encrypted: Buffer;
    try {
        encrypted = publicEncrypt({ key: pair.publicKey, padding: constants.RSA_NO_PADDING }, plaintext);
    } finally {
        plaintext.fill(0);
        identity.fill(0);
        seedWords.fill(0);
    }
    const packet = Buffer.alloc(43 + encrypted.length);
    packet[0] = 16;
    packet[1] = packet.length - 2;
    packet[2] = 0xff;
    packet[3] = 0x01;
    packet[4] = 0x79;
    packet[5] = 0;
    packet[42] = encrypted.length;
    encrypted.copy(packet, 43);
    encrypted.fill(0);
    const pem = Buffer.from(pair.privateKey.export({ format: 'pem', type: 'pkcs1' }));
    try { return { privateKey: readRsaPrivateKey(pem), packet, challenge }; }
    finally { pem.fill(0); }
}

function sampleRecording(): { records: RecordingRecord[]; bundle: { format: 1; archives: Record<ArchiveName, string>; ondemand: Record<string, string> } } {
    const archiveHashes = {} as Record<ArchiveName, string>;
    const archives = {} as Record<ArchiveName, string>;
    ARCHIVES.forEach((archive, index) => {
        const bytes = Uint8Array.of(index + 1, 0xa5);
        archives[archive] = Buffer.from(bytes).toString('base64');
        archiveHashes[archive] = createHash('sha256').update(bytes).digest('hex');
    });
    const bundle = { format: 1 as const, archives, ondemand: { '2/7': Buffer.from([0xab, 0xcd]).toString('base64') } };
    const header: RecordingHeader = {
        type: 'header', tapVersion: 1, revision: protocol.revision,
        engineCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40), clientCommit: 'c'.repeat(40),
        accountPrefix: 'qa', archiveHashes, tickBasis: 'player-info'
    };
    const playerInfo = descriptor(protocol, 'server', 'PLAYER_INFO');
    const logout = descriptor(protocol, 'server', 'LOGOUT');
    const message = descriptor(protocol, 'client', 'MESSAGE_PUBLIC');
    const records: RecordingRecord[] = [
        header,
        { type: 'login', segment: 1, replies: [0, 2], staffmodlevel: 0, mouseTracked: false, reconnect: false },
        { type: 'frame', segment: 1, direction: 'in', tick: 1, ordinal: 1, bytes: Buffer.from(plainFrame(playerInfo, Uint8Array.of(0x12))).toString('hex') },
        { type: 'frame', segment: 1, direction: 'out', tick: 1, ordinal: 1, bytes: Buffer.from(plainFrame(message, Uint8Array.of(1, 2, 3))).toString('hex') },
        {
            type: 'checkpoint', segment: 1, label: 'sceneReady', inboundCount: 1,
            state: { serverTile: { x: 3200, z: 3200, level: 0 }, sceneState: 2, ingame: true, sceneInstanced: false, mapBuildBaseX: 0, mapBuildBaseZ: 0 }
        },
        { type: 'end', segment: 1, reason: 'reconnect', inboundCount: 1, outboundCount: 1 },
        { type: 'login', segment: 2, replies: [0, 2], staffmodlevel: 0, mouseTracked: false, reconnect: true },
        { type: 'frame', segment: 2, direction: 'in', tick: 1, ordinal: 1, bytes: Buffer.from(plainFrame(playerInfo, Uint8Array.of(0x34))).toString('hex') },
        { type: 'frame', segment: 2, direction: 'in', tick: 1, ordinal: 2, bytes: Buffer.from(plainFrame(logout, new Uint8Array(Math.max(0, logout.length)))).toString('hex') },
        { type: 'end', segment: 2, reason: 'logout', inboundCount: 2, outboundCount: 0 }
    ];
    return { records, bundle };
}
