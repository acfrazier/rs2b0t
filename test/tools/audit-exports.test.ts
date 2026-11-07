import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { classifyExportGroup, integrateCensus, newRefBucket, runExportCensus, type CandidateRow, type ExportRow, type MemberOutRow, type RefBucket } from '../../tools/lib/exportCensus.js';
import { collectHeritageDeclarations, createConduitResolver, exportInterestNames, moduleExportTargets } from '../../tools/lib/exportCensusCore.js';
import { parseAuditArgs } from '../../tools/audit-exports.js';

function emptyBucket(overrides: Partial<RefBucket> = {}): RefBucket {
    return { ...newRefBucket(), ...overrides };
}

function writeTree(root: string, files: Record<string, string>): void {
    for (const [path, contents] of Object.entries(files)) {
        const full = join(root, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents);
    }
}

function fixtureRoot(): string {
    return mkdtempSync(join(tmpdir(), 'audit-exports-'));
}

const fixtureTsconfig = JSON.stringify({
    compilerOptions: {
        strict: true,
        noImplicitThis: true,
        noEmit: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        baseUrl: '.',
        paths: { '#/*': ['src/*'] },
        allowJs: true
    },
    include: ['src/**/*', 'test/**/*']
});

describe('createConduitResolver', () => {
    test('resolves .js/.mjs/.cjs specifiers and #/ aliases onto inventoried sources', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'src/main.ts': 'export const main = true;\n',
                'src/plain.ts': 'export const Plain = 1;\n',
                'src/esm.mts': 'export const ESM = 2;\n',
                'src/common.cts': 'export const Common = 3;\n'
            });
            const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
            const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
            const compilerOptions = { ...parsed.options, noEmit: true };
            const scopeFiles = parsed.fileNames.map(file => relative(root, file).split(sep).join('/'));
            const resolveConduit = createConduitResolver({ root, compilerOptions, scopedFiles: scopeFiles });
            expect(resolveConduit('src/main.ts', './plain.js')).toBe('src/plain.ts');
            expect(resolveConduit('src/main.ts', './esm.mjs')).toBe('src/esm.mts');
            expect(resolveConduit('src/main.ts', './common.cjs')).toBe('src/common.cts');
            expect(resolveConduit('src/main.ts', '#/common.cjs')).toBe('src/common.cts');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('named and star conduits', () => {
    test('star re-exports resolve to the declaration owner, including chained renamed ESM and #/ targets', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'src/plain.ts': 'export const Plain = 1;\n',
                'src/esm.mts': 'export const ESM = 2;\n',
                'src/common.cts': 'export const Common = 3;\n',
                'src/renamed.ts': "export { Plain as Renamed } from './plain.js';\n",
                'src/star.ts': "export * from './renamed.js';\nexport * from './esm.mjs';\nexport * from '#/common.cjs';\n"
            });
            const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
            const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
            const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
            const checker = program.getTypeChecker();
            const resolveAlias = (symbol: ts.Symbol): ts.Symbol => {
                let current = symbol;
                const seen = new Set<ts.Symbol>();
                while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
                    seen.add(current);
                    current = checker.getAliasedSymbol(current);
                }
                return current;
            };
            const declKeyOf = (symbol: ts.Symbol): string | null => {
                const declaration = symbol?.declarations?.[0];
                return declaration ? `${relative(root, declaration.getSourceFile().fileName).split(sep).join('/')}:${declaration.getStart()}` : null;
            };
            const starFile = program.getSourceFile(join(root, 'src/star.ts'));
            expect(starFile).toBeDefined();
            const starTargets = moduleExportTargets({ checker, sourceFile: starFile!, resolveAlias, declKeyOf });
            const starOwners = Object.fromEntries(starTargets.map(target => [target.exportName, target.ownerFile]));
            expect(starOwners).toEqual({
                Renamed: 'src/plain.ts',
                ESM: 'src/esm.mts',
                Common: 'src/common.cts'
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('local and default aliases', () => {
    test('interest includes local identifiers and same-file calls resolve to the exported declaration', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'src/aliases.ts':
                    ['function localAlias() { return 1 }', 'localAlias();', 'export { localAlias as publicAlias };', 'function defaultImplementation() { return 2 }', 'defaultImplementation();', 'export default defaultImplementation;'].join('\n') +
                    '\n'
            });
            const interests = exportInterestNames([
                { name: 'publicAlias', local: 'localAlias' },
                { name: 'default', local: 'defaultImplementation' }
            ]);
            expect(interests.has('localAlias')).toBe(true);
            expect(interests.has('defaultImplementation')).toBe(true);

            const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
            const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
            const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
            const checker = program.getTypeChecker();
            const resolveAlias = (symbol: ts.Symbol): ts.Symbol => {
                let current = symbol;
                const seen = new Set<ts.Symbol>();
                while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
                    seen.add(current);
                    current = checker.getAliasedSymbol(current);
                }
                return current;
            };
            const declKeyOf = (symbol: ts.Symbol): string | null => {
                const declaration = symbol?.declarations?.[0];
                return declaration ? `${relative(root, declaration.getSourceFile().fileName).split(sep).join('/')}:${declaration.getStart()}` : null;
            };
            const aliasFile = program.getSourceFile(join(root, 'src/aliases.ts'));
            expect(aliasFile).toBeDefined();
            const aliasTargets = moduleExportTargets({ checker, sourceFile: aliasFile!, resolveAlias, declKeyOf, sourceName: 'publicAlias' });
            const defaultTargets = moduleExportTargets({ checker, sourceFile: aliasFile!, resolveAlias, declKeyOf, sourceName: 'default' });
            expect(aliasTargets).toHaveLength(1);
            expect(defaultTargets).toHaveLength(1);
            const callsByDeclaration = new Map<string | null, number>();
            const visitAliasCalls = (node: ts.Node): void => {
                if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && interests.has(node.expression.text)) {
                    const symbol = resolveAlias(checker.getSymbolAtLocation(node.expression)!);
                    const key = declKeyOf(symbol);
                    callsByDeclaration.set(key, (callsByDeclaration.get(key) ?? 0) + 1);
                }
                ts.forEachChild(node, visitAliasCalls);
            };
            visitAliasCalls(aliasFile!);
            expect(callsByDeclaration.get(aliasTargets[0].declarationKey)).toBe(1);
            expect(callsByDeclaration.get(defaultTargets[0].declarationKey)).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('transitive heritage', () => {
    test('walks class bases and interface implementations, not only the direct heritage clause', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'src/heritage.ts':
                    [
                        'export interface RootContract { root(): void }',
                        'export interface MidContract extends RootContract {}',
                        'export class RootBase { base(): void {} }',
                        'export class Middle extends RootBase implements MidContract { root(): void {} }',
                        'export class Leaf extends Middle {}'
                    ].join('\n') + '\n'
            });
            const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
            const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
            const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
            const checker = program.getTypeChecker();
            const resolveAlias = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
                let current = symbol;
                const seen = new Set<ts.Symbol>();
                while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
                    seen.add(current);
                    current = checker.getAliasedSymbol(current);
                }
                return current;
            };
            const heritageFile = program.getSourceFile(join(root, 'src/heritage.ts'));
            let leaf: ts.ClassDeclaration | null = null;
            const visit = (node: ts.Node): void => {
                if (ts.isClassDeclaration(node) && node.name?.text === 'Leaf') {
                    leaf = node;
                }
                ts.forEachChild(node, visit);
            };
            visit(heritageFile!);
            expect(leaf).not.toBeNull();
            const ancestors = collectHeritageDeclarations(checker, leaf!, resolveAlias);
            const ancestorNames = new Set(ancestors.map(({ declaration }) => declaration.name?.text));
            expect(ancestorNames.has('Middle')).toBe(true);
            expect(ancestorNames.has('RootBase')).toBe(true);
            expect(ancestorNames.has('MidContract')).toBe(true);
            expect(ancestorNames.has('RootContract')).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('classifyExportGroup', () => {
    test('G0 requires no value, type, heritage, re-export, string, or same-file signal', () => {
        expect(classifyExportGroup(emptyBucket(), 0, 0)).toBe('G0-noref');
    });

    test('same-file references are G1, not G0', () => {
        expect(classifyExportGroup(emptyBucket(), 1, 0)).toBe('G1-samefile');
    });

    test('external type-only references are G2', () => {
        expect(classifyExportGroup(emptyBucket({ type: { 'src/b.ts': 1 } }), 0, 0)).toBe('G2-typeonly');
    });

    test('test consumers without source/heritage/conduit use are G3', () => {
        expect(classifyExportGroup(emptyBucket({ test: { 'test/a.test.ts': 1 } }), 0, 0)).toBe('G3-testonly');
    });

    test('string-only mentions stay unresolved, not G0', () => {
        expect(classifyExportGroup(emptyBucket({ string: { 'src/a.ts [literal]': 1 } }), 0, 0)).toBe('GX-unresolved');
    });

    test('source value references are live', () => {
        expect(classifyExportGroup(emptyBucket({ src: { 'src/b.ts': 1 } }), 0, 0)).toBe('G5-live');
    });
});

function candidate(partial: Partial<CandidateRow> & Pick<CandidateRow, 'name' | 'file' | 'group'>): CandidateRow {
    return {
        line: 1,
        kind: 'const',
        publishedVia: null,
        nameCollision: false,
        abiKey: null,
        registration: false,
        heldByAbi: false,
        valueSrcFiles: 0,
        valueSrcRefs: 0,
        valueTestFiles: 0,
        valueTestRefs: 0,
        valueToolsFiles: 0,
        valueToolsRefs: 0,
        callsSrc: 0,
        callsTest: 0,
        callsTools: 0,
        sameFileValue: 0,
        sameFileType: 0,
        sameFileCalls: 0,
        nsFiles: [],
        typeExtFiles: 0,
        reexportFiles: 0,
        heritageFiles: 0,
        stringFiles: 0,
        files: { src: {}, test: {}, tools: {}, type: {}, heritage: {}, reexport: {}, string: {}, reflect: {}, ns: {} },
        starReexportedBy: [],
        ...partial
    };
}

describe('integrateCensus', () => {
    test('generates G0 and source-test-only counts from raw rows instead of freezing them', () => {
        const exportRows: ExportRow[] = [
            { file: 'src/a.ts', line: 1, kind: 'const', name: 'Dead', nameStart: 0, nameEnd: 4, publishedVia: null, nameCollision: false, abiKey: null, published: false },
            { file: 'src/b.ts', line: 1, kind: 'const', name: 'Helper', nameStart: 0, nameEnd: 6, publishedVia: null, nameCollision: false, abiKey: null, published: false },
            { file: 'src/c.ts', line: 1, kind: 'const', name: 'UsedInFile', nameStart: 0, nameEnd: 10, publishedVia: null, nameCollision: false, abiKey: null, published: false },
            { file: 'src/pub.ts', line: 1, kind: 'const', name: 'Published', nameStart: 0, nameEnd: 9, publishedVia: 'doc-held', nameCollision: false, abiKey: null, published: true }
        ];
        const candidates = [
            candidate({ name: 'Dead', file: 'src/a.ts', group: 'G0-noref' }),
            candidate({ name: 'Helper', file: 'src/b.ts', group: 'G3-testonly', valueTestFiles: 1, callsTest: 1, files: { src: {}, test: { 'test/b.test.ts': 1 }, tools: {}, type: {}, heritage: {}, reexport: {}, string: {}, reflect: {}, ns: {} } }),
            candidate({
                name: 'UsedInFile',
                file: 'src/c.ts',
                group: 'G3-testonly',
                sameFileValue: 2,
                valueTestFiles: 1,
                files: { src: {}, test: { 'test/c.test.ts': 1 }, tools: {}, type: {}, heritage: {}, reexport: {}, string: {}, reflect: {}, ns: {} }
            })
        ];
        const members: MemberOutRow[] = [];
        const integrated = integrateCensus({
            scope: {
                base: 'test',
                root: '/tmp/fixture',
                totalWalkedNonExcluded: 4,
                inScope: 4,
                byScope: { src: 4 },
                consumers: 0,
                consumersByScope: {},
                consumerFiles: [],
                pkgapiFiles: [],
                otherFiles: 0,
                excludedTops: [],
                note: 'fixture'
            },
            exportRows,
            candidates,
            members,
            conduits: { total: 250, resolved: 250, unresolved: 0, mappedRows: 439 }
        });
        expect(integrated.exports.zero).toHaveLength(1);
        expect(integrated.exports.zero[0].name).toBe('Dead');
        expect(integrated.exports.sourceTestOnlyCount).toBe(1);
        expect(integrated.exports.sourceTestOnly[0].name).toBe('Helper');
        expect(integrated.exports.sourceTestOnlyDirectlyCalled).toBe(1);
        expect(integrated.exports.testExternalBucketWithSameFileProductionUses).toBe(1);
        expect(integrated.exports.protected).toBe(1);
        expect(integrated.conduits).toEqual({ total: 250, resolved: 250, unresolved: 0, mappedRows: 439 });
    });
});

describe('runExportCensus fixtures', () => {
    test('same-file use is G1, this-calls are not G0, structural/union/dispatch/doc-held holds apply, conduits resolve', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'src/plain.ts': 'export const Plain = 1;\n',
                'src/esm.mts': 'export const ESM = 2;\n',
                'src/common.cts': 'export const Common = 3;\n',
                'src/renamed.ts': "export { Plain as Renamed } from './plain.js';\n",
                'src/star.ts': "export * from './renamed.js';\nexport * from './esm.mjs';\nexport * from '#/common.cjs';\n",
                'src/solo.ts': 'export const Solo = 1;\nconst x = Solo + 1;\nexport { x as soloAlias };\n',
                'src/zero.ts': 'export const NeverReferenced = 1;\n',
                'src/bot/api/puzzle.ts': ['export const PuzzleBox = {', '    open(): void {}', '    close(): void { this.open(); }', '};', ''].join('\n'),
                'src/bot/api/quest.ts': [
                    'export interface QuestModule { record(): void; bank(): void; decide(): void; readProgress(): void }',
                    'export const chompy: QuestModule = {',
                    '    record() {},',
                    '    bank() {},',
                    '    decide() {},',
                    '    readProgress() {}',
                    '};',
                    ''
                ].join('\n'),
                'src/bot/api/tiles.ts': ['export interface WorldTile { x: number; z: number; level: number }', 'export const origin: WorldTile = { x: 0, z: 0, level: 0 };', ''].join('\n'),
                'src/bot/api/duel.ts': ['export class MageTick { tick(): void {} }', 'export class MeleeTick { tick(): void {} }', 'export function drive(unit: MageTick | MeleeTick): void { unit.tick(); }', ''].join('\n'),
                'src/bot/api/task.ts': [
                    'export interface Task { validate(): boolean; execute(): void }',
                    'export class Helper implements Task {',
                    '    validate(): boolean { return true }',
                    '    execute(): void {}',
                    '}',
                    'export function add(task: Task): void { task.validate(); task.execute(); }',
                    ''
                ].join('\n'),
                'src/bot/paint/Paint.ts': ['export const Paint = { begin(): { end(): void } { return { end() {} }; } };', 'export const PaintFrame = { end(): void {} };', ''].join('\n'),
                'src/ns-user.ts': "import * as star from './star.js';\nexport const renamed = star.Renamed;\n",
                'test/helper.test.ts': "import { NeverReferenced as _n } from '../src/zero.js';\nvoid _n;\nexport const onlyInTest = 1;\n"
            });
            const result = runExportCensus({ root, revision: 'fixture', writeArtifacts: false });
            expect(result.conduits.unresolved).toBe(0);
            expect(result.conduits.total).toBeGreaterThan(0);
            expect(result.conduits.resolved).toBe(result.conduits.total);

            const byName = (name: string, file?: string): CandidateRow | undefined => result.candidates.find(r => r.name === name && (!file || r.file === file));
            expect(byName('Solo')?.group).toBe('G1-samefile');
            expect(byName('NeverReferenced')?.group).toBe('G3-testonly');
            expect(byName('NeverReferenced')?.sameFileValue).toBe(0);
            expect(result.integrated.exports.sourceTestOnly.some(r => r.name === 'NeverReferenced')).toBe(true);

            const open = result.members.find(m => m.owner === 'PuzzleBox' && m.member === 'open');
            expect(open).toBeDefined();
            expect(open!.group).not.toBe('G0-noref');
            expect((open!.sameFileValue ?? 0) + open!.valueSrcFiles).toBeGreaterThan(0);

            const record = result.members.find(m => m.owner === 'chompy' && m.member === 'record');
            expect(record).toBeDefined();
            expect(record!.group).toBe('GX-structural');

            const mageTick = result.members.find(m => m.owner === 'MageTick' && m.member === 'tick');
            const meleeTick = result.members.find(m => m.owner === 'MeleeTick' && m.member === 'tick');
            expect(mageTick).toBeDefined();
            expect(meleeTick).toBeDefined();
            expect(mageTick!.group).not.toBe('G0-noref');
            expect(meleeTick!.group).not.toBe('G0-noref');

            const validate = result.members.find(m => m.owner === 'Helper' && m.member === 'validate');
            expect(validate).toBeDefined();
            expect(validate!.status === 'retained-dispatch' || validate!.group !== 'G0-noref').toBe(true);

            const paint = result.exportRows.find(r => r.name === 'Paint' && r.file === 'src/bot/paint/Paint.ts');
            expect(paint?.publishedVia).toBe('doc-held');
            expect(paint?.published).toBe(true);

            const nsUse = byName('Plain');
            expect(nsUse).toBeDefined();
            expect(nsUse!.group).toBe('G5-live');
            expect(nsUse!.nsFiles).toContain('src/ns-user.ts');
            expect(nsUse!.valueSrcFiles).toBeGreaterThan(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('extra-root members are publication-held; npm barrel members are published', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'packages/rs2b0t-api/index.js': 'export const {\n    PackageRoot\n} = abi;\n',
                'packages/rs2b0t-api/index.d.ts': 'export class PackageRoot {\n    declared(): void;\n}\n',
                'src/bot/api/pkg.ts': 'export class PackageRoot {\n    declared(): void {}\n    unusedInternal(): void {}\n}\n',
                'src/extra.ts': 'export class ExtraRoot {\n    installedMethod(): void {}\n}\n',
                'src/bot/event/webwalk/essenceSession.ts': 'export const EssenceSession = {\n    noteEntry(): void {}\n    _resetForTests(): void {}\n};\n',
                'src/bot/runtime/abi.ts': [
                    "import { ExtraRoot } from '../../extra.js';",
                    "import { PackageRoot } from '../api/pkg.js';",
                    "import { EssenceSession } from '../event/webwalk/essenceSession.js';",
                    'export const abi = Object.freeze({ ExtraRoot, PackageRoot, EssenceSession });',
                    ''
                ].join('\n'),
                'test/essence.test.ts': "import { EssenceSession } from '../src/bot/event/webwalk/essenceSession.js';\nEssenceSession.noteEntry();\n"
            });
            const result = runExportCensus({ root, revision: 'fixture', writeArtifacts: false });

            const extra = result.members.find(m => m.owner === 'ExtraRoot' && m.member === 'installedMethod');
            expect(extra).toBeDefined();
            expect(extra!.status).toBe('publication-held');
            expect(extra!.group).toBe('publication-held');
            expect(extra!.via).toBe('abi-installed');
            expect(result.integrated.members.zeroLeaves.some(row => row.owner === 'ExtraRoot' && row.member === 'installedMethod')).toBe(false);

            const note = result.members.find(m => m.owner === 'EssenceSession' && m.member === 'noteEntry');
            expect(note).toBeDefined();
            expect(note!.status).toBe('publication-held');
            expect(result.integrated.members.testOnlyObserved.some(row => row.owner === 'EssenceSession' && row.member === 'noteEntry')).toBe(false);

            const reset = result.members.find(m => m.owner === 'EssenceSession' && m.member === '_resetForTests');
            expect(reset).toBeDefined();
            expect(reset!.status).toBe('candidate');

            const unused = result.members.find(m => m.owner === 'PackageRoot' && m.member === 'unusedInternal');
            expect(unused).toBeDefined();
            expect(unused!.status).toBe('candidate');
            expect(unused!.group).toBe('G0-noref');

            const declared = result.members.find(m => m.owner === 'PackageRoot' && m.member === 'declared');
            expect(declared?.status).toBe('published');
            expect(declared?.group).toBe('published');
            expect(result.integrated.members.published).toBeGreaterThanOrEqual(1);
            expect(result.integrated.members.publicationHeld).toBeGreaterThanOrEqual(2);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('renamed namespace property calls attribute the declaration owner', () => {
        const root = fixtureRoot();
        try {
            writeTree(root, {
                'tsconfig.json': fixtureTsconfig,
                'src/plain.ts': 'export function plainLeaf() { return 11; }\n',
                'src/renamed.ts': "export { plainLeaf as renamedLeaf } from './plain.js';\n",
                'src/barrel.ts': "export * from './renamed.js';\nexport * as nsAlias from './renamed.js';\n",
                'src/consumer.ts': "import * as bridge from './barrel.js';\nimport { nsAlias } from './barrel.js';\nbridge.renamedLeaf();\nnsAlias.renamedLeaf();\n"
            });
            const result = runExportCensus({ root, revision: 'fixture', writeArtifacts: false });
            const leaf = result.candidates.find(row => row.name === 'plainLeaf' && row.file === 'src/plain.ts');
            expect(leaf).toBeDefined();
            expect(leaf!.group).toBe('G5-live');
            expect(leaf!.callsSrc).toBe(2);
            expect(leaf!.nsFiles).toContain('src/consumer.ts');
            expect(leaf!.valueSrcFiles).toBeGreaterThan(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('parseAuditArgs', () => {
    test('defaults the output directory under the chosen root', () => {
        const parsed = parseAuditArgs(['--root', '/tmp/tree'], '/tmp');
        expect(parsed.root).toBe('/tmp/tree');
        expect(parsed.out).toBe('/tmp/tree/out/audit-exports');
    });
});
