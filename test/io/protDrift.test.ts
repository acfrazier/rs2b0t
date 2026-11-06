import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    DEFAULT_ENGINE_DIR,
    generateProt,
    generateProtocolFixtures,
    parseProtocols,
    parseRevision
} from '../../tools/gen-prot.js';

const ENGINE = process.env.ENGINE_DIR ?? DEFAULT_ENGINE_DIR;
const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'prot377');
const JAVA_DIR = process.env.JAVA_DIR;
const RUST_DIR = process.env.RUST_DIR;

function engineRevision(engineDir: string): number | null {
    const readIfPresent = (path: string): string => {
        const file = join(engineDir, path);
        return existsSync(file) ? readFileSync(file, 'utf8') : '';
    };
    try {
        return parseRevision(
            readIfPresent('src/util/WorldConfig.ts'),
            readIfPresent('src/util/Environment.ts')
        );
    } catch {
        return null;
    }
}

const committedVersionMatch = readFileSync('src/client/io/ClientProt.ts', 'utf8').match(
    /export const CLIENT_VERSION = (\d+);/
);
if (!committedVersionMatch) throw new Error('committed ClientProt.ts has no CLIENT_VERSION');
const committedVersion = Number(committedVersionMatch[1]);

const engineInputPresent = existsSync(ENGINE);
const currentEngineRevision = engineInputPresent ? engineRevision(ENGINE) : null;
const engineMatchesClient = currentEngineRevision === committedVersion;
if (!engineInputPresent) {
    console.log('SKIP: test/io/protDrift.test.ts: ENGINE_DIR absent or on another revision (ENGINE_DIR is unset or does not exist)');
} else if (!engineMatchesClient) {
    console.log(
        `SKIP: test/io/protDrift.test.ts: ENGINE_DIR absent or on another revision (engine is revision ${currentEngineRevision}, the committed client is ${committedVersion})`
    );
}

const fixtureInputs = [
    {
        name: 'ENGINE_DIR',
        present: existsSync(join(ENGINE, 'src/network/game/client/ClientGameProt.ts'))
    },
    {
        name: 'JAVA_DIR',
        present: Boolean(JAVA_DIR && existsSync(join(JAVA_DIR, 'src/main/java/jagex2/io/Protocol.java')))
    },
    {
        name: 'RUST_DIR',
        present: Boolean(RUST_DIR && existsSync(join(RUST_DIR, 'crates/client/src/io/server_prot_sizes_377.inc.rs')))
    }
];
const missingFixtureInputs = fixtureInputs.filter(input => !input.present).map(input => input.name);
const fixtureEngineRevision = engineInputPresent ? engineRevision(ENGINE) : null;
const fixtureRevisionMatches = fixtureEngineRevision === 377;
const canRefreshFixtures = missingFixtureInputs.length === 0 && fixtureRevisionMatches;
if (!canRefreshFixtures) {
    const reason =
        missingFixtureInputs.length > 0
            ? `fixture inputs missing: ${missingFixtureInputs.join(', ')}`
            : `fixture engine revision is ${fixtureEngineRevision}, expected 377`;
    console.log(`SKIP: test/io/protDrift.test.ts: ${reason}`);
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

    test('rejects duplicate and out-of-range protocol opcodes', () => {
        expect(() =>
            parseProtocols(
                'static readonly FIRST = new ClientProt(10, 0); static readonly SECOND = new ClientProt(10, 1);',
                377
            )
        ).toThrow('duplicate protocol opcode 10');
        expect(() => parseProtocols('static readonly BAD = new ClientProt(256, 0);', 377)).toThrow(
            'out-of-range opcode 256'
        );
        expect(() => parseProtocols('static readonly BAD = new ClientProt(-1, 0);', 377)).toThrow(
            'out-of-range opcode -1'
        );
    });
});

describe.skipIf(fixtureEngineRevision !== 377)('revision 377 protocol generation', () => {
    test('emits a 257-entry size table and every known server opcode', () => {
        const generated = generateProt(ENGINE);
        const sizesMatch = generated.server.match(/export const ServerProtSizes = \[([\s\S]*?)\];/);
        const knownMatch = generated.server.match(/export const ServerProtKnown: readonly number\[\] = \[([\s\S]*?)\];/);
        expect(sizesMatch).not.toBeNull();
        expect(knownMatch).not.toBeNull();

        const sizes = sizesMatch![1]
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
            .map(Number);
        const known = knownMatch![1]
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
            .map(Number);

        expect(sizes).toHaveLength(257);
        expect(sizes[256]).toBe(0);
        expect(known).toHaveLength(75);
        expect(known).toEqual(generated.serverProtocols.map(protocol => protocol.id));
    });
});


describe.skipIf(!engineMatchesClient)('protocol drift (matching engine revision)', () => {
    test('committed ClientProt matches the engine', () => {
        const { client } = generateProt(ENGINE);
        expect(client).toBe(readFileSync('src/client/io/ClientProt.ts', 'utf8'));
    });

    test('committed ServerProt matches the engine', () => {
        const { server } = generateProt(ENGINE);
        expect(server).toBe(readFileSync('src/client/io/ServerProt.ts', 'utf8'));
    });
});

describe.skipIf(!canRefreshFixtures)('protocol fixture refresh (pinned 377 sources)', () => {
    test('regenerates all committed fixtures byte-identically', () => {
        const fixtures = generateProtocolFixtures(ENGINE, JAVA_DIR!, RUST_DIR!);
        for (const [name, fixture] of Object.entries(fixtures)) {
            expect(`${JSON.stringify(fixture, null, 2)}\n`, name).toBe(
                readFileSync(join(FIXTURE_DIR, name), 'utf8')
            );
        }
    });
});
