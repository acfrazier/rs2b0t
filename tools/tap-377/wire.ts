import Isaac from '../../src/client/io/Isaac.js';
import type { Direction, Protocol } from './format.js';

export interface DecodedFrame {
    direction: Direction;
    descriptor: Protocol['client'][number] | Protocol['server'][number];
    bytes: Uint8Array;
}

export class GameFrameDecoder {
    private readonly descriptors: Map<number, Protocol['client'][number] | Protocol['server'][number]>;
    private buffer = new Uint8Array();
    private offset = 0;
    private frame: {
        opcode: number;
        descriptor: Protocol['client'][number] | Protocol['server'][number];
        prefixLength: number;
        prefix: Uint8Array;
        prefixRead: number;
        payloadLength: number | null;
        bytes: Uint8Array | null;
        payloadRead: number;
    } | null = null;

    constructor(
        private readonly direction: Direction,
        protocol: Protocol,
        private readonly isaac: Isaac,
        private readonly onFrame: (frame: DecodedFrame) => void
    ) {
        const descriptors = direction === 'in' ? protocol.server : protocol.client;
        this.descriptors = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]));
    }

    get pendingBytes(): number {
        return this.buffer.length - this.offset + (this.frame ? 1 + this.frame.prefixRead + this.frame.payloadRead : 0);
    }

    push(chunk: Uint8Array): void {
        if (chunk.length === 0) return;
        const rest = this.buffer.subarray(this.offset);
        const joined = new Uint8Array(rest.length + chunk.length);
        joined.set(rest);
        joined.set(chunk, rest.length);
        this.buffer = joined;
        this.offset = 0;

        while (this.offset < this.buffer.length || this.frame) {
            if (!this.frame) {
                const encoded = this.buffer[this.offset++];
                const opcode = (encoded - this.isaac.nextInt) & 0xff;
                const descriptor = this.descriptors.get(opcode);
                if (!descriptor) throw new Error('unknown game opcode');
                const prefixLength = descriptor.length === -1 ? 1 : descriptor.length === -2 ? 2 : 0;
                const payloadLength = prefixLength === 0 ? descriptor.length : null;
                this.frame = {
                    opcode,
                    descriptor,
                    prefixLength,
                    prefix: new Uint8Array(prefixLength),
                    prefixRead: 0,
                    payloadLength,
                    bytes: null,
                    payloadRead: 0
                };
                if (payloadLength !== null) this.allocateFrame();
            }

            const current = this.frame!;
            if (current.payloadLength === null) {
                current.prefixRead += this.take(current.prefix, current.prefixRead);
                if (current.prefixRead < current.prefixLength) break;
                current.payloadLength = current.prefixLength === 1
                    ? current.prefix[0]
                    : (current.prefix[0] << 8) | current.prefix[1];
                this.allocateFrame();
            }

            const target = current.bytes!;
            const bodyOffset = 1 + current.prefixLength + current.payloadRead;
            current.payloadRead += this.take(target, bodyOffset, target.length - bodyOffset);
            if (current.payloadRead < current.payloadLength!) break;

            const completed: DecodedFrame = {
                direction: this.direction,
                descriptor: current.descriptor,
                bytes: target
            };
            this.frame = null;
            this.onFrame(completed);
        }

        this.compact();
    }

    finish(): void {
        if (this.pendingBytes !== 0) throw new Error('truncated game frame');
    }

    private allocateFrame(): void {
        const current = this.frame!;
        const bodyLength = current.payloadLength!;
        if (!Number.isSafeInteger(bodyLength) || bodyLength < 0 || bodyLength > 0xffff) {
            throw new Error('invalid game frame length');
        }
        const bytes = new Uint8Array(1 + current.prefixLength + bodyLength);
        bytes[0] = current.opcode;
        bytes.set(current.prefix, 1);
        current.bytes = bytes;
    }

    private take(target: Uint8Array, targetOffset: number, limit = target.length - targetOffset): number {
        const count = Math.min(limit, this.buffer.length - this.offset);
        if (count > 0) {
            target.set(this.buffer.subarray(this.offset, this.offset + count), targetOffset);
            this.offset += count;
        }
        return count;
    }

    private compact(): void {
        if (this.offset === this.buffer.length) {
            this.buffer = new Uint8Array();
            this.offset = 0;
        } else if (this.offset > 0) {
            this.buffer = this.buffer.slice(this.offset);
            this.offset = 0;
        }
    }
}

interface PendingChunk {
    archive: number;
    file: number;
    size: number;
    part: number;
    expectedBytes: number;
}

interface Assembly {
    size: number;
    expectedParts: number;
    data: Uint8Array;
    chunks: Map<number, Uint8Array>;
}

export class OnDemandStream {
    private clientBuffer: Uint8Array = new Uint8Array();
    private serverBuffer: Uint8Array = new Uint8Array();
    private clientHandshaken = false;
    private serverHandshakeBytes = 8;
    private pendingChunk: PendingChunk | null = null;
    private readonly pending = new Set<string>();
    private readonly assemblies = new Map<string, Assembly>();

    constructor(
        private readonly onRequest: (archive: number, file: number) => void,
        private readonly onFile: (archive: number, file: number, bytes: Uint8Array) => void
    ) {}

    get pendingBytes(): number {
        return this.clientBuffer.length + this.serverBuffer.length;
    }

    get pendingCount(): number {
        return this.pending.size;
    }

    pushClient(chunk: Uint8Array): void {
        this.clientBuffer = append(this.clientBuffer, chunk);
        if (!this.clientHandshaken) {
            if (this.clientBuffer.length === 0) return;
            if (this.clientBuffer[0] !== 15) throw new Error('invalid OnDemand handshake');
            this.clientBuffer = this.clientBuffer.slice(1);
            this.clientHandshaken = true;
        }
        while (this.clientBuffer.length >= 4) {
            const archive = this.clientBuffer[0];
            const file = (this.clientBuffer[1] << 8) | this.clientBuffer[2];
            const priority = this.clientBuffer[3];
            if (archive > 3 || priority > 2) throw new Error('invalid OnDemand request');
            this.clientBuffer = this.clientBuffer.slice(4);
            const key = `${archive}/${file}`;
            this.pending.add(key);
            this.onRequest(archive, file);
        }
    }

    pushServer(chunk: Uint8Array): void {
        this.serverBuffer = append(this.serverBuffer, chunk);
        if (this.serverHandshakeBytes > 0) {
            const skipped = Math.min(this.serverHandshakeBytes, this.serverBuffer.length);
            this.serverBuffer = this.serverBuffer.slice(skipped);
            this.serverHandshakeBytes -= skipped;
        }
        while (true) {
            if (!this.pendingChunk) {
                if (this.serverBuffer.length < 6) break;
                const archive = this.serverBuffer[0];
                const file = (this.serverBuffer[1] << 8) | this.serverBuffer[2];
                const size = (this.serverBuffer[3] << 8) | this.serverBuffer[4];
                const part = this.serverBuffer[5];
                this.serverBuffer = this.serverBuffer.slice(6);
                if (archive > 3) throw new Error('invalid OnDemand response archive');
                const key = `${archive}/${file}`;
                if (!this.pending.has(key)) throw new Error('unsolicited OnDemand response');
                if (size === 0) throw new Error('missing OnDemand file');
                const expectedParts = Math.ceil(size / 500);
                if (part >= expectedParts) throw new Error('invalid OnDemand chunk index');
                const expectedBytes = Math.min(500, size - part * 500);
                let assembly = this.assemblies.get(key);
                if (!assembly) {
                    assembly = { size, expectedParts, data: new Uint8Array(size), chunks: new Map() };
                    this.assemblies.set(key, assembly);
                } else if (assembly.size !== size) {
                    throw new Error('conflicting OnDemand size');
                }
                this.pendingChunk = { archive, file, size, part, expectedBytes };
            }

            const current = this.pendingChunk;
            if (this.serverBuffer.length < current.expectedBytes) break;
            const key = `${current.archive}/${current.file}`;
            const assembly = this.assemblies.get(key)!;
            const bytes = this.serverBuffer.slice(0, current.expectedBytes);
            this.serverBuffer = this.serverBuffer.slice(current.expectedBytes);
            const previous = assembly.chunks.get(current.part);
            if (previous) {
                if (!equalBytes(previous, bytes)) throw new Error('conflicting OnDemand chunk');
            } else {
                assembly.chunks.set(current.part, bytes);
                assembly.data.set(bytes, current.part * 500);
            }
            this.pendingChunk = null;

            if (assembly.chunks.size === assembly.expectedParts) {
                this.onFile(current.archive, current.file, assembly.data);
                this.assemblies.delete(key);
                this.pending.delete(key);
            }
        }
    }

    finish(): void {
        if (
            !this.clientHandshaken ||
            this.serverHandshakeBytes !== 0 ||
            this.clientBuffer.length !== 0 ||
            this.serverBuffer.length !== 0 ||
            this.pendingChunk !== null ||
            this.pending.size !== 0 ||
            this.assemblies.size !== 0
        ) {
            throw new Error('truncated OnDemand stream');
        }
    }
}

function append(left: Uint8Array, right: Uint8Array): Uint8Array {
    if (right.length === 0) return left;
    const joined = new Uint8Array(left.length + right.length);
    joined.set(left);
    joined.set(right, left.length);
    return joined;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}
