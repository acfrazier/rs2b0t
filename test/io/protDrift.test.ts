import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { skipUnless } from '../lib/skipUnless.js';
import {
    buildServerProtocolTables,
    generateProt,
    generateProtocolFixtures,
    parseProtocols,
    parseRevision
} from '../../tools/gen-prot.js';

const ENGINE_DIR = process.env.ENGINE_DIR?.trim() || undefined;
const JAVA_DIR = process.env.JAVA_DIR?.trim() || undefined;
const RUST_DIR = process.env.RUST_DIR?.trim() || undefined;
const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'prot377');

function engineRevision(engineDir: string): number | null {
    const readIfPresent = (path: string): string => {
        const file = join(engineDir, path);
        return existsSync(file) ? readFileSync(file, 'utf8') : '';
    };
    try {
        return parseRevision(readIfPresent('src/util/WorldConfig.ts'), readIfPresent('src/util/Environment.ts'));
    } catch {
        return null;
    }
}

const currentEngineRevision =
    ENGINE_DIR && existsSync(ENGINE_DIR) ? engineRevision(ENGINE_DIR) : null;
const engineFixtureReady = currentEngineRevision === 377;
const javaFixtureReady = Boolean(JAVA_DIR);
const rustFixtureReady = Boolean(RUST_DIR);
if (!engineFixtureReady) {
    console.log(
        `SKIP: test/io/protDrift.test.ts: 377 engine fixture refresh requires revision 377 (found ${currentEngineRevision ?? 'no readable engine'})`
    );
}
if (!javaFixtureReady) console.log('SKIP: test/io/protDrift.test.ts: JAVA_DIR is unset');
if (!rustFixtureReady) console.log('SKIP: test/io/protDrift.test.ts: RUST_DIR is unset');

type EngineProtocolFixture = {
    revision: number;
    server: Array<{ name: string; id: number; length: number }>;
    serverProtSizes: number[];
    serverProtKnown: number[];
};
const engineFixture = JSON.parse(readFileSync(join(FIXTURE_DIR, 'engine-prot.json'), 'utf8')) as EngineProtocolFixture;

function expectFixtureMatches(
    name: string,
    fixtures: Record<string, unknown>
): void {
    expect(`${JSON.stringify(fixtures[name], null, 2)}\n`, name).toBe(
        readFileSync(join(FIXTURE_DIR, name), 'utf8')
    );
}

describe('protocol revision parsing', () => {
    test('reads ENGINE_REVISION default from Environment.ts', () => {
        expect(parseRevision('export default { revision: 289 };', 'ENGINE_REVISION: tryParseInt(process.env.ENGINE_REVISION, 377),')).toBe(
            377
        );
    });

    test('falls back to WorldConfig.ts for a 289 engine', () => {
        expect(parseRevision('export default { revision: 289 };')).toBe(289);
    });

    test('keeps the 289-only REPORT_ABUSE alias out of revision 377', () => {
        const source = 'static readonly REPORT_ABUSE = new ClientProt(1, 2);';
        expect(parseProtocols(source, 377)[0].name).toBe('REPORT_ABUSE');
        expect(parseProtocols(source, 289)[0].name).toBe('SEND_SNAPSHOT');
    });

    test('matches only protocol declarations at line starts', () => {
        const source = [
            '// static readonly COMMENTED = new ClientProt(10, 0);',
            'static readonly REAL = new ClientProt(11, 0);'
        ].join('\n');
        expect(parseProtocols(source, 377)).toEqual([{ name: 'REAL', id: 11, length: 0 }]);
    });

    test('rejects duplicate opcodes and invalid packet lengths', () => {
        const duplicates = [
            'static readonly FIRST = new ClientProt(10, 0);',
            'static readonly SECOND = new ClientProt(10, 1);'
        ].join('\n');
        expect(() => parseProtocols(duplicates, 377)).toThrow('duplicate protocol opcode 10');
        expect(() => parseProtocols('static readonly BAD = new ClientProt(256, 0);', 377)).toThrow(
            'out-of-range opcode 256'
        );
        expect(() => parseProtocols('static readonly BAD = new ClientProt(-1, 0);', 377)).toThrow(
            'out-of-range opcode -1'
        );
        expect(() => parseProtocols('static readonly BAD = new ClientProt(10, -3);', 377)).toThrow(
            'invalid packet length -3'
        );
        expect(parseProtocols('static readonly VARIABLE = new ServerProt(10, -2);', 377)[0].length).toBe(-2);
    });
});

describe('protocol fixtures generated tables', () => {
    test('checks engine fixture size and membership arrays without ENGINE_DIR', () => {
        const generated = buildServerProtocolTables(engineFixture.server, engineFixture.revision);
        expect(engineFixture.serverProtSizes).toHaveLength(257);
        expect(engineFixture.serverProtSizes[256]).toBe(0);
        expect(engineFixture.serverProtSizes[187]).toBe(0);
        expect(engineFixture.serverProtKnown).toHaveLength(75);
        expect(engineFixture.serverProtSizes).toEqual(generated.sizes);
        expect(engineFixture.serverProtKnown).toEqual(generated.known);
    });
});

describe.skipIf(skipUnless('engine'))('protocol drift (matching engine revision)', () => {
    test('committed ClientProt matches the engine', () => {
        const { client } = generateProt(ENGINE_DIR!);
        expect(client).toBe(readFileSync('src/client/io/ClientProt.ts', 'utf8'));
    });

    test('committed ServerProt matches the engine', () => {
        const { server } = generateProt(ENGINE_DIR!);
        expect(server).toBe(readFileSync('src/client/io/ServerProt.ts', 'utf8'));
    });
});

describe.skipIf(!engineFixtureReady)('engine protocol fixture refresh', () => {
    test('refreshes only engine-prot.json from ENGINE_DIR', () => {
        const fixtures = generateProtocolFixtures({ engineDir: ENGINE_DIR! });
        expect(Object.keys(fixtures)).toEqual(['engine-prot.json']);
        expectFixtureMatches('engine-prot.json', fixtures);
    });
});

describe.skipIf(!javaFixtureReady)('Java protocol fixture refresh', () => {
    test('refreshes only java-server-sizes.json from JAVA_DIR', () => {
        const fixtures = generateProtocolFixtures({ javaDir: JAVA_DIR! });
        expect(Object.keys(fixtures)).toEqual(['java-server-sizes.json']);
        expectFixtureMatches('java-server-sizes.json', fixtures);
    });
});

describe.skipIf(!rustFixtureReady)('Rust protocol fixture refresh', () => {
    test('refreshes only rust-server-sizes.json from RUST_DIR', () => {
        const fixtures = generateProtocolFixtures({ rustDir: RUST_DIR! });
        expect(Object.keys(fixtures)).toEqual(['rust-server-sizes.json']);
        expectFixtureMatches('rust-server-sizes.json', fixtures);
    });
});
