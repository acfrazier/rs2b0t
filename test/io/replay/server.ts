import { Buffer } from 'node:buffer';

import Packet from '#/client/io/Packet.js';

import { ARCHIVES, type CacheBundle } from '../../../tools/tap-377/format.js';
import { nativeResponse as NativeResponse } from '../../setup-dom.js';

function decodeBase64(value: string, label: string): Uint8Array<ArrayBuffer> {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error(`invalid replay cache bytes for ${label}`);
    }

    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
        throw new Error(`invalid replay cache bytes for ${label}`);
    }

    return decoded;
}

export interface ReplayArchiveServer {
    readonly origin: string;
    readonly host: string;
    close(): void;
}

/** Serves the exact HTTP response bodies saved by the tap. */
export function startReplayArchiveServer(cache: CacheBundle): ReplayArchiveServer {
    if (cache.format !== 1) {
        throw new Error('unsupported replay cache format');
    }

    const routeBytes = new Map<string, Uint8Array<ArrayBuffer>>();
    const archives = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const name of ARCHIVES) {
        const encoded = cache.archives[name];
        if (typeof encoded !== 'string') {
            throw new Error(`replay cache is missing archive ${name}`);
        }
        const bytes = decodeBase64(encoded, name);
        if (bytes.length === 0) {
            throw new Error(`replay cache archive ${name} is empty`);
        }
        archives.set(name, bytes);
    }

    routeBytes.set('/crc', archives.get('crc')!);
    for (const name of ARCHIVES) {
        if (name === 'crc') continue;
        const bytes = archives.get(name)!;
        const checksum = Packet.getcrc(bytes, 0, bytes.length);
        routeBytes.set(`/${name}${checksum}`, bytes);
    }

    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request): Response {
            if (request.method !== 'GET') {
                return new NativeResponse(null, { status: 405 });
            }

            const bytes = routeBytes.get(new URL(request.url).pathname);
            if (!bytes) {
                return new NativeResponse('not found', { status: 404 });
            }

            return new NativeResponse(bytes, {
                headers: { 'content-type': 'application/octet-stream' }
            });
        }
    });

    const origin = server.url.origin;
    return {
        origin,
        host: server.url.host,
        close(): void {
            server.stop(true);
        }
    };
}
