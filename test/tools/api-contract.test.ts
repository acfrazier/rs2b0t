import { describe, expect, test } from 'bun:test';
import { EXTRA_ROOT_HOLDS, PAINT_FRAME_WIDGET_HOLDS, READER_METHOD_HOLDS, TYPE_ONLY_HOLDS, allowlist, compare, declaredSurface, packageExports, publicationDrifts, report, repoSources, runtimeSurface } from '../../tools/api-contract.js';
import type { Member, PublicationSources, Surface } from '../../tools/api-contract.js';

function members(names: string[], optional: string[] = []): Map<string, Member> {
    return new Map(names.map(n => [n, { type: 'x', optional: optional.includes(n) }]));
}

function fileOf(sources: PublicationSources, path: string): string {
    const text = sources.files[path];
    if (text === undefined) {
        throw new Error(`missing fixture ${path}`);
    }
    return text;
}

function pinFiles(): Record<string, string> {
    const partner = ['parsePartnerList', 'isConfiguredPartner', 'decideReceiverOfferScreen', 'decideGiverOfferScreen', 'parseMuleMode', 'muleGathererHandoffActive', 'muleReceiverActive', 'muleCookerActive', 'muleSupplierActive', 'namesMatch'];
    const locFns = ['locPlacementKey', 'locRefFromTransport', 'locRefFromDoor', 'matchesLocRef', 'probeLocRef', 'locRefValid', 'locRefStale'];
    return {
        'src/bot/paint/Paint.ts': ['export const Paint = { begin() {}, extraRuntime() {} };', 'export class PaintFrame {', ...PAINT_FRAME_WIDGET_HOLDS.map(name => `    ${name}() {}`), '    rowsLeft() {}', '}'].join('\n'),
        'src/bot/paint/paintLogic.ts': 'export const paintState = { clicks: 0 };',
        'src/bot/runtime/RunManager.ts': 'class RunManagerImpl { override() {} extra() {} }\nexport const RunManager = new RunManagerImpl();',
        'src/bot/api/prayer/Prayer.ts': 'export const Prayer = { points() {}, max() {}, full() {}, known() {}, available() {}, active() {}, set() {}, clear() {}, secret() {} };',
        'src/bot/event/webwalk/essenceSession.ts': 'export const EssenceSession = { noteEntry() {}, noteEntryFromNpc() {}, _resetForTests() {} };',
        'src/bot/runtime/buildInfo.ts': 'export const BUILD_INFO = { commit: "x" };',
        'src/bot/api/altar/Altars.ts': 'export async function nearestAltar() { return null; }',
        'src/bot/geometry/Area.ts': 'export abstract class Area {\n    static rectangular() { return null; }\n    static circular() { return null; }\n}',
        'src/bot/api/trade/PartnerTrade.ts': partner.map(name => `export function ${name}() {}`).join('\n'),
        'src/bot/data/cookingRanges.ts': [
            'export const COOKING_RANGE_LOCS = [];',
            'export const FISH_CAMP_COOK_PLANS = {};',
            'export function nearestCookingRange() {}',
            'export function cookSurfaceForFishCamp() {}',
            'export function resolveFishCampCookSurface() {}',
            'export function chebyshev() {}'
        ].join('\n'),
        'src/bot/event/webwalk/locRef.ts': ['export interface LocRef { x: number; }', 'export interface LocSceneSnap { id: number; }', ...locFns.map(name => `export function ${name}() {}`)].join('\n')
    };
}

function pinSources(): PublicationSources {
    return {
        dts: [
            ...TYPE_ONLY_HOLDS.map(name => `export interface ${name} { $: 1; }`),
            'export const Game: {',
            '    setCombatStyle(style: MeleeCombatStyle): boolean;',
            '    setCombatStyle(mode: number): boolean;',
            '};',
            'export abstract class TaskBot {',
            '    protected add(...tasks: Task[]): void;',
            '}'
        ].join('\n'),
        abi: `const abi = Object.freeze({\n    ${EXTRA_ROOT_HOLDS.join(',\n    ')},\n    SecretRoot,\n});`,
        reader: `export const reader = {\n    ${READER_METHOD_HOLDS.map(name => `${name}() { return 0; }`).join(',\n    ')},\n    extraReader() { return 1; }\n};`,
        files: pinFiles()
    };
}

describe('compare', () => {
    test('flags runtime members the declaration lacks, with the runtime type', () => {
        const runtime: Surface = new Map([
            [
                'Game',
                new Map([
                    ['ingame', { type: '() => boolean', optional: false }],
                    ['sceneReady', { type: '() => boolean', optional: false }]
                ])
            ]
        ]);
        const declared: Surface = new Map([['Game', members(['ingame'])]]);
        expect(compare(runtime, declared, ['Game'])).toEqual([{ kind: 'undeclared-member', export: 'Game', member: 'sceneReady', signature: '() => boolean' }]);
    });

    test('flags declared members the runtime lacks unless the declaration marks them optional', () => {
        const runtime: Surface = new Map([['Bank', members(['open'])]]);
        const declared: Surface = new Map([['Bank', members(['open', 'gone', 'maybe'], ['maybe'])]]);
        expect(compare(runtime, declared, ['Bank'])).toEqual([{ kind: 'phantom-member', export: 'Bank', member: 'gone' }]);
    });

    test('flags an index.js name that one side lacks', () => {
        const runtime: Surface = new Map([['Game', members(['ingame'])]]);
        const declared: Surface = new Map([['Tile', members(['x'])]]);
        expect(compare(runtime, declared, ['Game', 'Tile'])).toEqual([
            { kind: 'undeclared-export', export: 'Game' },
            { kind: 'missing-at-runtime', export: 'Tile' }
        ]);
    });

    test('flags a declared value export index.js does not re-export', () => {
        const runtime: Surface = new Map([
            ['Game', members(['ingame'])],
            ['NAV', null]
        ]);
        const declared: Surface = new Map([
            ['Game', members(['ingame'])],
            ['NAV', null]
        ]);
        expect(compare(runtime, declared, ['Game'])).toEqual([{ kind: 'phantom-export', export: 'NAV' }]);
    });

    test('memberless exports compare by presence only', () => {
        const runtime: Surface = new Map([
            ['held', null],
            ['apiVersion', null]
        ]);
        const declared: Surface = new Map([
            ['held', null],
            ['apiVersion', null]
        ]);
        expect(compare(runtime, declared, ['held', 'apiVersion'])).toEqual([]);
    });

    test('the allowlist silences the drifts it names', () => {
        const runtime: Surface = new Map([['Game', members(['ingame', 'secret'])]]);
        const declared: Surface = new Map([
            ['Game', members(['ingame'])],
            ['Extra', null]
        ]);
        expect(compare(runtime, declared, ['Game'], new Set(['Game.secret', 'Extra']))).toEqual([]);
    });
});

test('packageExports reads the destructured names and drops comments', () => {
    expect(packageExports('export const {\n    apiVersion,\n    // Tools\n    Game, Tile\n} = abi;')).toEqual(['apiVersion', 'Game', 'Tile']);
});

test('report is one line per drift', () => {
    const text = report([
        { kind: 'undeclared-member', export: 'Game', member: 'sceneReady', signature: '() => boolean' },
        { kind: 'phantom-export', export: 'NAV' }
    ]);
    expect(text).toBe('api-contract: 2 drift(s)\n  undeclared-member   Game.sceneReady: () => boolean\n  phantom-export      NAV');
    expect(report([])).toBe('api-contract: published ledger holds, and index.d.ts matches the runtime ABI over every index.js export');
});

test('index.d.ts matches the runtime ABI over every index.js export', () => {
    const drifts = compare(runtimeSurface(), declaredSurface(), packageExports(), allowlist());
    expect(report(drifts)).toBe('api-contract: published ledger holds, and index.d.ts matches the runtime ABI over every index.js export');
}, 120_000);

test('the same-pin ledger still holds on this checkout', () => {
    expect(publicationDrifts(repoSources())).toEqual([]);
});

describe('publication ledger fixtures', () => {
    test('the same-pin fixture holds, including extra undocumented members', () => {
        expect(publicationDrifts(pinSources())).toEqual([]);
    });

    test('fails when the protected TaskBot.add hook is absent', () => {
        const sources = pinSources();
        sources.dts = sources.dts.replace('    protected add(...tasks: Task[]): void;\n', '');
        expect(publicationDrifts(sources)).toEqual([{ kind: 'missing-protected-hook', export: 'TaskBot', member: 'add', signature: 'add(...tasks: Task[]): void' }]);
    });

    test('fails when TaskBot.add is public instead of protected', () => {
        const sources = pinSources();
        sources.dts = sources.dts.replace('protected add(...tasks: Task[]): void;', 'add(...tasks: Task[]): void;');
        expect(publicationDrifts(sources)).toEqual([{ kind: 'missing-protected-hook', export: 'TaskBot', member: 'add', signature: 'add(...tasks: Task[]): void' }]);
    });

    test('fails when a Game.setCombatStyle overload is dropped', () => {
        const sources = pinSources();
        sources.dts = sources.dts.replace('    setCombatStyle(mode: number): boolean;\n', '');
        expect(publicationDrifts(sources)).toEqual([{ kind: 'missing-overload', export: 'Game', member: 'setCombatStyle', signature: 'setCombatStyle(mode: number): boolean' }]);
    });

    test('fails when a type-only declaration disappears', () => {
        const sources = pinSources();
        sources.dts = sources.dts.replace('export interface WorldTile { $: 1; }\n', '');
        expect(publicationDrifts(sources)).toEqual([{ kind: 'missing-type-only', export: 'WorldTile' }]);
    });

    test('fails when any extra __rs2b0t root disappears', () => {
        for (const name of EXTRA_ROOT_HOLDS) {
            const sources = pinSources();
            sources.abi = sources.abi.replace(`    ${name},\n`, '');
            expect(publicationDrifts(sources)).toEqual([{ kind: 'missing-extra-root', export: name }]);
        }
    });

    test('fails when a concrete reader method disappears', () => {
        const sources = pinSources();
        sources.reader = sources.reader.replace('    varp() { return 0; },\n', '');
        expect(publicationDrifts(sources)).toEqual([{ kind: 'missing-reader-method', export: 'reader', member: 'varp' }]);
    });

    test('fails when a docs-held surface disappears', () => {
        const cases: Array<{ file: string; cut: string; export: string; member?: string }> = [
            { file: 'src/bot/paint/Paint.ts', cut: 'begin() {}, ', export: 'Paint', member: 'begin' },
            { file: 'src/bot/paint/Paint.ts', cut: '    end() {}\n', export: 'PaintFrame', member: 'end' },
            { file: 'src/bot/paint/paintLogic.ts', cut: 'export const paintState = { clicks: 0 };', export: 'paintState' },
            { file: 'src/bot/runtime/RunManager.ts', cut: 'override() {} ', export: 'RunManager', member: 'override' },
            { file: 'src/bot/api/prayer/Prayer.ts', cut: 'points() {}, ', export: 'Prayer', member: 'points' },
            { file: 'src/bot/event/webwalk/essenceSession.ts', cut: 'noteEntryFromNpc() {}, ', export: 'EssenceSession', member: 'noteEntryFromNpc' },
            { file: 'src/bot/runtime/buildInfo.ts', cut: 'export const BUILD_INFO = { commit: "x" };', export: 'BUILD_INFO' },
            { file: 'src/bot/api/altar/Altars.ts', cut: 'export async function nearestAltar() { return null; }', export: 'nearestAltar' },
            { file: 'src/bot/geometry/Area.ts', cut: '    static rectangular() { return null; }\n', export: 'Area', member: 'rectangular' },
            { file: 'src/bot/api/trade/PartnerTrade.ts', cut: 'export function parsePartnerList() {}\n', export: 'parsePartnerList' },
            { file: 'src/bot/data/cookingRanges.ts', cut: 'export const COOKING_RANGE_LOCS = [];\n', export: 'COOKING_RANGE_LOCS' },
            { file: 'src/bot/event/webwalk/locRef.ts', cut: 'export function locRefStale() {}', export: 'locRefStale' },
            { file: 'src/bot/event/webwalk/locRef.ts', cut: 'export function locRefFromDoor() {}\n', export: 'locRefFromDoor' }
        ];
        for (const c of cases) {
            const sources = pinSources();
            sources.files = { ...sources.files, [c.file]: fileOf(sources, c.file).replace(c.cut, '') };
            expect(publicationDrifts(sources)).toEqual([c.member ? { kind: 'missing-docs-held', export: c.export, member: c.member } : { kind: 'missing-docs-held', export: c.export }]);
        }
    });
});
