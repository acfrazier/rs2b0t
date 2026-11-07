import { afterAll, afterEach, beforeEach } from 'bun:test';
import { types } from 'node:util';

import FloType from '#/client/config/FloType.js';
import IdkType from '#/client/config/IdkType.js';
import IfType from '#/client/config/IfType.js';
import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import ObjType from '#/client/config/ObjType.js';
import SeqType from '#/client/config/SeqType.js';
import SpotType from '#/client/config/SpotType.js';
import VarBitType from '#/client/config/VarBitType.js';
import VarpType from '#/client/config/VarpType.js';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

// Why: bun runs every test file in one process, and stubs of LocType.list, NpcType.list and SeqType.list left for the rest of the run failed the 377 decoder tests on the hosted runner's file order.
// A test may stub a config static only if it restores it by the end of the test; init() loading decoded data passes every check.

interface ConfigStatics {
    list: unknown;
    numDefinitions?: number;
    idx?: Int32Array | null;
    codeCount?: number;
    codeIds?: Int32Array | null;
}

type ConfigClass = (abstract new (...args: never[]) => unknown) & ConfigStatics;

const LOOKUP_TYPES: ConfigClass[] = [LocType, NpcType, ObjType];
const ARRAY_TYPES: ConfigClass[] = [FloType, IdkType, IfType, SeqType, SpotType, VarBitType, VarpType];
const RESET_KEYS = ['list', 'numDefinitions', 'idx', 'dat', 'recent', 'recentPos', 'datEnd', 'codeCount', 'codeIds'] as const;

const lookupOriginal = new Map(LOOKUP_TYPES.map(type => [type, type.list]));
const baseline = new Map(
    [...LOOKUP_TYPES, ...ARRAY_TYPES].map(type => [type, RESET_KEYS.filter(key => Object.hasOwn(type, key)).map(key => [key, Object.getOwnPropertyDescriptor(type, key)!] as const)])
);

function lookupProblem(type: ConfigClass): string | null {
    if (type.list !== lookupOriginal.get(type)) {
        return `${type.name}.list is replaced`;
    }
    // init() sets numDefinitions and idx together; a stub that set only numDefinitions makes later lookups index past idx.
    if (type.numDefinitions !== (type.idx?.length ?? 0)) {
        return `${type.name}.numDefinitions (${type.numDefinitions}) does not match its loaded index (${type.idx?.length ?? 0})`;
    }
    return null;
}

function arrayProblem(type: ConfigClass): string | null {
    const list = type.list;
    if (!Array.isArray(list) || types.isProxy(list)) {
        return `${type.name}.list is not a decoded array`;
    }
    if (type.numDefinitions !== undefined && list.length !== type.numDefinitions) {
        return `${type.name}.list has ${list.length} entries but numDefinitions is ${type.numDefinitions}`;
    }
    for (const entry of list) {
        if (entry !== null && entry !== undefined && !(entry instanceof type)) {
            return `${type.name}.list holds an entry that is not a ${type.name}`;
        }
    }
    if (type.codeCount !== undefined && !(type.codeIds === null ? type.codeCount === 0 : type.codeIds?.length === type.numDefinitions)) {
        return `${type.name}.codeIds/codeCount do not match its loaded definitions`;
    }
    return null;
}

function restore(type: ConfigClass): void {
    for (const [key, descriptor] of baseline.get(type)!) {
        // Every baseline array is the empty pre-init list; a fresh one keeps a test that mutated the old one in place from leaking it.
        const value: unknown = Array.isArray(descriptor.value) ? [] : descriptor.value;
        Object.defineProperty(type, key, { ...descriptor, value });
    }
}

afterEach(() => {
    const problems: string[] = [];
    for (const type of LOOKUP_TYPES) {
        const problem = lookupProblem(type);
        if (problem !== null) {
            problems.push(problem);
            restore(type);
        }
    }
    for (const type of ARRAY_TYPES) {
        const problem = arrayProblem(type);
        if (problem !== null) {
            problems.push(problem);
            restore(type);
        }
    }
    if (problems.length > 0) {
        // Restored first (to the pre-init state), so one bad test fails alone instead of breaking every later file.
        throw new Error(`this test left config statics stubbed: ${problems.join('; ')}; save the original and restore it in afterEach or a finally block`);
    }
});

// Why: a describe-scope Execution.delayUntil stub and per-test ChatDialog stubs outlived their files, so every later file polled a fake scheduler.
// A test file may stub these singletons for one test or for all of its tests, but must restore them before the next file starts.
const SHARED_METHODS = { reader, actions, Bank, Banking, ChatDialog, Execution, Game, Locs, Npcs, Traversal };
const SHARED_DATA = { QuestFood, QuestLoadout };

interface Tracked {
    label: string;
    owner: object;
    key: string;
    value: unknown;
}

const tracked: Tracked[] = [
    ...Object.entries(SHARED_METHODS).flatMap(([name, owner]) =>
        Object.keys(owner)
            .filter(key => typeof Reflect.get(owner, key) === 'function')
            .map(key => ({ label: `${name}.${key}`, owner, key, value: Reflect.get(owner, key) }))
    ),
    ...Object.entries(SHARED_DATA).flatMap(([name, owner]) => Object.keys(owner).map(key => ({ label: `${name}.${key}`, owner, key, value: Reflect.get(owner, key) })))
];

let lastSeen = tracked.map(entry => entry.value);
let lastFile = '';
let cacheSize = 0;
const seenFiles = new Set<string>();

// Bun adds each test file to require.cache when it loads the file, which happens after the previous file's afterAll hooks.
function startedFile(): string | null {
    const keys = Object.keys(require.cache);
    if (keys.length === cacheSize) {
        return null;
    }
    cacheSize = keys.length;
    const fresh = keys.filter(key => /\.test\.[cm]?[jt]sx?$/.test(key) && !seenFiles.has(key));
    fresh.forEach(key => seenFiles.add(key));
    return fresh.at(-1) ?? null;
}

// A value still replaced and identical to the one the previous file's last test ended with was left behind by that file; a new file's own module-scope stub is a fresh value.
function failLeaks(culprit: string): void {
    const leaked = tracked.filter((entry, i) => {
        const now = Reflect.get(entry.owner, entry.key);
        return now !== entry.value && now === lastSeen[i];
    });
    if (leaked.length === 0) {
        return;
    }
    // Restored first, so the leak fails once instead of steering every later file.
    for (const entry of leaked) {
        Reflect.set(entry.owner, entry.key, entry.value);
    }
    throw new Error(`${culprit} left ${leaked.map(entry => entry.label).join(', ')} replaced after its last test; restore it in afterEach or afterAll`);
}

afterEach(() => {
    lastSeen = tracked.map(entry => Reflect.get(entry.owner, entry.key));
});

beforeEach(() => {
    const file = startedFile();
    if (file === null) {
        return;
    }
    const previous = lastFile;
    lastFile = file.replace(`${process.cwd()}/`, '');
    if (previous !== '') {
        failLeaks(previous);
    }
});

afterAll(() => {
    failLeaks(lastFile);
});
