// Why: a revision bump renumbers ~150 opcodes; generate them from the engine and gate on drift (see test/io/protDrift.test.ts).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_ENGINE_DIR = process.env.ENGINE_DIR ?? join(homedir(), 'code', 'rs2b2t-engine');

// Engine names mapped to client names; keep the existing Client.ts call sites.
const ALIAS_289: Record<string, string> = {
    IF_SETTAB: 'IF_SETICON',
    IF_SETTAB_ACTIVE: 'IF_SHOWICON',
    RESET_CLIENT_VARCACHE: 'VARP_SYNC',
    LOC_MERGE: 'P_LOCMERGE',
    REPORT_ABUSE: 'SEND_SNAPSHOT'
};

// Revision 377 has four aliases; REPORT_ABUSE is a 289-only protocol.
const ALIAS_377: Record<string, string> = {
    IF_SETTAB: 'IF_SETICON',
    IF_SETTAB_ACTIVE: 'IF_SHOWICON',
    RESET_CLIENT_VARCACHE: 'VARP_SYNC',
    LOC_MERGE: 'P_LOCMERGE'
};

const ENGINE_FILES = {
    client: 'src/network/game/client/ClientGameProt.ts',
    server: 'src/network/game/server/ServerGameProt.ts',
    zone: 'src/network/game/server/ServerGameZoneProt.ts',
    environment: 'src/util/Environment.ts',
    worldConfig: 'src/util/WorldConfig.ts'
};

const JAVA_FILE = 'src/main/java/jagex2/io/Protocol.java';
const RUST_FILE = 'crates/client/src/io/server_prot_sizes_377.inc.rs';

export type Prot = { name: string; id: number; length: number };

type ProtocolFixture = {
    source: { repository: string; commit: string; files: string[] };
    revision: number;
    client: Prot[];
    server: Prot[];
    serverProtSizes: number[];
    serverProtKnown: number[];
};

type SizesFixture = {
    source: { repository: string; commit: string; file: string; line: number };
    revision: number;
    sizes: number[];
};

type ProtocolFixtureInputs = {
    engineDir?: string;
    javaDir?: string;
    rustDir?: string;
};

export function parseProtocols(source: string, revision: number): Prot[] {
    const aliases = revision === 377 ? ALIAS_377 : ALIAS_289;
    const re = /^\s*static readonly ([A-Z0-9_]+) = new [A-Za-z]+\((-?\d+),\s*(-?\d+)\)/gm;
    const out: Prot[] = [];
    const names = new Set<string>();
    const ids = new Set<number>();
    for (const m of source.matchAll(re)) {
        const name = aliases[m[1]] ?? m[1];
        const id = Number(m[2]);
        const length = Number(m[3]);
        if (!Number.isInteger(id) || id < 0 || id > 255) {
            throw new Error(`protocol ${name} has out-of-range opcode ${id}`);
        }
        if (length < -2) throw new Error(`protocol ${name} has invalid packet length ${length}`);
        if (names.has(name)) throw new Error(`duplicate protocol name ${name}`);
        if (ids.has(id)) throw new Error(`duplicate protocol opcode ${id}`);
        names.add(name);
        ids.add(id);
        out.push({ name, id, length });
    }
    return out;
}

function renderEnum(name: string, prots: Prot[]): string {
    const body = prots.map(p => `    ${p.name} = ${p.id},`).join('\n');
    return `export const enum ${name} {\n${body}\n}\n`;
}

export function buildServerProtocolTables(
    prots: Prot[],
    revision: number
): { sizes: number[]; known: number[] } {
    // Java 377 retains unreachable slot 256; 289 output stays unchanged until cutover.
    const length = revision === 377 ? 257 : 256;
    const sizes = new Array<number>(length).fill(0);
    for (const p of prots) {
        sizes[p.id] = p.length;
    }
    return { sizes, known: prots.map(protocol => protocol.id) };
}

function renderSizes(sizes: number[]): string {
    const rows: string[] = [];
    for (let i = 0; i < sizes.length; i += 10) {
        rows.push('    ' + sizes.slice(i, i + 10).join(', ') + ',');
    }
    return `export const ServerProtSizes = [\n${rows.join('\n')}\n];\n`;
}

function renderKnown(known: number[]): string {
    const rows: string[] = [];
    for (let i = 0; i < known.length; i += 10) {
        rows.push('    ' + known.slice(i, i + 10).join(', ') + ',');
    }
    return `export const ServerProtKnown: readonly number[] = [\n${rows.join('\n')}\n];\n`;
}

export function parseRevision(worldConfigSource: string, environmentSource = ''): number {
    const engineRevision = environmentSource.match(
        /ENGINE_REVISION:\s*tryParseInt\(process\.env\.ENGINE_REVISION,\s*(\d+)\)/
    );
    if (engineRevision) return Number(engineRevision[1]);

    const worldConfigRevision = worldConfigSource.match(/revision:\s*(\d+)/);
    if (!worldConfigRevision) {
        throw new Error('could not find ENGINE_REVISION default or revision: <n> in WorldConfig.ts');
    }
    return Number(worldConfigRevision[1]);
}

export function generateProt(engineDir: string): {
    client: string;
    server: string;
    revision: number;
    clientProtocols: Prot[];
    serverProtocols: Prot[];
    serverProtSizes: number[];
    serverProtKnown: number[];
} {
    const read = (p: string) => readFileSync(join(engineDir, p), 'utf8');
    const readOptional = (p: string) => (existsSync(join(engineDir, p)) ? read(p) : '');

    const revision = parseRevision(readOptional(ENGINE_FILES.worldConfig), readOptional(ENGINE_FILES.environment));
    const clientProtocols = parseProtocols(read(ENGINE_FILES.client), revision);
    const serverProtocols = parseProtocols(`${read(ENGINE_FILES.server)}\n${read(ENGINE_FILES.zone)}`, revision);
    const { sizes: serverProtSizes, known: serverProtKnown } = buildServerProtocolTables(serverProtocols, revision);

    const header = '// GENERATED by tools/gen-prot.ts from the engine. Do not edit by hand.\n\n';

    // Keep the committed 289 module unchanged until the coordinated cutover.
    const serverKnown = revision === 377 ? '\n' + renderKnown(serverProtKnown) : '';
    return {
        client: header + `export const CLIENT_VERSION = ${revision};\n\n` + renderEnum('ClientProt', clientProtocols),
        server:
            header +
            renderEnum('ServerProt', serverProtocols) +
            '\n' +
            renderSizes(serverProtSizes) +
            serverKnown,
        revision,
        clientProtocols,
        serverProtocols,
        serverProtSizes,
        serverProtKnown
    };
}

function sourceCommit(directory: string): string {
    const commit = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`invalid source commit in ${directory}`);
    return commit;
}

function sourceLine(source: string, pattern: RegExp, description: string): number {
    const match = source.match(pattern);
    if (!match || match.index === undefined) throw new Error(`could not find ${description}`);
    return source.slice(0, match.index).split('\n').length;
}

function parseSizes(body: string, expectedLength: number, sourceName: string): number[] {
    const values = body
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => {
            if (!/^-?\d+$/.test(value)) throw new Error(`invalid packet size in ${sourceName}: ${value}`);
            return Number(value);
        });
    if (values.length !== expectedLength) {
        throw new Error(`${sourceName} has ${values.length} sizes; expected ${expectedLength}`);
    }
    return values;
}

export function generateProtocolFixtures(
    inputs: ProtocolFixtureInputs
): Record<string, ProtocolFixture | SizesFixture> {
    const fixtures: Record<string, ProtocolFixture | SizesFixture> = {};

    if (inputs.engineDir) {
        const generated = generateProt(inputs.engineDir);
        if (generated.revision !== 377) {
            throw new Error(`fixtures require engine revision 377, got ${generated.revision}`);
        }
        if (generated.clientProtocols.length !== 80 || generated.serverProtocols.length !== 75) {
            throw new Error(
                `revision 377 protocol census is ${generated.clientProtocols.length}/${generated.serverProtocols.length}; expected 80/75`
            );
        }
        fixtures['engine-prot.json'] = {
            source: {
                repository: 'FR-engine',
                commit: sourceCommit(inputs.engineDir),
                files: [ENGINE_FILES.client, ENGINE_FILES.server, ENGINE_FILES.zone, ENGINE_FILES.environment]
            },
            revision: generated.revision,
            client: generated.clientProtocols,
            server: generated.serverProtocols,
            serverProtSizes: generated.serverProtSizes,
            serverProtKnown: generated.serverProtKnown
        };
    }

    if (inputs.javaDir) {
        const javaSource = readFileSync(join(inputs.javaDir, JAVA_FILE), 'utf8');
        const javaMatch = javaSource.match(/SERVERPROT_LENGTH\s*=\s*new\s+int\[\]\s*\{([\s\S]*?)\}/);
        if (!javaMatch) throw new Error(`could not find SERVERPROT_LENGTH in ${JAVA_FILE}`);
        const javaSizes = parseSizes(javaMatch[1], 257, JAVA_FILE);
        fixtures['java-server-sizes.json'] = {
            source: {
                repository: 'FR-client-java',
                commit: sourceCommit(inputs.javaDir),
                file: JAVA_FILE,
                line: sourceLine(javaSource, /SERVERPROT_LENGTH\s*=/, 'SERVERPROT_LENGTH declaration')
            },
            revision: 377,
            sizes: javaSizes
        };
    }

    if (inputs.rustDir) {
        const rustSource = readFileSync(join(inputs.rustDir, RUST_FILE), 'utf8');
        const rustMatch = rustSource.match(/SERVER_PROT_SIZES_377:\s*\[i32;\s*256\]\s*=\s*\[([\s\S]*?)\];/);
        if (!rustMatch) throw new Error(`could not find SERVER_PROT_SIZES_377 in ${RUST_FILE}`);
        const rustSizes = parseSizes(rustMatch[1], 256, RUST_FILE);
        fixtures['rust-server-sizes.json'] = {
            source: {
                repository: 'FR-client-bothost',
                commit: sourceCommit(inputs.rustDir),
                file: RUST_FILE,
                line: sourceLine(rustSource, /pub const SERVER_PROT_SIZES_377:/, 'SERVER_PROT_SIZES_377 declaration')
            },
            revision: 377,
            sizes: rustSizes
        };
    }

    return fixtures;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const fixturesIndex = args.indexOf('--fixtures');
    if (fixturesIndex !== -1) {
        const outputDir = args[fixturesIndex + 1] ?? 'test/io/fixtures/prot377';
        const engineDir = process.env.ENGINE_DIR;
        const javaDir = process.env.JAVA_DIR;
        const rustDir = process.env.RUST_DIR;
        if (!engineDir && !javaDir && !rustDir) {
            throw new Error('--fixtures requires ENGINE_DIR, JAVA_DIR, or RUST_DIR');
        }

        const fixtures = generateProtocolFixtures({
            ...(engineDir ? { engineDir } : {}),
            ...(javaDir ? { javaDir } : {}),
            ...(rustDir ? { rustDir } : {})
        });
        mkdirSync(outputDir, { recursive: true });
        for (const [name, fixture] of Object.entries(fixtures)) {
            writeFileSync(join(outputDir, name), `${JSON.stringify(fixture, null, 2)}\n`);
        }
        console.log(`wrote ${Object.keys(fixtures).join(', ')} to ${outputDir}`);
    } else {
        const { client, server } = generateProt(DEFAULT_ENGINE_DIR);
        writeFileSync('src/client/io/ClientProt.ts', client);
        writeFileSync('src/client/io/ServerProt.ts', server);
        console.log('wrote src/client/io/{ClientProt,ServerProt}.ts');
    }
}
