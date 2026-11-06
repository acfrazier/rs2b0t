import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { generateProt } from '../gen-prot.js';
import type { Protocol } from './format.js';

const FIXTURE_PATH = new URL('../../test/io/fixtures/prot377/engine-prot.json', import.meta.url);

function validateProtocol(protocol: Protocol): Protocol {
    if (!Number.isSafeInteger(protocol.revision) || protocol.revision <= 0) {
        throw new Error('invalid protocol revision');
    }
    for (const direction of ['client', 'server'] as const) {
        const names = new Set<string>();
        const ids = new Set<number>();
        for (const descriptor of protocol[direction]) {
            if (
                !/^[A-Z0-9_]+$/.test(descriptor.name) ||
                !Number.isInteger(descriptor.id) ||
                descriptor.id < 0 ||
                descriptor.id > 255 ||
                !Number.isInteger(descriptor.length) ||
                descriptor.length < -2
            ) {
                throw new Error('invalid protocol descriptor');
            }
            if (names.has(descriptor.name) || ids.has(descriptor.id)) {
                throw new Error('duplicate protocol descriptor');
            }
            names.add(descriptor.name);
            ids.add(descriptor.id);
        }
    }
    if (protocol.client.length === 0 || protocol.server.length === 0) {
        throw new Error('empty protocol inventory');
    }
    return protocol;
}

function sameDescriptors(left: Protocol, right: Protocol): boolean {
    if (left.revision !== right.revision) return false;
    for (const direction of ['client', 'server'] as const) {
        const a = [...left[direction]].sort((x, y) => x.id - y.id);
        const b = [...right[direction]].sort((x, y) => x.id - y.id);
        if (a.length !== b.length) return false;
        for (let index = 0; index < a.length; index++) {
            const first = a[index];
            const second = b[index];
            if (first.id !== second.id || first.length !== second.length || first.name !== second.name) return false;
        }
    }
    return true;
}

export function load377Protocol(): Protocol {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
        revision: number;
        client: Protocol['client'];
        server: Protocol['server'];
    };
    if (fixture.revision !== 377) throw new Error('invalid pinned protocol fixture');
    return validateProtocol({ revision: fixture.revision, client: fixture.client, server: fixture.server });
}

export function loadEngineProtocol(engineDir: string): Protocol {
    const generated = generateProt(resolve(engineDir));
    const protocol = validateProtocol({
        revision: generated.revision,
        client: generated.clientProtocols.map(({ name, id, length }) => ({ name, id, length })),
        server: generated.serverProtocols.map(({ name, id, length }) => ({ name, id, length }))
    });
    if (protocol.revision === 377 && !sameDescriptors(protocol, load377Protocol())) {
        throw new Error('engine protocol differs from pinned revision 377 inventory');
    }
    return protocol;
}

export function validateProtocolForRevision(protocol: Protocol): Protocol {
    const validated = validateProtocol(protocol);
    if (validated.revision === 377 && !sameDescriptors(validated, load377Protocol())) {
        throw new Error('protocol differs from pinned revision 377 inventory');
    }
    return validated;
}

