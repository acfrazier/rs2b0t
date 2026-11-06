import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Prot = { name: string; id: number; length: number };
type EngineFixture = {
    source: { repository: string; commit: string; files: string[] };
    revision: number;
    client: Prot[];
    server: Prot[];
};
type SizesFixture = {
    source: { repository: string; commit: string; file: string; line: number };
    revision: number;
    sizes: number[];
};

const fixtureDir = join(import.meta.dir, 'fixtures', 'prot377');
const engine = JSON.parse(readFileSync(join(fixtureDir, 'engine-prot.json'), 'utf8')) as EngineFixture;
const java = JSON.parse(readFileSync(join(fixtureDir, 'java-server-sizes.json'), 'utf8')) as SizesFixture;
const rust = JSON.parse(readFileSync(join(fixtureDir, 'rust-server-sizes.json'), 'utf8')) as SizesFixture;
const JAVA_ONLY = new Map<number, number>([[187, 6]]);

function validateDescriptors(protocols: Prot[]): void {
    const ids = new Set<number>();
    const names = new Set<string>();
    for (const protocol of protocols) {
        if (!Number.isInteger(protocol.id) || protocol.id < 0 || protocol.id > 255) {
            throw new Error(`out-of-range opcode ${protocol.id}`);
        }
        if (ids.has(protocol.id)) throw new Error(`duplicate opcode ${protocol.id}`);
        if (names.has(protocol.name)) throw new Error(`duplicate protocol name ${protocol.name}`);
        ids.add(protocol.id);
        names.add(protocol.name);
    }
}

function unlistedNonzero(sizes: number[], engineOpcodes: Set<number>): Map<number, number> {
    const unlisted = new Map<number, number>();
    for (let id = 0; id < sizes.length; id++) {
        const size = sizes[id];
        if (size !== 0 && !engineOpcodes.has(id)) unlisted.set(id, size);
    }
    return unlisted;
}

describe('377 protocol tables (committed three-way fixtures)', () => {
    test('fixtures identify their pinned sources', () => {
        expect(engine.revision).toBe(377);
        expect(engine.source.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(java.source.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(rust.source.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(java.source).toMatchObject({ file: 'src/main/java/jagex2/io/Protocol.java', line: 11 });
        expect(rust.source).toMatchObject({
            file: 'crates/client/src/io/server_prot_sizes_377.inc.rs',
            line: 3
        });
    });

    test('engine descriptors have unique in-range opcodes and the expected census', () => {
        expect(() => validateDescriptors(engine.client)).not.toThrow();
        expect(() => validateDescriptors(engine.server)).not.toThrow();
        expect(engine.client).toHaveLength(80);
        expect(engine.server).toHaveLength(75);
    });

    test('rejects duplicate and out-of-range engine descriptor ids', () => {
        expect(() =>
            validateDescriptors([
                { name: 'FIRST', id: 10, length: 0 },
                { name: 'SECOND', id: 10, length: 1 }
            ])
        ).toThrow('duplicate opcode 10');
        expect(() => validateDescriptors([{ name: 'BAD', id: 256, length: 0 }])).toThrow('out-of-range opcode 256');
        expect(() => validateDescriptors([{ name: 'BAD', id: -1, length: 0 }])).toThrow('out-of-range opcode -1');
    });

    test('every engine server descriptor has matching Java and Rust size', () => {
        expect(java.revision).toBe(377);
        expect(rust.revision).toBe(377);
        expect(java.sizes).toHaveLength(257);
        expect(rust.sizes).toHaveLength(256);
        expect(java.sizes[256]).toBe(0);

        const engineOpcodes = new Set(engine.server.map(protocol => protocol.id));
        for (const protocol of engine.server) {
            expect(java.sizes[protocol.id], `Java opcode ${protocol.id} (${protocol.name})`).toBe(protocol.length);
            expect(rust.sizes[protocol.id], `Rust opcode ${protocol.id} (${protocol.name})`).toBe(protocol.length);
        }

        expect(Object.fromEntries(unlistedNonzero(java.sizes, engineOpcodes))).toEqual(
            Object.fromEntries(JAVA_ONLY)
        );
        expect(Object.fromEntries(unlistedNonzero(rust.sizes, engineOpcodes))).toEqual(
            Object.fromEntries(JAVA_ONLY)
        );
        expect(engineOpcodes.has(187)).toBe(false);
    });
});
