import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { collectHeritageDeclarations, createConduitResolver, exportInterestNames, moduleExportTargets, repoPath, type ModuleExportTarget } from './exportCensusCore.js';

export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'coverage', '.turbo']);
export const EXCLUDED_TOPS = ['docs', 'public-bot', 'desktop', 'data', 'docs/script-template'];
export const REG_FILES = new Set(['src/bot/runtime/loader.ts', 'src/bot/runtime/ScriptRegistry.ts', 'src/bot/runtime/defineBot.ts', 'src/bot/runtime/ScriptRunner.ts', 'bundle.ts', 'bot.bundle.ts', 'identifier.js']);

export interface DocHeldExport {
    name: string;
    file: string;
    why: string;
}

export interface DocHeldMember {
    owner: string;
    member: string;
    file: string;
    exportFile: string;
    why: string;
}

export interface DispatchPin {
    owner: string;
    member: string;
    file: string;
    why: string;
}

export const DOC_HELD: DocHeldExport[] = [
    { name: 'Prayer', file: 'src/bot/api/prayer/Prayer.ts', why: 'docs API skills:22-29, eight documented methods' },
    { name: 'EssenceSession', file: 'src/bot/event/webwalk/essenceSession.ts', why: 'docs/reference/api-movement.md:85-86' },
    { name: 'nearestAltar', file: 'src/bot/api/altar/Altars.ts', why: 'docs-promoted API skills:32' },
    { name: 'BUILD_INFO', file: 'src/bot/runtime/buildInfo.ts', why: 'docs/how-to/maintainer-infra.md:73 documents __rs2b0t.BUILD_INFO' },
    ...['Paint', 'PaintFrame'].map(name => ({
        name,
        file: 'src/bot/paint/Paint.ts',
        why: 'docs/API.md:15 links docs/reference/api-paint.md; Paint.begin and PaintFrame are documented there'
    })),
    { name: 'paintState', file: 'src/bot/paint/paintLogic.ts', why: 'docs/API.md:15 links docs/reference/api-paint.md:5-7, which names paintState' },
    { name: 'RunManager', file: 'src/bot/runtime/RunManager.ts', why: 'docs/API.md:16 links docs/reference/api-game.md:13-14, which documents RunManager.override' },
    ...['parsePartnerList', 'isConfiguredPartner', 'decideReceiverOfferScreen', 'decideGiverOfferScreen', 'parseMuleMode', 'muleGathererHandoffActive', 'muleReceiverActive', 'muleCookerActive', 'muleSupplierActive'].map(name => ({
        name,
        file: 'src/bot/api/trade/PartnerTrade.ts',
        why: 'docs/API.md:21 links docs/reference/api-dialogue.md:60-80; the named helper is listed there'
    })),
    ...['COOKING_RANGE_LOCS', 'nearestCookingRange', 'cookSurfaceForFishCamp', 'resolveFishCampCookSurface', 'FISH_CAMP_COOK_PLANS'].map(name => ({
        name,
        file: 'src/bot/data/cookingRanges.ts',
        why: 'docs/API.md:21 links docs/reference/api-dialogue.md:82-92; the named catalog entry is listed there'
    })),
    ...['LocRef', 'locPlacementKey', 'locRefFromTransport', 'locRefFromDoor', 'matchesLocRef', 'LocSceneSnap', 'probeLocRef', 'locRefValid', 'locRefStale'].map(name => ({
        name,
        file: 'src/bot/event/webwalk/locRef.ts',
        why: 'docs/API.md:22 links docs/reference/api-movement.md:88-90, documenting the locRef surface'
    }))
];

export const DOCS_HOLD_MEMBERS: DocHeldMember[] = [
    { owner: 'SettingsStore', member: 'globalBag', file: 'src/bot/runtime/Settings.ts', exportFile: 'src/bot/runtime/Settings.ts', why: 'docs/e2e/desktop-instances/README.md:24 measures SettingsStore.globalBag() per frame' },
    { owner: 'Area', member: 'rectangular', file: 'src/bot/geometry/Area.ts', exportFile: 'src/bot/geometry/Area.ts', why: 'docs/reference/api-game.md:117-119 documents Area.rectangular' },
    { owner: 'Area', member: 'circular', file: 'src/bot/geometry/Area.ts', exportFile: 'src/bot/geometry/Area.ts', why: 'docs/reference/api-game.md:117-119 documents Area.circular' },
    { owner: 'Paint', member: 'begin', file: 'src/bot/paint/Paint.ts', exportFile: 'src/bot/paint/Paint.ts', why: 'docs/reference/api-paint.md:10-16 documents Paint.begin' },
    ...['title', 'tabs', 'text', 'row', 'cells', 'wrap', 'list', 'fill', 'grid', 'bar', 'buttons', 'select', 'stepper', 'gap', 'cols', 'end'].map(member => ({
        owner: 'PaintFrame',
        member,
        file: 'src/bot/paint/Paint.ts',
        exportFile: 'src/bot/paint/Paint.ts',
        why: 'docs/reference/api-paint.md:10-40 documents PaintFrame.' + member
    })),
    { owner: 'RunManager', member: 'override', file: 'src/bot/runtime/RunManager.ts', exportFile: 'src/bot/runtime/RunManager.ts', why: 'docs/reference/api-game.md:13-14 documents RunManager.override' }
];

export const DISPATCH_PINNED: DispatchPin[] = [
    {
        owner: 'ClueDuelHelper',
        member: 'validate',
        file: 'src/bot/api/duel/ClueDuel.ts',
        why: 'structural Task: DuelArena.ts:122 passes helper to TaskBot.add(...tasks: Task[]), engine dispatches task.validate() (Bot.ts:152)'
    },
    {
        owner: 'ClueDuelHelper',
        member: 'execute',
        file: 'src/bot/api/duel/ClueDuel.ts',
        why: 'same structural Task registration dispatches task.execute(); test references do not make this method test-only'
    }
];

export type ExportGroup = 'G0-noref' | 'G1-samefile' | 'G2-typeonly' | 'G3-testonly' | 'G4-toolsonly' | 'G34-testtools' | 'G5-live' | 'GX-unresolved' | 'GX-dynamic' | 'GX-structural';

export interface RefBucket {
    src: Record<string, number>;
    test: Record<string, number>;
    tools: Record<string, number>;
    sameV: number;
    sameT: number;
    sameCalls: number;
    type: Record<string, number>;
    heritage: Record<string, number>;
    reexport: Record<string, number>;
    string: Record<string, number>;
    reflect: Record<string, number>;
    calls: { src: number; test: number; tools: number };
    nsf: Record<string, number>;
}

export function newRefBucket(): RefBucket {
    return {
        src: {},
        test: {},
        tools: {},
        sameV: 0,
        sameT: 0,
        sameCalls: 0,
        type: {},
        heritage: {},
        reexport: {},
        string: {},
        reflect: {},
        calls: { src: 0, test: 0, tools: 0 },
        nsf: {}
    };
}

/** Corrected export/member grouping. Same-file references are not production reachability. */
export function classifyExportGroup(b: RefBucket, sameV: number, sameT: number): ExportGroup {
    const nSrc = Object.keys(b.src).length;
    const nTest = Object.keys(b.test).length;
    const nTools = Object.keys(b.tools).length;
    const nType = Object.keys(b.type).length;
    const nHer = Object.keys(b.heritage ?? {}).length;
    const nRe = Object.keys(b.reexport ?? {}).length;
    const nStr = Object.keys(b.string ?? {}).length;
    if (nStr > 0 && nSrc + nTest + nTools + nRe + nHer === 0) {
        return 'GX-unresolved';
    }
    if (nSrc + nTest + nTools + nRe + nHer === 0 && sameV + sameT === 0 && nType === 0) {
        return 'G0-noref';
    }
    if (nSrc + nTest + nTools + nRe + nHer === 0 && nType === 0) {
        return 'G1-samefile';
    }
    if (nSrc + nTest + nTools + nRe + nHer === 0) {
        return 'G2-typeonly';
    }
    if (nSrc === 0 && nRe === 0 && nHer === 0 && nTest > 0 && nTools === 0) {
        return 'G3-testonly';
    }
    if (nSrc === 0 && nRe === 0 && nHer === 0 && nTools > 0 && nTest === 0) {
        return 'G4-toolsonly';
    }
    if (nSrc === 0 && nRe === 0 && nHer === 0) {
        return 'G34-testtools';
    }
    return 'G5-live';
}

export type ScopeKind = 'src' | 'test' | 'e2e' | 'tools' | 'root' | 'pkgapi' | 'other';

export function scopeOf(r: string): ScopeKind {
    if (r === 'bundle.ts' || r === 'bot.bundle.ts' || r === 'eslint.config.ts' || r === 'identifier.js') {
        return 'root';
    }
    if (r.startsWith('src/')) {
        return 'src';
    }
    if (r.startsWith('test/')) {
        return 'test';
    }
    if (r.startsWith('e2e/')) {
        return 'e2e';
    }
    if (r.startsWith('tools/')) {
        return 'tools';
    }
    if (r.startsWith('packages/rs2b0t-api/')) {
        return 'pkgapi';
    }
    return 'other';
}

export function isSourceFileName(r: string): boolean {
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(r) && !r.endsWith('.d.ts');
}

export function isTestFileName(r: string): boolean {
    return scopeOf(r) === 'test' || scopeOf(r) === 'e2e' || /(^|\/)[^/]*\.test\.ts$/.test(r);
}

export interface ExportRow {
    file: string;
    line: number;
    kind: string;
    name: string;
    nameStart: number;
    nameEnd: number;
    isDefault?: boolean;
    local?: string;
    publishedVia: string | null;
    nameCollision: boolean;
    abiKey: string | null;
    published: boolean;
}

export interface CandidateRow {
    name: string;
    file: string;
    line: number;
    kind: string;
    publishedVia: string | null;
    nameCollision: boolean;
    abiKey: string | null;
    group: ExportGroup;
    registration: boolean;
    heldByAbi: boolean;
    valueSrcFiles: number;
    valueSrcRefs: number;
    valueTestFiles: number;
    valueTestRefs: number;
    valueToolsFiles: number;
    valueToolsRefs: number;
    callsSrc: number;
    callsTest: number;
    callsTools: number;
    sameFileValue: number;
    sameFileType: number;
    sameFileCalls: number;
    nsFiles: string[];
    typeExtFiles: number;
    reexportFiles: number;
    heritageFiles: number;
    stringFiles: number;
    files: {
        src: Record<string, number>;
        test: Record<string, number>;
        tools: Record<string, number>;
        type: Record<string, number>;
        heritage: Record<string, number>;
        reexport: Record<string, number>;
        string: Record<string, number>;
        reflect: Record<string, number>;
        ns: Record<string, number>;
    };
    starReexportedBy: string[];
}

export interface MemberOutRow {
    owner: string;
    member: string;
    file: string;
    line: number;
    mkind: string;
    static: boolean;
    prot: boolean;
    via: string;
    exportFile: string;
    cls: string | null;
    okind: string | null;
    structuralWhy: string | null;
    ownerXrefs: number;
    status: string;
    group: string;
    retainedWhy: string | null;
    docsHold: string | null;
    valueSrcFiles: number;
    valueSrcRefs: number;
    valueTestFiles: number;
    valueTestRefs: number;
    valueToolsFiles: number;
    valueToolsRefs: number;
    callsSrc: number;
    callsTest: number;
    callsTools: number;
    sameFileValue: number;
    sameFileType: number;
    sameFileCalls: number;
    nsFiles: string[];
    typeExtFiles: number;
    stringFiles: number;
    dynOwner: boolean;
    files: {
        src: Record<string, number>;
        test: Record<string, number>;
        tools: Record<string, number>;
        type: Record<string, number>;
        heritage: Record<string, number>;
        string: Record<string, number>;
        reflect: Record<string, number>;
    };
}

export interface ConduitRecord {
    file: string;
    line: number;
    kind: string;
    name?: string;
    as?: string;
    source: string;
    target: string | null;
    resolved: boolean;
    exports: Array<{ exportName: string; declarationKey: string | null; ownerFile: string | null }>;
    mappedRows: Array<{ name: string; file: string; kind: string }>;
}

export interface ConduitsJson {
    total: number;
    resolved: number;
    unresolved: number;
    mappedRows: number;
    records: ConduitRecord[];
}

export interface ScopeJson {
    base: string;
    root: string;
    totalWalkedNonExcluded: number;
    inScope: number;
    byScope: Record<string, number>;
    consumers: number;
    consumersByScope: Record<string, number>;
    consumerFiles: string[];
    pkgapiFiles: string[];
    otherFiles: number;
    excludedTops: string[];
    note: string;
}

export interface IntegratedJson {
    base: string;
    snapshot: string;
    scope: ScopeJson;
    method: string;
    exports: {
        total: number;
        protected: number;
        candidates: number;
        rawExternalConsumerGroups: Record<string, number>;
        zero: CandidateRow[];
        sameFileOnly: number;
        sourceTestOnly: CandidateRow[];
        sourceTestOnlyCount: number;
        sourceTestOnlyDirectlyCalled: number;
        testExternalBucketWithSameFileProductionUses: number;
    };
    members: {
        total: number;
        groups: Record<string, number>;
        zeroLeaves: Array<{ owner: string; member: string; file: string; line: number; okind: string | null; ownerXrefs: number }>;
        docHeldZero: MemberOutRow[];
        privateCandidates: MemberOutRow[];
        testOnlyObserved: MemberOutRow[];
        testExternalBucketWithSameFileProductionUses: number;
    };
    conduits: {
        total: number;
        resolved: number;
        unresolved: number;
        mappedRows: number;
    };
    limits: string[];
}

function countBy(values: readonly string[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

/** Generate integrated.json from raw census rows. Never freeze a prior count. */
export function integrateCensus(input: {
    scope: ScopeJson;
    exportRows: readonly ExportRow[];
    candidates: readonly CandidateRow[];
    members: readonly MemberOutRow[];
    conduits: Pick<ConduitsJson, 'total' | 'resolved' | 'unresolved' | 'mappedRows'>;
}): IntegratedJson {
    const publishedRows = input.exportRows.filter(row => row.published);
    const sourceTestCandidates = input.candidates.filter(row => row.file.startsWith('src/') && row.group === 'G3-testonly');
    const sourceTestOnly = sourceTestCandidates.filter(row => row.sameFileValue === 0);
    const testOnlyMembers = input.members.filter(row => row.status === 'candidate' && row.group === 'G3-testonly');
    if (input.exportRows.length !== input.candidates.length + publishedRows.length) {
        throw new Error(`export/candidate partition mismatch: ${input.exportRows.length} != ${input.candidates.length} + ${publishedRows.length}`);
    }
    return {
        base: input.scope.base,
        snapshot: input.scope.root,
        scope: input.scope,
        method: 'Generated from the final raw census outputs. Compiler-option-aware module resolution maps named, star, and namespace re-exports to checker-resolved source declarations; aliases/default identifiers and transitive heritage are included. Publication and structural/documentation holds remain conservative.',
        exports: {
            total: input.exportRows.length,
            protected: publishedRows.length,
            candidates: input.candidates.length,
            rawExternalConsumerGroups: countBy(input.candidates.map(row => row.group)),
            zero: input.candidates.filter(row => row.group === 'G0-noref'),
            sameFileOnly: input.candidates.filter(row => row.group === 'G1-samefile').length,
            sourceTestOnly,
            sourceTestOnlyCount: sourceTestOnly.length,
            sourceTestOnlyDirectlyCalled: sourceTestOnly.filter(row => row.callsTest > 0).length,
            testExternalBucketWithSameFileProductionUses: sourceTestCandidates.filter(row => row.sameFileValue > 0).length
        },
        members: {
            total: input.members.length,
            groups: countBy(input.members.map(row => row.group)),
            zeroLeaves: input.members
                .filter(row => row.status === 'candidate' && ['method', 'accessor'].includes(row.mkind) && row.group === 'G0-noref' && ['class', 'instance'].includes(row.okind ?? '') && !row.docsHold)
                .map(({ owner, member, file, line, okind, ownerXrefs }) => ({ owner, member, file, line, okind, ownerXrefs })),
            docHeldZero: input.members.filter(row => row.status === 'candidate' && row.group === 'G0-noref' && row.docsHold),
            privateCandidates: input.members.filter(row => row.status === 'candidate' && row.group === 'G1-samefile'),
            testOnlyObserved: testOnlyMembers.filter(row => row.sameFileValue === 0),
            testExternalBucketWithSameFileProductionUses: testOnlyMembers.filter(row => row.file.startsWith('src/') && row.sameFileValue > 0).length
        },
        conduits: {
            total: input.conduits.total,
            resolved: input.conduits.resolved,
            unresolved: input.conduits.unresolved,
            mappedRows: input.conduits.mappedRows
        },
        limits: [
            'Conduit resolution follows tsconfig compiler options; unresolved conduit targets and their source specifiers remain in conduits.json.',
            'Generated CommonJS surfaces and nested object/returned-shape members are held and not claimed as exhaustively enumerated.',
            'Observed test-only direct references do not prove absence of structural or dynamic dispatch; the removal gate still applies.',
            'This is a static inventory of the configured source, test, e2e, tools, and named root scope; it does not establish runtime consumers outside that scope.'
        ]
    };
}

export interface CensusOptions {
    root: string;
    out?: string;
    revision?: string;
    writeArtifacts?: boolean;
}

export interface CensusArtifacts {
    scope: ScopeJson;
    programOptions: Record<string, unknown>;
    published: Record<string, unknown>;
    exportRows: ExportRow[];
    candidates: CandidateRow[];
    members: MemberOutRow[];
    conduits: ConduitsJson;
    thisFallback: { root: string; tsconfig: string; strict: boolean | undefined; noImplicitThis: unknown; hits: unknown[]; note: string };
    integrated: IntegratedJson;
    summary: {
        scopeFiles: number;
        consumerFiles: number;
        exportRows: number;
        publishedRows: number;
        conduits: number;
        candidates: number;
        groups: Record<string, number>;
        memberRows: number;
        memberGroups: Record<string, number>;
        thisFallback: number;
        dtsCollisions: number;
        mappedBindings: number;
    };
}

function walkFiles(abs: string, out: string[] = []): string[] {
    for (const e of readdirSync(abs)) {
        const p = join(abs, e);
        const st = statSync(p);
        if (st.isDirectory()) {
            if (SKIP_DIRS.has(e)) {
                continue;
            }
            walkFiles(p, out);
        } else {
            out.push(p);
        }
    }
    return out;
}

function hiddenContractMember(sym: ts.Symbol): boolean {
    const name = sym.getName();
    if (name.startsWith('_') || name.startsWith('#') || name === 'prototype' || name === 'constructor') {
        return true;
    }
    if (sym.getJsDocTags().some(tag => tag.name === 'internal')) {
        return true;
    }
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (decl && ts.canHaveModifiers(decl)) {
        const mods = ts.getModifiers(decl) ?? [];
        return mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
    }
    return false;
}

function addContractTypeMembers(pairs: Set<string>, checker: ts.TypeChecker, rootName: string, type: ts.Type): void {
    const ctor = type.getConstructSignatures()[0];
    if (ctor) {
        for (const m of checker.getPropertiesOfType(ctor.getReturnType())) {
            if (!hiddenContractMember(m)) {
                pairs.add(`${rootName}.${m.getName()}`);
            }
        }
        return;
    }
    if (type.getCallSignatures().length > 0 || checker.isArrayLikeType(type)) {
        return;
    }
    for (const m of checker.getPropertiesOfType(type)) {
        if (!hiddenContractMember(m)) {
            pairs.add(`${rootName}.${m.getName()}`);
        }
    }
}

function loadContractPairs(root: string): Set<string> {
    const dtsPath = join(root, 'packages/rs2b0t-api/index.d.ts');
    if (!existsSync(dtsPath) || !existsSync(join(root, 'tsconfig.json'))) {
        return new Set();
    }
    const cfgFile = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
    if (cfgFile.error) {
        return new Set();
    }
    const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, root);
    const program = ts.createProgram([dtsPath], { ...parsed.options, noEmit: true, skipLibCheck: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(dtsPath);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!source || !moduleSymbol) {
        return new Set();
    }
    const pairs = new Set<string>();
    for (const exp of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
        if (!(resolved.flags & ts.SymbolFlags.Value)) {
            continue;
        }
        addContractTypeMembers(pairs, checker, exp.getName(), checker.getTypeOfSymbolAtLocation(resolved, source));
    }
    return pairs;
}

function addInstalledExtraRootPairs(pairs: Set<string>, checker: ts.TypeChecker, entries: ReadonlyArray<{ key: string; node: ts.Identifier | null }>, packageKeys: ReadonlySet<string>): void {
    for (const entry of entries) {
        if (packageKeys.has(entry.key) || !entry.node) {
            continue;
        }
        let sym: ts.Symbol | undefined;
        try {
            if (entry.node.parent && ts.isShorthandPropertyAssignment(entry.node.parent)) {
                sym = checker.getShorthandAssignmentValueSymbol(entry.node.parent);
            } else {
                sym = checker.getSymbolAtLocation(entry.node);
            }
        } catch {
            continue;
        }
        if (!sym) {
            continue;
        }
        addContractTypeMembers(pairs, checker, entry.key, checker.getTypeOfSymbolAtLocation(sym, entry.node));
    }
}

function parseIndexJs(root: string): string[] {
    const jsPath = join(root, 'packages/rs2b0t-api/index.js');
    if (!existsSync(jsPath)) {
        return [];
    }
    const js = readFileSync(jsPath, 'utf8');
    const m = /export const \{([\s\S]*?)\} = abi;/.exec(js);
    if (!m) {
        throw new Error('index.js export block not found');
    }
    return m[1]
        .split('\n')
        .map(l => l.replace(/\/\/.*$/, '').trim())
        .join(',')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function topExportsOfDts(root: string, file: string): string[] {
    const full = join(root, file);
    if (!existsSync(full)) {
        return [];
    }
    const src = ts.createSourceFile(file, readFileSync(full, 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const names: string[] = [];
    for (const st of src.statements) {
        if (!hasExportKeyword(st)) {
            continue;
        }
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name)) {
                    names.push(d.name.text);
                }
            }
        } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
            names.push(st.name.text);
        } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
            for (const e of st.exportClause.elements) {
                names.push(e.name.text);
            }
        }
    }
    return names;
}

function memberNameText(n: ts.PropertyName | undefined): string | null {
    if (!n) {
        return null;
    }
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) {
        return n.text;
    }
    return null;
}

function unwrapExpr(init: ts.Expression): ts.Expression {
    let cur = init;
    while (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur)) {
        cur = cur.expression;
    }
    return cur;
}

function hasExportKeyword(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) {
        return false;
    }
    return (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function modifierKinds(node: ts.Node): ts.SyntaxKind[] {
    if (!ts.canHaveModifiers(node)) {
        return [];
    }
    return (ts.getModifiers(node) ?? []).map(m => m.kind);
}

function propertyNameOf(node: ts.Node): ts.PropertyName | undefined {
    if (
        ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodSignature(node) ||
        ts.isPropertySignature(node)
    ) {
        return node.name;
    }
    return undefined;
}

function findAbiLiteral(sf: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
    let found: ts.ObjectLiteralExpression | undefined;
    const visit = (n: ts.Node): void => {
        if (found) {
            return;
        }
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'abi' && n.initializer && ts.isCallExpression(n.initializer) && n.initializer.arguments[0] && ts.isObjectLiteralExpression(n.initializer.arguments[0])) {
            found = n.initializer.arguments[0];
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function findClassByName(sf: ts.SourceFile, name: string): ts.ClassDeclaration | undefined {
    let found: ts.ClassDeclaration | undefined;
    const visit = (n: ts.Node): void => {
        if (found) {
            return;
        }
        if (ts.isClassDeclaration(n) && n.name && n.name.text === name) {
            found = n;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function findOwnerNode(sf: ts.SourceFile, owner: string): ts.ClassDeclaration | ts.ObjectLiteralExpression | undefined {
    let found: ts.ClassDeclaration | ts.ObjectLiteralExpression | undefined;
    const visit = (n: ts.Node): void => {
        if (found) {
            return;
        }
        if (ts.isClassDeclaration(n) && n.name && n.name.text === owner) {
            found = n;
            return;
        }
        if (ts.isVariableStatement(n)) {
            for (const d of n.declarationList.declarations) {
                if (ts.isIdentifier(d.name) && d.name.text === owner && d.initializer) {
                    const init = unwrapExpr(d.initializer);
                    if (ts.isObjectLiteralExpression(init)) {
                        found = init;
                        return;
                    }
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function findNewExpressionForOwner(sf: ts.SourceFile, owner: string): ts.NewExpression | undefined {
    let found: ts.NewExpression | undefined;
    const visit = (n: ts.Node): void => {
        if (found) {
            return;
        }
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === owner && n.initializer) {
            const init = unwrapExpr(n.initializer);
            if (ts.isNewExpression(init)) {
                found = init;
                return;
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function ownerMemberNodes(ownerNode: ts.ClassDeclaration | ts.ObjectLiteralExpression): readonly ts.Node[] {
    if (ts.isClassDeclaration(ownerNode)) {
        return ownerNode.members;
    }
    return ownerNode.properties;
}

function isInternalNode(node: ts.Node): boolean {
    try {
        return ts.getJSDocTags(node).some(t => t.tagName.text === 'internal');
    } catch {
        return false;
    }
}

function bump(o: Record<string, number>, f: string): void {
    o[f] = (o[f] ?? 0) + 1;
}

function sum(o: Record<string, number>): number {
    return Object.values(o).reduce((a, b) => a + b, 0);
}

function csvCell(o: Record<string, number>): string {
    const k = Object.keys(o);
    return (k.slice(0, 8).join(';') + (k.length > 8 ? `;+${k.length - 8}more` : '')).replace(/,/g, '|');
}

function writeJson(out: string, name: string, value: unknown): void {
    writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
}

export function runExportCensus(options: CensusOptions): CensusArtifacts {
    const ROOT = resolve(options.root);
    const OUT = options.out ? resolve(options.out) : undefined;
    const writeArtifacts = options.writeArtifacts ?? Boolean(OUT);
    const BASE_REVISION = options.revision ?? 'unknown';
    const rel = (p: string): string => repoPath(ROOT, p);
    if (writeArtifacts && OUT) {
        mkdirSync(OUT, { recursive: true });
    }

    const allFiles = walkFiles(ROOT)
        .map(rel)
        .filter(r => !EXCLUDED_TOPS.some(t => r === t || r.startsWith(t + '/')));
    const scopeFiles = allFiles.filter(r => {
        const s = scopeOf(r);
        if (s === 'src' || s === 'test' || s === 'tools' || s === 'e2e' || s === 'root') {
            return isSourceFileName(r);
        }
        return false;
    });
    const consumerFiles = allFiles.filter(r => {
        if (scopeFiles.includes(r)) {
            return false;
        }
        const s = scopeOf(r);
        if (s === 'src' || s === 'test' || s === 'e2e' || s === 'tools') {
            return r.endsWith('.js') || r.endsWith('.mjs') || r.endsWith('.cjs') || r.endsWith('.d.ts');
        }
        return r === 'identifier.js';
    });
    const scopeCounts: Record<string, number> = {};
    for (const f of scopeFiles) {
        const s = isTestFileName(f) ? scopeOf(f) + '+testflag' : scopeOf(f);
        scopeCounts[s] = (scopeCounts[s] ?? 0) + 1;
    }
    const consumerCounts: Record<string, number> = {};
    for (const f of consumerFiles) {
        consumerCounts[scopeOf(f)] = (consumerCounts[scopeOf(f)] ?? 0) + 1;
    }
    const scope: ScopeJson = {
        base: BASE_REVISION,
        root: ROOT,
        totalWalkedNonExcluded: allFiles.length,
        inScope: scopeFiles.length,
        byScope: scopeCounts,
        consumers: consumerFiles.length,
        consumersByScope: consumerCounts,
        consumerFiles,
        pkgapiFiles: allFiles.filter(r => scopeOf(r) === 'pkgapi'),
        otherFiles: allFiles.filter(r => scopeOf(r) === 'other').length,
        excludedTops: EXCLUDED_TOPS,
        note: 'Single ts.Program over all TS/JS-family sources in src/test/e2e/tools plus named root entries; declaration-only consumers contribute references. Generated CommonJS runtime surfaces remain held, not deletion candidates.'
    };

    const roots = [...scopeFiles, ...consumerFiles].map(f => join(ROOT, f));
    const tsconfigPath = join(ROOT, 'tsconfig.json');
    const cfgFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (cfgFile.error) {
        throw new Error('tsconfig.json unreadable at ' + tsconfigPath);
    }
    const parsedCfg = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, ROOT);
    const programOptions: ts.CompilerOptions = { ...parsedCfg.options, noEmit: true, skipLibCheck: true };
    if (programOptions.strict !== true) {
        throw new Error('census requires tsconfig strict:true (this-typing); got strict=' + String(programOptions.strict));
    }
    if ((programOptions.noImplicitThis ?? programOptions.strict) !== true) {
        throw new Error('census requires noImplicitThis (via strict); got noImplicitThis=' + String(programOptions.noImplicitThis));
    }
    const programOptionsJson = {
        tsconfig: rel(tsconfigPath),
        strict: programOptions.strict,
        noImplicitThis: programOptions.noImplicitThis ?? '(default via strict:true)',
        target: programOptions.target,
        module: programOptions.module,
        moduleResolution: programOptions.moduleResolution,
        baseUrl: programOptions.baseUrl,
        paths: programOptions.paths,
        allowJs: programOptions.allowJs,
        checkJs: programOptions.checkJs ?? false,
        lib: programOptions.lib,
        skipLibCheck: programOptions.skipLibCheck,
        noEmit: programOptions.noEmit
    };
    const program = ts.createProgram(roots, programOptions);
    const checker = program.getTypeChecker();
    const resolveAlias = (s: ts.Symbol | undefined): ts.Symbol | undefined => {
        let cur = s;
        const seen = new Set<ts.Symbol>();
        while (cur && cur.flags & ts.SymbolFlags.Alias && !seen.has(cur)) {
            seen.add(cur);
            try {
                cur = checker.getAliasedSymbol(cur);
            } catch {
                break;
            }
        }
        return cur;
    };
    const declKeyOf = (sym: ts.Symbol | undefined): string | null => {
        if (!sym || !sym.declarations || !sym.declarations.length) {
            return null;
        }
        const d = sym.declarations[0];
        try {
            return rel(d.getSourceFile().fileName) + ':' + d.getStart();
        } catch {
            return null;
        }
    };

    const P_JS = parseIndexJs(ROOT);
    const P_DTS = topExportsOfDts(ROOT, 'packages/rs2b0t-api/index.d.ts');
    const abiPath = join(ROOT, 'src/bot/runtime/abi.ts');
    const abiSf = program.getSourceFile(abiPath);
    const ABI_ENTRIES: Array<{ key: string; node: ts.Identifier | null; bare: boolean }> = [];
    if (abiSf) {
        const lit = findAbiLiteral(abiSf);
        if (lit) {
            for (const p of lit.properties) {
                if (ts.isShorthandPropertyAssignment(p)) {
                    ABI_ENTRIES.push({ key: p.name.text, node: p.name, bare: true });
                    continue;
                }
                if (!ts.isPropertyAssignment(p)) {
                    continue;
                }
                const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null;
                if (!key) {
                    continue;
                }
                const init = p.initializer;
                ABI_ENTRIES.push({ key, node: ts.isIdentifier(init) ? init : null, bare: ts.isIdentifier(init) });
            }
        }
    }
    const ABI_KEYS = ABI_ENTRIES.map(e => e.key);
    const publishedDeclKeys = new Map<string, string>();
    const abiResolution: Array<{ key: string; kind: string; target: string | null }> = [];
    for (const e of ABI_ENTRIES) {
        if (!e.bare || !e.node) {
            abiResolution.push({ key: e.key, kind: 'constructed', target: null });
            continue;
        }
        let sym: ts.Symbol | undefined;
        try {
            if (e.node.parent && ts.isShorthandPropertyAssignment(e.node.parent)) {
                sym = checker.getShorthandAssignmentValueSymbol(e.node.parent);
            } else {
                sym = checker.getSymbolAtLocation(e.node);
            }
        } catch {
            sym = undefined;
        }
        const t = resolveAlias(sym);
        const dk = declKeyOf(t);
        if (dk) {
            publishedDeclKeys.set(dk, e.key);
            abiResolution.push({ key: e.key, kind: 'bare', target: dk });
        } else {
            abiResolution.push({ key: e.key, kind: 'unresolved', target: null });
        }
    }
    const docHeldOwnerKeys = new Set(DOC_HELD.map(d => d.file + ':' + d.name));
    const publishedJson = {
        indexJsCount: P_JS.length,
        indexDtsCount: P_DTS.length,
        abiTopCount: ABI_KEYS.length,
        indexJsSubsetOfAbi: P_JS.every(x => ABI_KEYS.includes(x)),
        indexJsNotAbi: P_JS.filter(x => !ABI_KEYS.includes(x)),
        abiNotIndexJs: ABI_KEYS.filter(x => !P_JS.includes(x)),
        inJsNotDts: P_JS.filter(x => !P_DTS.includes(x)),
        inDtsNotJs: P_DTS.filter(x => !P_JS.includes(x)),
        abiResolution,
        resolvedTargets: publishedDeclKeys.size,
        docHeld: DOC_HELD,
        method: 'published = alias-resolved abi.ts value symbol (declKey), or doc-held extra, or exactly-one src match for a d.ts-only name. Same-name locals are never excluded by name.'
    };

    const lineOf = (sf: ts.SourceFile, pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const exportsRows: Array<
        Omit<ExportRow, 'publishedVia' | 'nameCollision' | 'abiKey' | 'published'> & {
            publishedVia?: string | null;
            nameCollision?: boolean;
            abiKey?: string | null;
            published?: boolean;
        }
    > = [];
    const conduits: Array<{ file: string; line: number; kind: string; name?: string; as?: string; source: string }> = [];
    for (const f of scopeFiles) {
        const full = join(ROOT, f);
        const sf = program.getSourceFile(full);
        if (!sf) {
            throw new Error(`Inventoried source absent from ts.Program: ${f}`);
        }
        for (const st of sf.statements) {
            const hasExport = hasExportKeyword(st);
            const push = (name: string, kind: string, nstart: number, nend: number, extra: { isDefault?: boolean; local?: string } = {}): void => {
                exportsRows.push({ file: f, line: lineOf(sf, st.getStart(sf)), kind, name, nameStart: nstart, nameEnd: nend, ...extra });
            };
            if (hasExport && ts.isVariableStatement(st)) {
                const k = st.declarationList.flags & ts.NodeFlags.Const ? 'const' : st.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
                for (const d of st.declarationList.declarations) {
                    if (ts.isIdentifier(d.name)) {
                        push(d.name.text, k, d.name.getStart(sf), d.name.getEnd());
                    }
                }
            } else if (hasExport && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st))) {
                const isDef = st.modifiers?.some(x => x.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
                if (st.name) {
                    push(
                        st.name.text,
                        ts.isFunctionDeclaration(st) ? 'function' : ts.isClassDeclaration(st) ? 'class' : ts.isInterfaceDeclaration(st) ? 'interface' : ts.isTypeAliasDeclaration(st) ? 'type' : 'enum',
                        st.name.getStart(sf),
                        st.name.getEnd(),
                        isDef ? { isDefault: true } : {}
                    );
                } else {
                    push('default', 'default', st.getStart(sf), st.getStart(sf), { isDefault: true });
                }
            } else if (ts.isExportDeclaration(st)) {
                if (!st.exportClause) {
                    conduits.push({ file: f, line: lineOf(sf, st.getStart(sf)), kind: 'star', source: st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier) ? st.moduleSpecifier.text : '(unknown)' });
                } else if (ts.isNamedExports(st.exportClause)) {
                    for (const e of st.exportClause.elements) {
                        if (st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier)) {
                            conduits.push({
                                file: f,
                                line: lineOf(sf, e.getStart(sf)),
                                kind: 're-export',
                                name: e.propertyName ? e.propertyName.text : e.name.text,
                                as: e.name.text,
                                source: st.moduleSpecifier.text
                            });
                        } else {
                            exportsRows.push({
                                file: f,
                                line: lineOf(sf, e.getStart(sf)),
                                kind: 'specifier',
                                name: e.name.text,
                                local: e.propertyName ? e.propertyName.text : e.name.text,
                                nameStart: e.name.getStart(sf),
                                nameEnd: e.name.getEnd()
                            });
                        }
                    }
                } else if (ts.isNamespaceExport(st.exportClause)) {
                    conduits.push({
                        file: f,
                        line: lineOf(sf, st.getStart(sf)),
                        kind: 'namespace',
                        name: st.exportClause.name.text,
                        source: st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier) ? st.moduleSpecifier.text : '(unknown)'
                    });
                }
            } else if (ts.isExportAssignment(st)) {
                const local = ts.isIdentifier(st.expression) ? st.expression.text : null;
                const exprStart = local ? st.expression.getStart(sf) : st.getStart(sf);
                const exprEnd = local ? st.expression.getEnd() : exprStart;
                push('default', 'default', exprStart, exprEnd, { isDefault: true, ...(local ? { local } : {}) });
            }
        }
    }

    const scopeSet = new Set([...scopeFiles, ...consumerFiles].map(f => join(ROOT, f)));
    const resolveConduit = createConduitResolver({
        root: ROOT,
        compilerOptions: programOptions,
        scopedFiles: [...scopeFiles, ...consumerFiles]
    });
    const symMap = new Map<ts.Symbol, number[]>();
    const symDeclKey = new Map<string, number[]>();
    for (const sf of program.getSourceFiles()) {
        if (!scopeSet.has(sf.fileName) || sf.isDeclarationFile) {
            continue;
        }
        if (!scopeFiles.includes(rel(sf.fileName))) {
            continue;
        }
        let modSym: ts.Symbol | undefined;
        try {
            modSym = checker.getSymbolAtLocation(sf);
        } catch {
            continue;
        }
        if (!modSym) {
            continue;
        }
        let exps: readonly ts.Symbol[] = [];
        try {
            exps = checker.getExportsOfModule(modSym);
        } catch {
            continue;
        }
        const f = rel(sf.fileName);
        for (const e of exps) {
            const t = resolveAlias(e);
            if (!t) {
                continue;
            }
            let rows: number[];
            if (e.name === 'default') {
                rows = exportsRows.map((_, i) => i).filter(i => exportsRows[i].file === f && exportsRows[i].isDefault);
            } else {
                rows = exportsRows.map((_, i) => i).filter(i => exportsRows[i].file === f && exportsRows[i].name === e.name && !exportsRows[i].isDefault);
            }
            if (!rows.length) {
                continue;
            }
            if (!symMap.has(t)) {
                symMap.set(t, []);
            }
            for (const i of rows) {
                if (!symMap.get(t)!.includes(i)) {
                    symMap.get(t)!.push(i);
                }
            }
            const dk = declKeyOf(t);
            if (dk) {
                if (!symDeclKey.has(dk)) {
                    symDeclKey.set(dk, []);
                }
                for (const i of rows) {
                    if (!symDeclKey.get(dk)!.includes(i)) {
                        symDeclKey.get(dk)!.push(i);
                    }
                }
            }
        }
    }

    const importedLocals = new Map<string, Set<string>>();
    const nsLocals = new Map<string, Set<string>>();
    for (const f of [...scopeFiles, ...consumerFiles]) {
        const full = join(ROOT, f);
        const sf = program.getSourceFile(full);
        if (!sf || sf.isDeclarationFile) {
            continue;
        }
        const locals = new Set<string>();
        const ns = new Set<string>();
        const visitImp = (n: ts.Node): void => {
            if (ts.isImportClause(n)) {
                if (n.name) {
                    locals.add(n.name.text);
                }
                if (n.namedBindings) {
                    if (ts.isNamespaceImport(n.namedBindings)) {
                        locals.add(n.namedBindings.name.text);
                        ns.add(n.namedBindings.name.text);
                    } else if (ts.isNamedImports(n.namedBindings)) {
                        for (const e of n.namedBindings.elements) {
                            locals.add(e.name.text);
                        }
                    }
                }
            } else if (ts.isImportEqualsDeclaration(n)) {
                locals.add(n.name.text);
            }
            ts.forEachChild(n, visitImp);
        };
        visitImp(sf);
        importedLocals.set(f, locals);
        nsLocals.set(f, ns);
    }

    const srcNameCounts: Record<string, number> = {};
    for (let i = 0; i < exportsRows.length; i++) {
        if (scopeOf(exportsRows[i].file) !== 'src') {
            continue;
        }
        srcNameCounts[exportsRows[i].name] = (srcNameCounts[exportsRows[i].name] ?? 0) + 1;
    }
    const dtsOnlyDecisions: Array<{ name: string; file: string; decision: string }> = [];
    const rowDeclKeys = exportsRows.map(() => new Set<string>());
    for (const [t, rows] of symMap) {
        const dk = declKeyOf(t);
        if (!dk) {
            continue;
        }
        for (const i of rows) {
            rowDeclKeys[i].add(dk);
        }
    }
    const P_JS_SET = new Set(P_JS);
    for (let i = 0; i < exportsRows.length; i++) {
        const r = exportsRows[i];
        r.publishedVia = null;
        r.nameCollision = false;
        r.abiKey = null;
        for (const dk of rowDeclKeys[i]) {
            if (publishedDeclKeys.has(dk)) {
                r.abiKey = publishedDeclKeys.get(dk) ?? null;
                break;
            }
        }
        if (DOC_HELD.some(d => d.name === r.name && d.file === r.file)) {
            r.publishedVia = 'doc-held';
            continue;
        }
        if (r.abiKey && P_JS_SET.has(r.abiKey)) {
            r.publishedVia = 'package-symbol:' + r.abiKey;
            continue;
        }
        if (P_DTS.includes(r.name) && scopeOf(r.file) === 'src') {
            if (srcNameCounts[r.name] === 1) {
                r.publishedVia = 'dts-single';
            } else {
                r.nameCollision = true;
                dtsOnlyDecisions.push({ name: r.name, file: r.file, decision: 'collision-kept' });
            }
        }
    }
    for (const r of exportsRows) {
        r.published = r.publishedVia != null;
    }
    const finalizedExports: ExportRow[] = exportsRows.map(r => ({
        file: r.file,
        line: r.line,
        kind: r.kind,
        name: r.name,
        nameStart: r.nameStart,
        nameEnd: r.nameEnd,
        isDefault: r.isDefault,
        local: r.local,
        publishedVia: r.publishedVia ?? null,
        nameCollision: r.nameCollision ?? false,
        abiKey: r.abiKey ?? null,
        published: r.published === true
    }));

    const ownerExportKeys = new Set<string>();
    const ownerAnnotated = new Set<string>();
    const hasStructuralCast = (n: ts.Node): boolean => {
        let found = false;
        const v = (x: ts.Node): void => {
            if (found) {
                return;
            }
            if (ts.isSatisfiesExpression(x) || ts.isAsExpression(x)) {
                found = true;
                return;
            }
            ts.forEachChild(x, v);
        };
        v(n);
        return found;
    };
    const ownerDynByType = new Set<string>();
    const contractPairs = loadContractPairs(ROOT);
    addInstalledExtraRootPairs(contractPairs, checker, ABI_ENTRIES, P_JS_SET);
    interface MemberRow {
        owner: string;
        okind: 'class' | 'object' | 'instance';
        file: string;
        line: number;
        member: string;
        mkind: string;
        static: boolean;
        prot: boolean;
        hook: boolean;
        publishedPair: boolean;
        overridesPublished: boolean;
        retainedDispatch?: boolean;
        retainedWhy: string | null;
        nameStart: number;
        nameEnd: number;
        declKey: string | null;
        exportFile?: string;
        via?: string;
        cls?: string;
    }
    const memberRows: MemberRow[] = [];
    let _privateSkipped = 0;
    let _spreadOwners = 0;
    let _computedSkipped = 0;
    let _internalExcluded = 0;
    let _overloadMerged = 0;
    const instanceOwners: Array<{ owner: string; cls: string; exportFile: string; exportLine: number }> = [];
    for (const f of scopeFiles) {
        if (scopeOf(f) !== 'src') {
            continue;
        }
        const full = join(ROOT, f);
        const sf = program.getSourceFile(full);
        if (!sf) {
            throw new Error(`Member source absent from ts.Program: ${f}`);
        }
        for (const st of sf.statements) {
            const hasExport = hasExportKeyword(st);
            if (!hasExport) {
                continue;
            }
            const owners: Array<{ name: string; okind: 'class' | 'object'; members: readonly ts.Node[]; heritage: ts.Expression[] }> = [];
            if (ts.isClassDeclaration(st) && st.name) {
                owners.push({
                    name: st.name.text,
                    okind: 'class',
                    members: [...st.members],
                    heritage: (st.heritageClauses ?? []).flatMap(h => h.types.map(t => t.expression))
                });
            } else if (ts.isVariableStatement(st)) {
                for (const d of st.declarationList.declarations) {
                    if (!ts.isIdentifier(d.name) || !d.initializer) {
                        continue;
                    }
                    const init = unwrapExpr(d.initializer);
                    if (ts.isObjectLiteralExpression(init)) {
                        owners.push({ name: d.name.text, okind: 'object', members: [...init.properties], heritage: [] });
                        ownerExportKeys.add(f + ':' + d.name.text);
                        if (d.type || hasStructuralCast(d.initializer)) {
                            ownerAnnotated.add(f + ':' + d.name.text);
                        }
                        const ttxt = d.type ? d.type.getText(sf) : '';
                        if (/Record\s*</.test(ttxt) || /\{\s*\[/.test(ttxt)) {
                            ownerDynByType.add(f + ':' + d.name.text);
                        }
                    } else if (ts.isNewExpression(init)) {
                        const ex = init.expression;
                        const cls = ts.isIdentifier(ex) ? ex.text : ts.isPropertyAccessExpression(ex) && ts.isIdentifier(ex.name) ? ex.name.text : null;
                        if (cls) {
                            instanceOwners.push({ owner: d.name.text, cls, exportFile: f, exportLine: lineOf(sf, d.name.getStart(sf)) });
                        }
                    }
                }
            }
            for (const o of owners) {
                for (const m of o.members) {
                    if (ts.isSpreadAssignment(m)) {
                        _spreadOwners++;
                        continue;
                    }
                    const nameNode = propertyNameOf(m);
                    const nm = memberNameText(nameNode);
                    if (!nm) {
                        _computedSkipped++;
                        continue;
                    }
                    if (isInternalNode(m)) {
                        _internalExcluded++;
                        continue;
                    }
                    const mods = modifierKinds(m);
                    const isPriv = mods.includes(ts.SyntaxKind.PrivateKeyword) || nm.startsWith('#');
                    if (isPriv) {
                        _privateSkipped++;
                        continue;
                    }
                    if (memberRows.some(r => r.file === f && r.owner === o.name && r.member === nm)) {
                        _overloadMerged++;
                        continue;
                    }
                    const isProt = mods.includes(ts.SyntaxKind.ProtectedKeyword);
                    const isStatic = mods.includes(ts.SyntaxKind.StaticKeyword);
                    const mkind = ts.isMethodDeclaration(m) ? 'method' : ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m) ? 'accessor' : ts.isConstructorDeclaration(m) ? 'ctor' : 'prop';
                    if (mkind === 'ctor') {
                        continue;
                    }
                    const row: MemberRow = {
                        owner: o.name,
                        okind: o.okind,
                        file: f,
                        line: lineOf(sf, m.getStart(sf)),
                        member: nm,
                        mkind,
                        static: isStatic,
                        prot: isProt,
                        hook: false,
                        publishedPair: false,
                        overridesPublished: false,
                        retainedWhy: null,
                        nameStart: nameNode ? nameNode.getStart(sf) : m.getStart(sf),
                        nameEnd: nameNode ? nameNode.getEnd() : m.getStart(sf),
                        declKey: null
                    };
                    if (isProt) {
                        row.hook = true;
                        row.retainedWhy = 'protected-extension-hook';
                    } else if (contractPairs.has(o.name + '.' + nm)) {
                        row.publishedPair = true;
                    } else if (o.name === 'reader') {
                        row.publishedPair = true;
                        row.retainedWhy = 'reader90-retained';
                    }
                    memberRows.push(row);
                }
                if (o.heritage.length) {
                    const hpsf = program.getSourceFile(join(ROOT, f));
                    const hcls = hpsf ? findClassByName(hpsf, o.name) : undefined;
                    if (hcls) {
                        for (const { symbol: bsym, declaration: bd } of collectHeritageDeclarations(checker, hcls, resolveAlias)) {
                            const baseNames = new Set<string>();
                            for (const bm of bd.members ?? []) {
                                const bn = bm.name ? memberNameText(bm.name) : null;
                                if (bn) {
                                    baseNames.add(bn);
                                }
                            }
                            const bname = bsym.name;
                            for (const row of memberRows) {
                                if (row.file !== f || row.owner !== o.name || row.publishedPair || row.hook || row.retainedDispatch) {
                                    continue;
                                }
                                if (baseNames.has(row.member) && (contractPairs.has(bname + '.' + row.member) || bname === 'reader')) {
                                    row.overridesPublished = true;
                                    row.retainedWhy = 'override-of-published:' + bname;
                                } else if (baseNames.has(row.member)) {
                                    row.retainedDispatch = true;
                                    row.retainedWhy = 'dispatch-via-base:' + bname;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ownersOutOfScope = 0;
    {
        const ownerRowByFileName = new Map<string, number[]>();
        for (let i = 0; i < finalizedExports.length; i++) {
            const r = finalizedExports[i];
            if (r.kind === 'const' || r.kind === 'class' || r.kind === 'let' || r.kind === 'var') {
                const k = r.file + ':' + r.name;
                if (!ownerRowByFileName.has(k)) {
                    ownerRowByFileName.set(k, []);
                }
                ownerRowByFileName.get(k)!.push(i);
            }
        }
        const inScopeOwner = (r: MemberRow): boolean => {
            const ef = r.exportFile ?? r.file;
            if (ef.startsWith('src/bot/api/')) {
                return true;
            }
            if (docHeldOwnerKeys.has(ef + ':' + r.owner)) {
                return true;
            }
            for (const i of ownerRowByFileName.get(ef + ':' + r.owner) ?? []) {
                for (const dk of rowDeclKeys[i]) {
                    if (publishedDeclKeys.has(dk)) {
                        return true;
                    }
                }
            }
            return false;
        };
        for (let i = memberRows.length - 1; i >= 0; i--) {
            if (!inScopeOwner(memberRows[i])) {
                memberRows.splice(i, 1);
                _ownersOutOfScope++;
            }
        }
    }
    for (const r of memberRows) {
        const pin = DISPATCH_PINNED.find(d => d.owner === r.owner && d.member === r.member && (!d.file || (r.exportFile ?? r.file) === d.file));
        if (pin && !r.publishedPair && !r.hook && !r.overridesPublished && !r.retainedDispatch) {
            r.retainedDispatch = true;
            r.retainedWhy = 'pinned:' + pin.why;
        }
    }
    const memberSymDecl = new Map<string, number[]>();
    {
        for (let i = 0; i < memberRows.length; i++) {
            const r = memberRows[i];
            if (r.publishedPair || r.hook || r.overridesPublished || r.retainedDispatch) {
                continue;
            }
            const sf = program.getSourceFile(join(ROOT, r.file));
            if (!sf) {
                continue;
            }
            const ownerNode = findOwnerNode(sf, r.owner);
            if (!ownerNode) {
                continue;
            }
            const props = ownerMemberNodes(ownerNode);
            const mnodes = props.filter(m => memberNameText(propertyNameOf(m)) === r.member);
            for (const mnode of mnodes) {
                let sym: ts.Symbol | undefined;
                const nameNode = propertyNameOf(mnode);
                try {
                    sym = nameNode ? resolveAlias(checker.getSymbolAtLocation(nameNode)) : undefined;
                } catch {
                    sym = undefined;
                }
                const dk = declKeyOf(sym);
                if (dk) {
                    if (!r.declKey) {
                        r.declKey = dk;
                    }
                    if (!memberSymDecl.has(dk)) {
                        memberSymDecl.set(dk, []);
                    }
                    if (!memberSymDecl.get(dk)!.includes(i)) {
                        memberSymDecl.get(dk)!.push(i);
                    }
                }
            }
        }
    }
    let _instanceOwnersResolved = 0;
    let _instanceOwnersOutOfScope = 0;
    let _instanceImportedClassSkipped = 0;
    {
        const exportRowIdx = new Map<string, number>();
        for (let i = 0; i < finalizedExports.length; i++) {
            const r = finalizedExports[i];
            if (r.kind === 'const' || r.kind === 'class' || r.kind === 'let' || r.kind === 'var') {
                const k = r.file + ':' + r.name;
                if (!exportRowIdx.has(k)) {
                    exportRowIdx.set(k, i);
                }
            }
        }
        for (const io of instanceOwners) {
            const ei = exportRowIdx.get(io.exportFile + ':' + io.owner);
            let inScope = io.exportFile.startsWith('src/bot/api/') || docHeldOwnerKeys.has(io.exportFile + ':' + io.owner);
            if (!inScope && ei !== undefined) {
                for (const dk of rowDeclKeys[ei]) {
                    if (publishedDeclKeys.has(dk)) {
                        inScope = true;
                        break;
                    }
                }
            }
            if (!inScope) {
                _instanceOwnersOutOfScope++;
                continue;
            }
            const psf = program.getSourceFile(join(ROOT, io.exportFile));
            if (!psf) {
                continue;
            }
            const newExpr = findNewExpressionForOwner(psf, io.owner);
            if (!newExpr) {
                continue;
            }
            let clsSym: ts.Symbol | undefined;
            try {
                clsSym = resolveAlias(checker.getSymbolAtLocation(newExpr.expression));
            } catch {
                clsSym = undefined;
            }
            if (!clsSym || !clsSym.declarations) {
                continue;
            }
            for (const cd of clsSym.declarations) {
                if (!ts.isClassDeclaration(cd)) {
                    continue;
                }
                if (rel(cd.getSourceFile().fileName) !== io.exportFile) {
                    _instanceImportedClassSkipped++;
                    continue;
                }
                const csf = cd.getSourceFile();
                const cdf = rel(csf.fileName);
                const basePublished = new Set<string>();
                const baseMembers = new Set<string>();
                for (const { symbol: bsym, declaration: bd } of collectHeritageDeclarations(checker, cd, resolveAlias)) {
                    for (const bm of bd.members ?? []) {
                        const bn = bm.name ? memberNameText(bm.name) : null;
                        if (bn && (contractPairs.has(bsym.name + '.' + bn) || bsym.name === 'reader')) {
                            basePublished.add(bn);
                        }
                        if (bn) {
                            baseMembers.add(bn);
                        }
                    }
                }
                for (const m of cd.members) {
                    if (ts.isConstructorDeclaration(m)) {
                        continue;
                    }
                    const nm = m.name ? memberNameText(m.name) : null;
                    if (!nm) {
                        _computedSkipped++;
                        continue;
                    }
                    if (isInternalNode(m)) {
                        _internalExcluded++;
                        continue;
                    }
                    const mods = modifierKinds(m);
                    if (mods.includes(ts.SyntaxKind.PrivateKeyword) || nm.startsWith('#')) {
                        _privateSkipped++;
                        continue;
                    }
                    if (memberRows.some(r => (r.exportFile ?? r.file) === io.exportFile && r.owner === io.owner && r.member === nm)) {
                        _overloadMerged++;
                        continue;
                    }
                    const isProt = mods.includes(ts.SyntaxKind.ProtectedKeyword);
                    const isStatic = mods.includes(ts.SyntaxKind.StaticKeyword);
                    const mkind = ts.isMethodDeclaration(m) ? 'method' : ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m) ? 'accessor' : 'prop';
                    const row: MemberRow = {
                        owner: io.owner,
                        okind: 'instance',
                        cls: io.cls,
                        via: 'instance',
                        exportFile: io.exportFile,
                        file: cdf,
                        line: lineOf(csf, m.getStart()),
                        member: nm,
                        mkind,
                        static: isStatic,
                        prot: isProt,
                        hook: false,
                        publishedPair: false,
                        overridesPublished: false,
                        retainedWhy: null,
                        nameStart: m.name ? m.name.getStart(csf) : m.getStart(csf),
                        nameEnd: m.name ? m.name.getEnd() : m.getStart(csf),
                        declKey: null
                    };
                    if (isProt) {
                        row.hook = true;
                        row.retainedWhy = 'protected-extension-hook';
                    } else if (contractPairs.has(io.owner + '.' + nm)) {
                        row.publishedPair = true;
                    } else if (io.owner === 'reader') {
                        row.publishedPair = true;
                        row.retainedWhy = 'reader90-retained';
                    } else if (basePublished.has(nm)) {
                        row.overridesPublished = true;
                        row.retainedWhy = 'override-of-published';
                    } else if (baseMembers.has(nm)) {
                        row.retainedDispatch = true;
                        row.retainedWhy = 'dispatch-via-base';
                    } else {
                        let sym: ts.Symbol | undefined;
                        try {
                            sym = m.name ? resolveAlias(checker.getSymbolAtLocation(m.name)) : undefined;
                        } catch {
                            sym = undefined;
                        }
                        const dk = declKeyOf(sym);
                        if (dk) {
                            row.declKey = dk;
                        }
                    }
                    const idx = memberRows.length;
                    memberRows.push(row);
                    if (row.declKey && !row.publishedPair && !row.hook && !row.overridesPublished) {
                        if (!memberSymDecl.has(row.declKey)) {
                            memberSymDecl.set(row.declKey, []);
                        }
                        memberSymDecl.get(row.declKey)!.push(idx);
                    }
                    _instanceOwnersResolved++;
                }
            }
        }
    }
    const memberNames = new Set(memberRows.filter(r => !r.publishedPair && !r.hook && !r.overridesPublished && !r.retainedDispatch).map(r => r.member));
    const memberIdxByName = new Map<string, number[]>();
    for (let i = 0; i < memberRows.length; i++) {
        const r = memberRows[i];
        if (r.publishedPair || r.hook || r.overridesPublished || r.retainedDispatch) {
            continue;
        }
        if (!memberIdxByName.has(r.member)) {
            memberIdxByName.set(r.member, []);
        }
        memberIdxByName.get(r.member)!.push(i);
    }
    const dynamicOwners = new Set<string>();

    const candIdx = finalizedExports.map((_, i) => i).filter(i => !finalizedExports[i].published);
    const candIdxSet = new Set(candIdx);
    const candNames = new Set(candIdx.map(i => finalizedExports[i].name));
    const interest = new Set([...exportInterestNames(candIdx.map(i => finalizedExports[i])), ...memberNames]);
    const isTypePos = (n: ts.Node): boolean => {
        let a: ts.Node | undefined = n.parent;
        let depth = 0;
        while (a && depth < 10) {
            if (ts.isTypeNode(a)) {
                return true;
            }
            a = a.parent;
            depth++;
        }
        const p = n.parent;
        if (p && (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) && p.isTypeOnly) {
            return true;
        }
        if (p && ts.isImportClause(p) && p.isTypeOnly) {
            return true;
        }
        if (p && ts.isImportSpecifier(p)) {
            const clause = p.parent?.parent;
            if (clause && ts.isImportClause(clause) && clause.isTypeOnly) {
                return true;
            }
        }
        return false;
    };
    const buckets = new Map<number, RefBucket>();
    const getB = (i: number): RefBucket => {
        let b = buckets.get(i);
        if (!b) {
            b = newRefBucket();
            buckets.set(i, b);
        }
        return b;
    };
    const mbuckets = new Map<number, RefBucket>();
    const getMB = (j: number): RefBucket => {
        let b = mbuckets.get(j);
        if (!b) {
            b = newRefBucket();
            mbuckets.set(j, b);
        }
        return b;
    };
    const thisFallbackHits: Array<{ file: string; site: number; owner: string | null; member: string; rows: number[] }> = [];
    const inNameRange = (r: { file: string; nameStart: number; nameEnd: number }, f: string, s: number, e: number): boolean => r.file === f && s >= r.nameStart && e <= r.nameEnd;
    const countInto = (b: RefBucket, f: string, tflag: boolean, typeOnly: boolean, heritage: boolean, isCall: boolean, isNs: boolean): void => {
        if (heritage) {
            bump(b.heritage, f);
            return;
        }
        let bucketScope: 'test' | 'tools' | 'src';
        if (tflag) {
            bucketScope = 'test';
        } else if (scopeOf(f) === 'tools' || scopeOf(f) === 'root' || scopeOf(f) === 'other') {
            bucketScope = 'tools';
        } else {
            bucketScope = 'src';
        }
        if (typeOnly) {
            bump(b.type, f);
        } else {
            bump(b[bucketScope], f);
            if (isCall) {
                b.calls[bucketScope]++;
            }
            if (isNs) {
                bump(b.nsf, f);
            }
        }
    };

    const leftmostIdentifier = (e: ts.Expression): ts.Identifier | null => {
        let cur: ts.Expression = e;
        while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
            cur = cur.expression;
        }
        return ts.isIdentifier(cur) ? cur : null;
    };
    const namespaceLocal = (file: string, id: ts.Identifier): boolean => {
        if ((nsLocals.get(file) ?? new Set()).has(id.text)) {
            return true;
        }
        try {
            const resolved = resolveAlias(checker.getSymbolAtLocation(id));
            return !!resolved && !!(resolved.flags & (ts.SymbolFlags.Module | ts.SymbolFlags.Namespace));
        } catch {
            return false;
        }
    };
    const isNamespacePropertyName = (n: ts.Identifier, file: string): boolean => {
        const parent = n.parent;
        if (!parent || !ts.isPropertyAccessExpression(parent) || parent.name !== n) {
            return false;
        }
        const left = leftmostIdentifier(parent.expression);
        return !!left && namespaceLocal(file, left);
    };

    for (const sf of program.getSourceFiles()) {
        if (!scopeSet.has(sf.fileName)) {
            continue;
        }
        if (sf.isDeclarationFile && !consumerFiles.includes(rel(sf.fileName))) {
            continue;
        }
        const f = rel(sf.fileName);
        const tflag = isTestFileName(f);
        const locals = importedLocals.get(f) ?? new Set<string>();
        const visit = (n: ts.Node): void => {
            if (ts.isIdentifier(n) && (interest.has(n.text) || locals.has(n.text) || isNamespacePropertyName(n, f))) {
                const p = n.parent;
                let skip = false;
                let heritage = false;
                if (p) {
                    if (ts.isPropertyAssignment(p) && p.name === n) {
                        skip = true;
                    } else if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) {
                        skip = true;
                    } else if (ts.isExportSpecifier(p)) {
                        const decl = p.parent?.parent;
                        if (decl && ts.isExportDeclaration(decl) && decl.moduleSpecifier) {
                            skip = true;
                        }
                    } else if (ts.isExpressionWithTypeArguments(p)) {
                        heritage = true;
                    }
                }
                if (!skip) {
                    const isDirectCall = !!p && ((ts.isCallExpression(p) && p.expression === n) || (ts.isNewExpression(p) && p.expression === n));
                    const isPropCall =
                        !!p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && !!p.parent && ((ts.isCallExpression(p.parent) && p.parent.expression === p) || (ts.isNewExpression(p.parent) && p.parent.expression === p));
                    const isCall = isDirectCall || isPropCall;
                    const isNs =
                        !!p &&
                        (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
                        (() => {
                            const l = leftmostIdentifier(p.expression);
                            return !!l && namespaceLocal(f, l);
                        })();
                    let sym: ts.Symbol | undefined;
                    let memberAttributed = false;
                    try {
                        if (p && ts.isShorthandPropertyAssignment(p)) {
                            sym = checker.getShorthandAssignmentValueSymbol(p);
                        } else {
                            sym = checker.getSymbolAtLocation(n);
                        }
                    } catch {
                        sym = undefined;
                    }
                    if (sym) {
                        const t = resolveAlias(sym);
                        let rows = t ? symMap.get(t) : undefined;
                        if (!rows) {
                            const dk = declKeyOf(t);
                            if (dk) {
                                rows = symDeclKey.get(dk);
                            }
                        }
                        if (rows) {
                            const typeOnly = heritage ? false : isTypePos(n);
                            const s = n.getStart(sf);
                            const e = n.getEnd();
                            for (const i of rows) {
                                if (!candIdxSet.has(i)) {
                                    continue;
                                }
                                const c = finalizedExports[i];
                                if (inNameRange(c, f, s, e)) {
                                    continue;
                                }
                                const b = getB(i);
                                if (heritage) {
                                    bump(b.heritage, f);
                                } else if (c.file === f) {
                                    if (typeOnly) {
                                        b.sameT++;
                                    } else {
                                        b.sameV++;
                                        if (isCall) {
                                            b.sameCalls++;
                                        }
                                    }
                                } else {
                                    countInto(b, f, tflag, typeOnly, false, isCall, isNs);
                                }
                            }
                        }
                        const dk = declKeyOf(t);
                        const mrowsFor = dk ? memberSymDecl.get(dk) : undefined;
                        if (mrowsFor) {
                            memberAttributed = true;
                            const typeOnly = isTypePos(n);
                            const s = n.getStart(sf);
                            const e = n.getEnd();
                            for (const j of mrowsFor) {
                                const r = memberRows[j];
                                if (inNameRange(r, f, s, e)) {
                                    continue;
                                }
                                const b = getMB(j);
                                if (r.file === f) {
                                    if (typeOnly) {
                                        b.sameT++;
                                    } else {
                                        b.sameV++;
                                        if (isCall) {
                                            b.sameCalls++;
                                        }
                                    }
                                } else {
                                    countInto(b, f, tflag, typeOnly, false, isCall, isNs);
                                }
                            }
                        }
                        if (p && ts.isPropertyAccessExpression(p) && p.name === n && memberNames.has(n.text)) {
                            try {
                                const ut = checker.getTypeAtLocation(p.expression);
                                if (ut && ut.isUnion()) {
                                    const s2 = n.getStart(sf);
                                    const e2 = n.getEnd();
                                    const tOnly = isTypePos(n);
                                    for (const ct of ut.types) {
                                        const ps = checker.getPropertyOfType(ct, n.text);
                                        if (!ps) {
                                            continue;
                                        }
                                        const pdk = declKeyOf(resolveAlias(ps));
                                        if (!pdk || pdk === dk) {
                                            continue;
                                        }
                                        const pj = memberSymDecl.get(pdk);
                                        if (!pj) {
                                            continue;
                                        }
                                        memberAttributed = true;
                                        for (const j of pj) {
                                            const r = memberRows[j];
                                            if (inNameRange(r, f, s2, e2)) {
                                                continue;
                                            }
                                            const b = getMB(j);
                                            if (r.file === f) {
                                                if (tOnly) {
                                                    b.sameT++;
                                                } else {
                                                    b.sameV++;
                                                    if (isCall) {
                                                        b.sameCalls++;
                                                    }
                                                }
                                            } else {
                                                countInto(b, f, tflag, tOnly, false, isCall, isNs);
                                            }
                                        }
                                    }
                                }
                            } catch {
                                /* type query failed; single-constituent count stands */
                            }
                        }
                        if (rows) {
                            for (const i of rows) {
                                const c = finalizedExports[i];
                                const okey = c.file + ':' + c.name;
                                if (!ownerExportKeys.has(okey)) {
                                    continue;
                                }
                                if (p && ts.isElementAccessExpression(p) && p.expression === n) {
                                    const arg = p.argumentExpression;
                                    if (!arg || !(ts.isStringLiteralLike(arg) || ts.isNumericLiteral(arg))) {
                                        dynamicOwners.add(okey);
                                    }
                                } else if (
                                    p &&
                                    ts.isCallExpression(p) &&
                                    p.expression &&
                                    ts.isPropertyAccessExpression(p.expression) &&
                                    ts.isIdentifier(p.expression.expression) &&
                                    p.expression.expression.text === 'Object' &&
                                    ['keys', 'values', 'entries'].includes(p.expression.name.text) &&
                                    p.arguments.length &&
                                    p.arguments[0] === n
                                ) {
                                    dynamicOwners.add(okey);
                                }
                            }
                        }
                    }
                    if (!memberAttributed && p && ts.isPropertyAccessExpression(p) && p.name === n && p.expression && p.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(n) && memberNames.has(n.text)) {
                        let lit: ts.ObjectLiteralExpression | null = null;
                        let a: ts.Node | undefined = p.parent;
                        while (a && !ts.isSourceFile(a)) {
                            if (ts.isArrowFunction(a)) {
                                a = a.parent;
                                continue;
                            }
                            if ((ts.isMethodDeclaration(a) || ts.isGetAccessorDeclaration(a) || ts.isSetAccessorDeclaration(a)) && a.parent && ts.isObjectLiteralExpression(a.parent)) {
                                lit = a.parent;
                                break;
                            }
                            if (ts.isFunctionDeclaration(a) || ts.isFunctionExpression(a) || ts.isMethodDeclaration(a) || ts.isGetAccessorDeclaration(a) || ts.isSetAccessorDeclaration(a) || ts.isClassDeclaration(a)) {
                                break;
                            }
                            a = a.parent;
                        }
                        if (lit) {
                            let ownerName: string | null = null;
                            let b: ts.Node | undefined = lit.parent;
                            while (b && !ts.isSourceFile(b)) {
                                if (ts.isVariableDeclaration(b) && ts.isIdentifier(b.name)) {
                                    ownerName = b.name.text;
                                    break;
                                }
                                if (ts.isClassDeclaration(b)) {
                                    break;
                                }
                                b = b.parent;
                            }
                            const idxs = ownerName ? (memberIdxByName.get(n.text) ?? []).filter(j => memberRows[j].file === f && memberRows[j].owner === ownerName) : [];
                            const s3 = n.getStart(sf);
                            const e3 = n.getEnd();
                            const tOnly = isTypePos(n);
                            for (const j of idxs) {
                                const r = memberRows[j];
                                if (inNameRange(r, f, s3, e3)) {
                                    continue;
                                }
                                const mb = getMB(j);
                                if (tOnly) {
                                    mb.sameT++;
                                } else {
                                    mb.sameV++;
                                    if (isCall) {
                                        mb.sameCalls++;
                                    }
                                }
                            }
                            if (idxs.length) {
                                thisFallbackHits.push({ file: f, site: lineOf(sf, s3), owner: ownerName, member: n.text, rows: idxs });
                            }
                        }
                    }
                }
            } else if (ts.isStringLiteralLike(n) && (candNames.has(n.text) || (n.parent && ts.isElementAccessExpression(n.parent) && memberNames.has(n.text)))) {
                const reflective = !!(n.parent && ts.isElementAccessExpression(n.parent));
                if (candNames.has(n.text)) {
                    for (const i of candIdx) {
                        if (finalizedExports[i].name !== n.text) {
                            continue;
                        }
                        const b = getB(i);
                        bump(b.string, f + (reflective ? ' [element-access]' : ' [literal]'));
                        if (reflective) {
                            bump(b.reflect, f);
                        }
                    }
                }
                if (reflective && memberNames.has(n.text)) {
                    let counted = false;
                    try {
                        const msym = resolveAlias(checker.getSymbolAtLocation(n));
                        const mdk = declKeyOf(msym);
                        const mr = mdk ? memberSymDecl.get(mdk) : undefined;
                        if (mr) {
                            const gp = n.parent?.parent;
                            const litCall = !!gp && (ts.isCallExpression(gp) || ts.isNewExpression(gp)) && gp.expression === n.parent;
                            let le: ts.Expression | undefined = ts.isElementAccessExpression(n.parent) ? n.parent.expression : undefined;
                            while (le && (ts.isPropertyAccessExpression(le) || ts.isElementAccessExpression(le))) {
                                le = le.expression;
                            }
                            const litNs = !!le && ts.isIdentifier(le) && (nsLocals.get(f) ?? new Set()).has(le.text);
                            for (const j of mr) {
                                const b = getMB(j);
                                countInto(b, f, tflag, false, false, litCall, litNs);
                            }
                            counted = true;
                        }
                    } catch {
                        /* fall through to name-based */
                    }
                    if (!counted) {
                        for (const j of memberIdxByName.get(n.text) ?? []) {
                            const b = getMB(j);
                            bump(b.string, f + ' [element-access]');
                            bump(b.reflect, f);
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }

    const exportRowsByDeclKey = new Map<string, number[]>();
    for (let index = 0; index < rowDeclKeys.length; index++) {
        for (const key of rowDeclKeys[index]) {
            if (!exportRowsByDeclKey.has(key)) {
                exportRowsByDeclKey.set(key, []);
            }
            exportRowsByDeclKey.get(key)!.push(index);
        }
    }
    const candidateIndexSet = new Set(candIdx);
    const conduitRowsFor = (declarationKey: string | null): number[] => (declarationKey ? (exportRowsByDeclKey.get(declarationKey) ?? []) : []);
    const starBy: Record<string, Set<string>> = {};
    const addStar = (ownerFile: string, fromFile: string): void => {
        (starBy[ownerFile] ??= new Set()).add(fromFile);
    };
    const conduitEvidence: ConduitRecord[] = [];
    const conduitExportRows = new Set<number>();
    for (const cd of conduits) {
        const targetFile = resolveConduit(cd.file, cd.source);
        const targetSourceFile = targetFile ? program.getSourceFile(join(ROOT, targetFile)) : undefined;
        let targets: ModuleExportTarget[] = [];
        if (targetSourceFile) {
            targets = moduleExportTargets({
                checker,
                sourceFile: targetSourceFile,
                resolveAlias: s => resolveAlias(s) ?? s,
                declKeyOf,
                sourceName: cd.kind === 're-export' ? (cd.name ?? null) : null
            });
        }
        const rowIndexes = new Set<number>();
        for (const target of targets) {
            for (const index of conduitRowsFor(target.declarationKey)) {
                rowIndexes.add(index);
                conduitExportRows.add(index);
                const row = finalizedExports[index];
                if (cd.kind === 'star') {
                    addStar(target.ownerFile ?? row.file, cd.file);
                    addStar(row.file, cd.file);
                }
                if (candidateIndexSet.has(index)) {
                    bump(getB(index).reexport, cd.file);
                }
            }
        }
        conduitEvidence.push({
            ...cd,
            target: targetFile,
            resolved: Boolean(targetSourceFile),
            exports: targets.map(({ exportName, declarationKey, ownerFile }) => ({ exportName, declarationKey, ownerFile })),
            mappedRows: [...rowIndexes].map(index => ({ name: finalizedExports[index].name, file: finalizedExports[index].file, kind: finalizedExports[index].kind }))
        });
    }
    const conduitsJson: ConduitsJson = {
        total: conduits.length,
        resolved: conduitEvidence.filter(record => record.resolved).length,
        unresolved: conduitEvidence.filter(record => !record.resolved).length,
        mappedRows: conduitExportRows.size,
        records: conduitEvidence
    };
    const allowHits: Record<string, boolean> = {};
    try {
        const allowRaw = readFileSync(join(ROOT, 'packages/rs2b0t-api/contract-allowlist.json'), 'utf8');
        for (const i of candIdx) {
            if (new RegExp(`\\b${finalizedExports[i].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(allowRaw)) {
                allowHits[finalizedExports[i].name] = true;
            }
        }
    } catch {
        /* no allowlist file */
    }

    const candidates: CandidateRow[] = candIdx.map(i => {
        const c = finalizedExports[i];
        const b = buckets.get(i) ?? newRefBucket();
        const regFiles = [...Object.keys(b.src), ...Object.keys(b.test), ...Object.keys(b.tools), ...Object.keys(b.string), ...Object.keys(b.reexport)].filter(file => REG_FILES.has(file.split(' [')[0]));
        const registration = regFiles.length > 0 || allowHits[c.name] === true;
        const nsFiles = Object.keys(b.nsf);
        return {
            name: c.name,
            file: c.file,
            line: c.line,
            kind: c.kind,
            publishedVia: c.publishedVia,
            nameCollision: c.nameCollision,
            abiKey: c.abiKey,
            group: classifyExportGroup(b, b.sameV, b.sameT),
            registration,
            heldByAbi: Object.keys(b.src).includes('src/bot/runtime/abi.ts'),
            valueSrcFiles: Object.keys(b.src).length,
            valueSrcRefs: sum(b.src),
            valueTestFiles: Object.keys(b.test).length,
            valueTestRefs: sum(b.test),
            valueToolsFiles: Object.keys(b.tools).length,
            valueToolsRefs: sum(b.tools),
            callsSrc: b.calls.src,
            callsTest: b.calls.test,
            callsTools: b.calls.tools,
            sameFileValue: b.sameV,
            sameFileType: b.sameT,
            sameFileCalls: b.sameCalls,
            nsFiles,
            typeExtFiles: Object.keys(b.type).length,
            reexportFiles: Object.keys(b.reexport).length,
            heritageFiles: Object.keys(b.heritage).length,
            stringFiles: Object.keys(b.string).length,
            files: { src: b.src, test: b.test, tools: b.tools, type: b.type, heritage: b.heritage, reexport: b.reexport, string: b.string, reflect: b.reflect, ns: Object.fromEntries(nsFiles.map(file => [file, 1])) },
            starReexportedBy: [...(starBy[c.file] ?? [])]
        };
    });

    const ownerTop = new Map<string, { xrefs: number; held: boolean; pub: boolean; disp: boolean }>();
    const oent = (k: string): { xrefs: number; held: boolean; pub: boolean; disp: boolean } => {
        let e = ownerTop.get(k);
        if (!e) {
            e = { xrefs: 0, held: false, pub: false, disp: false };
            ownerTop.set(k, e);
        }
        return e;
    };
    for (const r of candidates) {
        const e = oent(r.file + ':' + r.name);
        e.xrefs += r.valueSrcFiles + r.valueTestFiles + r.valueToolsFiles;
        if (r.heldByAbi) {
            e.held = true;
        }
        if (starBy[r.file]?.size) {
            e.disp = true;
        }
    }
    for (const e of finalizedExports) {
        if (e.published) {
            oent(e.file + ':' + e.name).pub = true;
        }
    }
    for (const index of conduitExportRows) {
        const e = finalizedExports[index];
        if (['const', 'class', 'let', 'var'].includes(e.kind)) {
            oent(e.file + ':' + e.name).disp = true;
        }
    }

    const members: MemberOutRow[] = memberRows.map((r, j) => {
        const b = mbuckets.get(j) ?? newRefBucket();
        const status = r.publishedPair ? 'published' : r.hook ? 'retained-hook' : r.overridesPublished ? 'retained-override' : r.retainedDispatch ? 'retained-dispatch' : 'candidate';
        let group: string = status === 'candidate' ? classifyExportGroup(b, b.sameV, b.sameT) : status;
        const dynOwner = dynamicOwners.has(r.file + ':' + r.owner) || ownerDynByType.has(r.file + ':' + r.owner);
        if (status === 'candidate' && group === 'G0-noref' && dynOwner) {
            group = 'GX-dynamic';
        }
        const docsHoldHit = DOCS_HOLD_MEMBERS.find(d => d.owner === r.owner && d.member === r.member && d.file === r.file && d.exportFile === (r.exportFile ?? r.file));
        const hasXFileValue = Object.keys(b.src).length + Object.keys(b.test).length + Object.keys(b.tools).length > 0;
        const docsHoldActive = status === 'candidate' && docsHoldHit && !hasXFileValue;
        let structuralWhy: string | null = null;
        if (status === 'candidate' && r.okind === 'object' && (group === 'G0-noref' || group === 'G1-samefile' || group === 'GX-unresolved')) {
            const okey = (r.exportFile ?? r.file) + ':' + r.owner;
            const why: string[] = [];
            if (ownerAnnotated.has(okey)) {
                why.push('annotated');
            }
            const t = ownerTop.get(okey);
            if (t) {
                if (t.xrefs > 0) {
                    why.push('owner-refs');
                }
                if (t.held) {
                    why.push('heldByAbi');
                }
                if (t.pub) {
                    why.push('published-owner');
                }
                if (t.disp) {
                    why.push('reexport');
                }
            }
            if (why.length) {
                group = 'GX-structural';
                structuralWhy = why.join('+');
            }
        }
        const owTop = ownerTop.get((r.exportFile ?? r.file) + ':' + r.owner);
        return {
            owner: r.owner,
            member: r.member,
            file: r.file,
            line: r.line,
            mkind: r.mkind,
            static: r.static,
            prot: r.prot,
            via: r.via ?? (r.file.startsWith('src/bot/api/') ? 'api' : docHeldOwnerKeys.has((r.exportFile ?? r.file) + ':' + r.owner) ? 'doc-held' : 'abi-installed'),
            exportFile: r.exportFile ?? r.file,
            cls: r.cls ?? null,
            okind: r.okind ?? null,
            structuralWhy,
            ownerXrefs: owTop ? owTop.xrefs : 0,
            status,
            group,
            retainedWhy: r.retainedWhy,
            docsHold: docsHoldHit && docsHoldActive ? docsHoldHit.why : null,
            valueSrcFiles: Object.keys(b.src).length,
            valueSrcRefs: sum(b.src),
            valueTestFiles: Object.keys(b.test).length,
            valueTestRefs: sum(b.test),
            valueToolsFiles: Object.keys(b.tools).length,
            valueToolsRefs: sum(b.tools),
            callsSrc: b.calls.src,
            callsTest: b.calls.test,
            callsTools: b.calls.tools,
            sameFileValue: b.sameV,
            sameFileType: b.sameT,
            sameFileCalls: b.sameCalls,
            nsFiles: Object.keys(b.nsf),
            typeExtFiles: Object.keys(b.type).length,
            stringFiles: Object.keys(b.string).length,
            dynOwner,
            files: { src: b.src, test: b.test, tools: b.tools, type: b.type, heritage: b.heritage, string: b.string, reflect: b.reflect }
        };
    });

    const thisFallback = {
        root: ROOT,
        tsconfig: rel(tsconfigPath),
        strict: programOptions.strict,
        noImplicitThis: programOptions.noImplicitThis ?? '(default via strict:true)',
        hits: thisFallbackHits,
        note: 'Bound-object this-fallback audit: every hit is a `this.m` site the checker did not attribute. 0 hits on a strict tree = checker path complete.'
    };

    const integrated = integrateCensus({
        scope,
        exportRows: finalizedExports,
        candidates,
        members,
        conduits: conduitsJson
    });

    const groups: Record<string, number> = {};
    for (const r of candidates) {
        groups[r.group] = (groups[r.group] ?? 0) + 1;
    }
    const memberGroups: Record<string, number> = {};
    for (const r of members) {
        memberGroups[r.status + ':' + r.group] = (memberGroups[r.status + ':' + r.group] ?? 0) + 1;
    }
    const mappedBindings = [...symMap.values()].reduce((n, rows) => n + rows.length, 0);

    if (writeArtifacts && OUT) {
        writeJson(OUT, 'scope.json', scope);
        writeJson(OUT, 'program-options.json', programOptionsJson);
        writeJson(OUT, 'published.json', publishedJson);
        writeFileSync(join(OUT, 'exports.jsonl'), finalizedExports.map(r => JSON.stringify(r)).join('\n') + (finalizedExports.length ? '\n' : ''));
        writeFileSync(join(OUT, 'candidates.jsonl'), candidates.map(r => JSON.stringify(r)).join('\n') + (candidates.length ? '\n' : ''));
        const csv = [
            'name,file,line,kind,publishedVia,abiKey,collision,group,registration,heldByAbi,srcFiles,srcRefs,srcCalls,testFiles,testRefs,testCalls,toolsFiles,toolsCalls,sameV,sameCalls,sameT,nsFiles,typeFiles,reexpFiles,heritFiles,strFiles,srcList,testList,toolsList,nsList,typeList,strList'
        ];
        for (const r of candidates) {
            csv.push(
                [
                    r.name,
                    r.file,
                    r.line,
                    r.kind,
                    r.publishedVia,
                    r.abiKey,
                    r.nameCollision,
                    r.group,
                    r.registration,
                    r.heldByAbi,
                    r.valueSrcFiles,
                    r.valueSrcRefs,
                    r.callsSrc,
                    r.valueTestFiles,
                    r.valueTestRefs,
                    r.callsTest,
                    r.valueToolsFiles,
                    r.callsTools,
                    r.sameFileValue,
                    r.sameFileCalls,
                    r.sameFileType,
                    r.nsFiles.length,
                    r.typeExtFiles,
                    r.reexportFiles,
                    r.heritageFiles,
                    r.stringFiles,
                    csvCell(r.files.src),
                    csvCell(r.files.test),
                    csvCell(r.files.tools),
                    (r.nsFiles.join(';') || '').replace(/,/g, '|'),
                    csvCell(r.files.type),
                    csvCell(r.files.string)
                ].join(',')
            );
        }
        writeFileSync(join(OUT, 'candidates.csv'), csv.join('\n') + '\n');
        writeFileSync(join(OUT, 'api-members.jsonl'), members.map(r => JSON.stringify(r)).join('\n') + (members.length ? '\n' : ''));
        const mcsv = ['owner,member,file,line,mkind,status,group,okind,structuralWhy,ownerXrefs,srcFiles,srcRefs,srcCalls,testFiles,testRefs,testCalls,toolsFiles,toolsCalls,sameV,sameCalls,sameT,nsFiles,typeFiles,strFiles,dynOwner'];
        for (const r of members) {
            mcsv.push(
                [
                    r.owner,
                    r.member,
                    r.file,
                    r.line,
                    r.mkind,
                    r.status,
                    r.group,
                    r.okind,
                    r.structuralWhy,
                    r.ownerXrefs,
                    r.valueSrcFiles,
                    r.valueSrcRefs,
                    r.callsSrc,
                    r.valueTestFiles,
                    r.valueTestRefs,
                    r.callsTest,
                    r.valueToolsFiles,
                    r.callsTools,
                    r.sameFileValue,
                    r.sameFileCalls,
                    r.sameFileType,
                    r.nsFiles.length,
                    r.typeExtFiles,
                    r.stringFiles,
                    r.dynOwner
                ].join(',')
            );
        }
        writeFileSync(join(OUT, 'api-members.csv'), mcsv.join('\n') + '\n');
        writeJson(OUT, 'conduits.json', conduitsJson);
        writeJson(OUT, 'this-fallback.json', thisFallback);
        writeJson(OUT, 'integrated.json', integrated);
    }

    return {
        scope,
        programOptions: programOptionsJson,
        published: publishedJson,
        exportRows: finalizedExports,
        candidates,
        members,
        conduits: conduitsJson,
        thisFallback,
        integrated,
        summary: {
            scopeFiles: scopeFiles.length,
            consumerFiles: consumerFiles.length,
            exportRows: finalizedExports.length,
            publishedRows: finalizedExports.length - candIdx.length,
            conduits: conduits.length,
            candidates: candidates.length,
            groups,
            memberRows: members.length,
            memberGroups,
            thisFallback: thisFallbackHits.length,
            dtsCollisions: dtsOnlyDecisions.length,
            mappedBindings
        }
    };
}
