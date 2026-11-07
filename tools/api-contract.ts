#!/usr/bin/env bun
// Compare the runtime ABI with index.d.ts for each index.js export; --check fails on drift.
// The publication ledger is a must-exist hold list. Extra runtime members are not published by installation.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const ABI_FILE = 'src/bot/runtime/abi.ts';
const DTS_FILE = 'packages/rs2b0t-api/index.d.ts';
const JS_FILE = 'packages/rs2b0t-api/index.js';
const ALLOWLIST_FILE = 'packages/rs2b0t-api/contract-allowlist.json';
const READER_FILE = 'src/bot/adapter/ClientAdapter.ts';

export interface Member {
    type: string;
    optional: boolean;
}
/** Members by name; null for functions, arrays and primitives. */
export type Members = Map<string, Member> | null;
export type Surface = Map<string, Members>;

export type DriftKind =
    | 'undeclared-export'
    | 'phantom-export'
    | 'missing-at-runtime'
    | 'undeclared-member'
    | 'phantom-member'
    | 'missing-protected-hook'
    | 'missing-overload'
    | 'missing-type-only'
    | 'missing-extra-root'
    | 'missing-reader-method'
    | 'missing-docs-held';
export interface Drift {
    kind: DriftKind;
    export: string;
    member?: string;
    signature?: string;
}

export const TYPE_ONLY_HOLDS = [
    'AcquireWorld',
    'BankDestination',
    'BankItemSnapshot',
    'BankLocation',
    'BankObjectAccess',
    'BankOpenRoute',
    'BankRequirement',
    'BankStrategy',
    'BankTriggerState',
    'BotManifest',
    'BotManifestInput',
    'ChatLine',
    'CombatModeLabel',
    'CombatStyleResolution',
    'CowLocation',
    'EventMap',
    'FishingGearBuyPlan',
    'FishingGearPiece',
    'FishingLocation',
    'FishingMethod',
    'FishingVendorNear',
    'GatheringLocation',
    'Interactable',
    'ItemNeed',
    'ItemSource',
    'Locatable',
    'LoopCadence',
    'MeleeCombatStyle',
    'MiningLocation',
    'OpenBankOpts',
    'PickpocketTarget',
    'PlanFishingGearOpts',
    'QuestStatus',
    'RuneRoute',
    'RuneType',
    'SettingDef',
    'SettingType',
    'SettingsBag',
    'SettingsSchema',
    'ShopOffer',
    'Task',
    'ToolAcquireMode',
    'ToolAcquirePlan',
    'ToolReq',
    'ToolRestockStep',
    'ToolTier',
    'ToolVendor',
    'TradeItem',
    'TreeNode',
    'WalkDestination',
    'WalkOptions',
    'WalkResilientOptions',
    'WoodcuttingLocation',
    'WorldTile'
] as const;

export const EXTRA_ROOT_HOLDS = [
    'questLive',
    'Reachability',
    'EssenceSession',
    'Prayer',
    'Loadouts',
    'PathPublish',
    'isNavPathPaintEnabled',
    'SettingsStore',
    'KNOWN_DANGER_ZONES',
    'knownDangerZone',
    'knownDangerZoneIds',
    'resolveDangerZones',
    'tileInDangerZones',
    'BUILD_INFO'
] as const;

export const READER_METHOD_HOLDS = [
    'modalCloseObservation',
    'attached',
    'ingame',
    'sceneState',
    'worldTile',
    'serverTile',
    'hintTile',
    'mapBuildBase',
    'overlayPosWorld',
    'projectAreaGameWorld',
    'selfAnim',
    'selfAnimState',
    'selfChat',
    'energy',
    'cameraYaw',
    'cameraPitch',
    'weight',
    'skillCount',
    'skillUsed',
    'statsReady',
    'stat',
    'varp',
    'chat',
    'playerCount',
    'npcCount',
    'npcBox',
    'locBox',
    'npcs',
    'selfSlot',
    'selfFaceEntity',
    'players',
    'inCombat',
    'takingDamage',
    'locs',
    'groundItems',
    'inventory',
    'objCatalog',
    'inventorySize',
    'inventorySnapshotReady',
    'equipment',
    'bankComId',
    'bankItems',
    'bankSideItems',
    'bankSnapshotReady',
    'bankSideSnapshotReady',
    'bankSnapshotGeneration',
    'chatContinueComId',
    'chatOptions',
    'makeProducts',
    'runControls',
    'retaliateControls',
    'toWorld',
    'toLocal',
    'collisionFlags',
    'lastWalkPathWorld',
    'localPlayerName',
    'combatLevel',
    'loginMessage',
    'menuEntries',
    'modals',
    'countDialogOpen',
    'shopInv',
    'puzzleBoardComId',
    'puzzleBoard',
    'puzzleBoardSize',
    'duelOffers',
    'tradeOfferOpen',
    'tradeConfirmOpen',
    'tradeMyOffer',
    'tradeTheirOffer',
    'tradeSidePack',
    'tradePartner',
    'tradeConfirmOffers',
    'tradeConfirmReady',
    'closeButtonComId',
    'activeSideTab',
    'ifText',
    'mainModalTexts',
    'chatModalTexts',
    'ifModelObjId',
    'modalButtons',
    'buttonByText',
    'mainModalButtonNearText',
    'targetButtonByBase',
    'selectButtonByVarp',
    'selectButtonLabelsByVarp',
    'mainSkillMultiItems',
    'sideTabInterface',
    'questStatuses',
    'itemIconPixels'
] as const;

export const PROTECTED_HOOK_HOLDS = [{ owner: 'TaskBot', name: 'add', signature: 'add(...tasks: Task[]): void' }] as const;

export const OVERLOAD_HOLDS = [
    {
        owner: 'Game',
        name: 'setCombatStyle',
        signatures: ['setCombatStyle(style: MeleeCombatStyle): boolean', 'setCombatStyle(mode: number): boolean']
    }
] as const;

export const PAINT_FRAME_WIDGET_HOLDS = ['title', 'tabs', 'text', 'row', 'cells', 'wrap', 'list', 'fill', 'grid', 'bar', 'buttons', 'select', 'stepper', 'gap', 'cols', 'end'] as const;

export interface DocsHold {
    file: string;
    owner: string;
    members: readonly string[];
}

export const DOCS_HELD: readonly DocsHold[] = [
    { file: 'src/bot/paint/Paint.ts', owner: 'Paint', members: ['begin'] },
    { file: 'src/bot/paint/Paint.ts', owner: 'PaintFrame', members: PAINT_FRAME_WIDGET_HOLDS },
    { file: 'src/bot/paint/paintLogic.ts', owner: 'paintState', members: [] },
    { file: 'src/bot/runtime/RunManager.ts', owner: 'RunManager', members: ['override'] },
    { file: 'src/bot/api/prayer/Prayer.ts', owner: 'Prayer', members: ['points', 'max', 'full', 'known', 'available', 'active', 'set', 'clear'] },
    { file: 'src/bot/event/webwalk/essenceSession.ts', owner: 'EssenceSession', members: ['noteEntry', 'noteEntryFromNpc'] },
    { file: 'src/bot/runtime/buildInfo.ts', owner: 'BUILD_INFO', members: [] },
    { file: 'src/bot/api/altar/Altars.ts', owner: 'nearestAltar', members: [] },
    { file: 'src/bot/geometry/Area.ts', owner: 'Area', members: ['rectangular', 'circular'] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'parsePartnerList', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'isConfiguredPartner', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'decideReceiverOfferScreen', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'decideGiverOfferScreen', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'parseMuleMode', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'muleGathererHandoffActive', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'muleReceiverActive', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'muleCookerActive', members: [] },
    { file: 'src/bot/api/trade/PartnerTrade.ts', owner: 'muleSupplierActive', members: [] },
    { file: 'src/bot/data/cookingRanges.ts', owner: 'COOKING_RANGE_LOCS', members: [] },
    { file: 'src/bot/data/cookingRanges.ts', owner: 'nearestCookingRange', members: [] },
    { file: 'src/bot/data/cookingRanges.ts', owner: 'cookSurfaceForFishCamp', members: [] },
    { file: 'src/bot/data/cookingRanges.ts', owner: 'resolveFishCampCookSurface', members: [] },
    { file: 'src/bot/data/cookingRanges.ts', owner: 'FISH_CAMP_COOK_PLANS', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'LocRef', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'locPlacementKey', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'locRefFromTransport', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'locRefFromDoor', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'matchesLocRef', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'LocSceneSnap', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'probeLocRef', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'locRefValid', members: [] },
    { file: 'src/bot/event/webwalk/locRef.ts', owner: 'locRefStale', members: [] }
];

export interface PublicationSources {
    dts: string;
    abi: string;
    reader: string;
    files: Readonly<Record<string, string>>;
}

function hidden(sym: ts.Symbol): boolean {
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

function member(checker: ts.TypeChecker, sym: ts.Symbol, at: ts.Node): Member {
    return {
        type: checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, at), at, ts.TypeFormatFlags.NoTruncation),
        optional: (sym.flags & ts.SymbolFlags.Optional) !== 0
    };
}

function membersOfType(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): Members {
    const out = new Map<string, Member>();
    const ctor = type.getConstructSignatures()[0];
    if (ctor) {
        for (const m of checker.getPropertiesOfType(ctor.getReturnType())) {
            if (!hidden(m)) {
                out.set(m.getName(), member(checker, m, at));
            }
        }
        for (const m of checker.getPropertiesOfType(type)) {
            if (!hidden(m)) {
                out.set(`static ${m.getName()}`, member(checker, m, at));
            }
        }
        return out;
    }
    if (type.getCallSignatures().length > 0 || checker.isArrayLikeType(type)) {
        return null;
    }
    const props = checker.getPropertiesOfType(type);
    if (props.length === 0) {
        return null;
    }
    for (const m of props) {
        if (!hidden(m)) {
            out.set(m.getName(), member(checker, m, at));
        }
    }
    return out;
}

function compilerOptions(): ts.CompilerOptions {
    const cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
    return { ...ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options, noEmit: true, skipLibCheck: true };
}

export function runtimeSurface(): Surface {
    const program = ts.createProgram([ABI_FILE], compilerOptions());
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(ABI_FILE);
    if (!source) {
        throw new Error(`${ABI_FILE} did not load`);
    }
    let literal: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'abi' &&
            node.initializer &&
            ts.isCallExpression(node.initializer) &&
            node.initializer.arguments[0] &&
            ts.isObjectLiteralExpression(node.initializer.arguments[0])
        ) {
            literal = node.initializer.arguments[0];
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    if (!literal) {
        throw new Error(`${ABI_FILE}: no \`const abi = Object.freeze({...})\` found`);
    }
    const surface: Surface = new Map();
    for (const prop of checker.getPropertiesOfType(checker.getTypeAtLocation(literal))) {
        surface.set(prop.getName(), membersOfType(checker, checker.getTypeOfSymbolAtLocation(prop, literal), literal));
    }
    return surface;
}

export function declaredSurface(): Surface {
    const program = ts.createProgram([DTS_FILE], compilerOptions());
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(DTS_FILE);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!source || !moduleSymbol) {
        throw new Error(`${DTS_FILE} did not load as a module`);
    }
    const surface: Surface = new Map();
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
        if (!(resolved.flags & ts.SymbolFlags.Value)) {
            continue;
        }
        surface.set(sym.getName(), membersOfType(checker, checker.getTypeOfSymbolAtLocation(resolved, source), source));
    }
    return surface;
}

export function packageExports(js = readFileSync(JS_FILE, 'utf8')): string[] {
    const block = /export const \{([\s\S]*?)\} = abi;/.exec(js);
    if (!block) {
        throw new Error(`${JS_FILE}: no \`export const { ... } = abi\` block`);
    }
    return block[1]
        .split('\n')
        .map(l => l.replace(/\/\/.*$/, '').trim())
        .join(',')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

export function compare(runtime: Surface, declared: Surface, exports: readonly string[], allow: ReadonlySet<string> = new Set()): Drift[] {
    const drifts: Drift[] = [];
    const add = (d: Drift): void => {
        const key = d.member ? `${d.export}.${d.member}` : d.export;
        if (!allow.has(key)) {
            drifts.push(d);
        }
    };
    for (const name of exports) {
        const rt = runtime.get(name);
        const dc = declared.get(name);
        if (rt === undefined) {
            add({ kind: 'missing-at-runtime', export: name });
            continue;
        }
        if (dc === undefined) {
            add({ kind: 'undeclared-export', export: name });
            continue;
        }
        if (!rt || !dc) {
            continue;
        }
        for (const [name_, m] of rt) {
            if (!dc.has(name_)) {
                add({ kind: 'undeclared-member', export: name, member: name_, signature: m.type });
            }
        }
        for (const [name_, m] of dc) {
            if (!rt.has(name_) && !m.optional) {
                add({ kind: 'phantom-member', export: name, member: name_ });
            }
        }
    }
    const exported = new Set(exports);
    for (const name of declared.keys()) {
        if (!exported.has(name)) {
            add({ kind: 'phantom-export', export: name });
        }
    }
    return drifts;
}

export function allowlist(): Set<string> {
    try {
        return new Set(Object.keys(JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8')) as Record<string, string>));
    } catch {
        return new Set();
    }
}

function parse(text: string, fileName: string): ts.SourceFile {
    return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function exported(node: ts.Node): boolean {
    return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function ident(name: ts.Node | undefined): string | null {
    return name && ts.isIdentifier(name) ? name.text : null;
}

function normSig(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/\b(?:export|declare|public|protected|private|static|abstract|async|readonly)\b/g, '')
        .replace(/\s+/g, ' ')
        .replace(/;?\s*$/, '')
        .trim();
}

function signatureOf(node: ts.Node, source: ts.SourceFile): string {
    return normSig(node.getText(source));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === kind);
}

function objectNames(expr: ts.ObjectLiteralExpression): string[] {
    const names: string[] = [];
    for (const prop of expr.properties) {
        if (ts.isSpreadAssignment(prop)) {
            continue;
        }
        const name = ident(prop.name);
        if (name) {
            names.push(name);
        }
    }
    return names;
}

function addMember(members: Map<string, Set<string>>, owner: string, name: string): void {
    const set = members.get(owner) ?? new Set<string>();
    set.add(name);
    members.set(owner, set);
}

function classLikeMembers(node: ts.ClassDeclaration | ts.InterfaceDeclaration, members: Map<string, Set<string>>): void {
    const owner = ident(node.name);
    if (!owner) {
        return;
    }
    for (const memberNode of node.members) {
        if (ts.isConstructorDeclaration(memberNode)) {
            continue;
        }
        const name = ident(memberNode.name);
        if (name) {
            addMember(members, owner, name);
        }
    }
}

export function typeOnlyExports(dts: string): string[] {
    const source = parse(dts, DTS_FILE);
    const names: string[] = [];
    for (const stmt of source.statements) {
        if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && exported(stmt)) {
            const name = ident(stmt.name);
            if (name) {
                names.push(name);
            }
        }
        if (ts.isExportDeclaration(stmt) && stmt.isTypeOnly && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
            for (const spec of stmt.exportClause.elements) {
                names.push(spec.name.text);
            }
        }
    }
    return names;
}

export function protectedHooks(dts: string): Array<{ owner: string; name: string; signature: string }> {
    const source = parse(dts, DTS_FILE);
    const out: Array<{ owner: string; name: string; signature: string }> = [];
    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name) {
            for (const memberNode of node.members) {
                if (!hasModifier(memberNode, ts.SyntaxKind.ProtectedKeyword)) {
                    continue;
                }
                const name = ident(memberNode.name);
                if (name) {
                    out.push({ owner: node.name.text, name, signature: signatureOf(memberNode, source) });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

export function methodOverloads(dts: string): Map<string, string[]> {
    const source = parse(dts, DTS_FILE);
    const out = new Map<string, string[]>();
    const add = (owner: string, name: string, signature: string): void => {
        const key = `${owner}.${name}`;
        const list = out.get(key) ?? [];
        list.push(signature);
        out.set(key, list);
    };
    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name) {
            for (const memberNode of node.members) {
                const name = ident(memberNode.name);
                if (name && (ts.isMethodDeclaration(memberNode) || ts.isMethodSignature(memberNode))) {
                    add(node.name.text, name, signatureOf(memberNode, source));
                }
            }
        }
        if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                const varName = ident(decl.name);
                if (varName && decl.type && ts.isTypeLiteralNode(decl.type)) {
                    for (const memberNode of decl.type.members) {
                        const name = ident(memberNode.name);
                        if (name && ts.isMethodSignature(memberNode)) {
                            add(varName, name, signatureOf(memberNode, source));
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

export function abiRootNames(abi: string): string[] {
    const source = parse(abi, ABI_FILE);
    let names: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ident(node.name) === 'abi' && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.arguments[0] && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
            names = objectNames(node.initializer.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return names;
}

export function readerMethodNames(reader: string): string[] {
    const source = parse(reader, READER_FILE);
    let names: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ident(node.name) === 'reader' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
            names = objectNames(node.initializer);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return names;
}

export function fileSurface(text: string, fileName: string): { exports: Set<string>; members: Map<string, Set<string>> } {
    const source = parse(text, fileName);
    const exports = new Set<string>();
    const members = new Map<string, Set<string>>();
    const aliases: Array<{ exportName: string; className: string }> = [];

    const addExport = (name: string | null): void => {
        if (name) {
            exports.add(name);
        }
    };

    for (const stmt of source.statements) {
        if (ts.isFunctionDeclaration(stmt) && exported(stmt)) {
            addExport(ident(stmt.name));
        }
        if ((ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && exported(stmt)) {
            addExport(ident(stmt.name));
        }
        if (ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
            classLikeMembers(stmt, members);
        }
        if (ts.isVariableStatement(stmt) && exported(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                const name = ident(decl.name);
                addExport(name);
                if (name && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
                    for (const prop of objectNames(decl.initializer)) {
                        addMember(members, name, prop);
                    }
                }
                if (name && decl.initializer && ts.isNewExpression(decl.initializer) && ts.isIdentifier(decl.initializer.expression)) {
                    aliases.push({ exportName: name, className: decl.initializer.expression.text });
                }
            }
        }
        if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
            for (const spec of stmt.exportClause.elements) {
                addExport(spec.name.text);
            }
        }
    }

    for (const alias of aliases) {
        const from = members.get(alias.className);
        if (from) {
            for (const name of from) {
                addMember(members, alias.exportName, name);
            }
        }
    }
    return { exports, members };
}

export function repoSources(): PublicationSources {
    const files: Record<string, string> = {};
    for (const hold of DOCS_HELD) {
        if (!(hold.file in files)) {
            files[hold.file] = readFileSync(hold.file, 'utf8');
        }
    }
    return {
        dts: readFileSync(DTS_FILE, 'utf8'),
        abi: readFileSync(ABI_FILE, 'utf8'),
        reader: readFileSync(READER_FILE, 'utf8'),
        files
    };
}

export function publicationDrifts(sources: PublicationSources): Drift[] {
    const drifts: Drift[] = [];
    const types = new Set(typeOnlyExports(sources.dts));
    for (const name of TYPE_ONLY_HOLDS) {
        if (!types.has(name)) {
            drifts.push({ kind: 'missing-type-only', export: name });
        }
    }

    const hooks = protectedHooks(sources.dts);
    for (const hold of PROTECTED_HOOK_HOLDS) {
        const hit = hooks.find(h => h.owner === hold.owner && h.name === hold.name && h.signature === hold.signature);
        if (!hit) {
            drifts.push({ kind: 'missing-protected-hook', export: hold.owner, member: hold.name, signature: hold.signature });
        }
    }

    const overloads = methodOverloads(sources.dts);
    for (const hold of OVERLOAD_HOLDS) {
        const have = new Set(overloads.get(`${hold.owner}.${hold.name}`) ?? []);
        for (const signature of hold.signatures) {
            if (!have.has(signature)) {
                drifts.push({ kind: 'missing-overload', export: hold.owner, member: hold.name, signature });
            }
        }
    }

    const roots = new Set(abiRootNames(sources.abi));
    for (const name of EXTRA_ROOT_HOLDS) {
        if (!roots.has(name)) {
            drifts.push({ kind: 'missing-extra-root', export: name });
        }
    }

    const reader = new Set(readerMethodNames(sources.reader));
    for (const name of READER_METHOD_HOLDS) {
        if (!reader.has(name)) {
            drifts.push({ kind: 'missing-reader-method', export: 'reader', member: name });
        }
    }

    const parsed = new Map<string, { exports: Set<string>; members: Map<string, Set<string>> }>();
    for (const hold of DOCS_HELD) {
        let surface = parsed.get(hold.file);
        if (!surface) {
            surface = fileSurface(sources.files[hold.file] ?? '', hold.file);
            parsed.set(hold.file, surface);
        }
        if (!surface.exports.has(hold.owner)) {
            drifts.push({ kind: 'missing-docs-held', export: hold.owner });
            continue;
        }
        const owned = surface.members.get(hold.owner);
        for (const memberName of hold.members) {
            if (!owned?.has(memberName)) {
                drifts.push({ kind: 'missing-docs-held', export: hold.owner, member: memberName });
            }
        }
    }
    return drifts;
}

export function report(drifts: readonly Drift[]): string {
    if (drifts.length === 0) {
        return 'api-contract: published ledger holds, and index.d.ts matches the runtime ABI over every index.js export';
    }
    const lines = [`api-contract: ${drifts.length} drift(s)`];
    for (const d of drifts) {
        const where = d.member ? `${d.export}.${d.member}` : d.export;
        lines.push(`  ${d.kind.padEnd(19)} ${where}${d.signature ? `: ${d.signature}` : ''}`);
    }
    return lines.join('\n');
}

if (import.meta.main) {
    const drifts = [...compare(runtimeSurface(), declaredSurface(), packageExports(), allowlist()), ...publicationDrifts(repoSources())];
    console.log(report(drifts));
    if (process.argv.includes('--check') && drifts.length > 0) {
        process.exit(1);
    }
}
