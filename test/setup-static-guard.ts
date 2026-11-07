import { afterEach } from 'bun:test';
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
