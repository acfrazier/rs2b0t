import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import IfType from '#/client/config/IfType.js';
import JagFile from '#/client/io/JagFile.js';
import { CLIENT_VERSION } from '#/client/io/ClientProt.js';

import { IF_IDS } from '#/bot/data/ifIds.js';

import { skipUnless } from '../../lib/skipUnless.js';
import {
    decodeInterfaceArchive,
    loadInterfaceSnapshot,
    readCacheBundleArchive,
    type SnapshotComponent
} from './interfaceSnapshot.js';

function constantOf(packName: string): string {
    return packName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function rowFields(component: IfType): Omit<SnapshotComponent, 'id'> {
    return {
        layerId: component.layerId,
        type: component.type,
        buttonType: component.buttonType,
        buttonText: component.buttonText,
        text: component.text,
        text2: component.text2,
        ops: component.iop === null ? null : Array.from(component.iop),
        width: component.width,
        height: component.height,
        children: component.children === null ? null : [...component.children],
        clientCode: component.clientCode,
        hide: component.hide,
        objOps: component.objOps
    };
}

describe('replay interface snapshot provenance', () => {
    test('the snapshot is the committed revision and every pack name matches the generated table', () => {
        const snapshot = loadInterfaceSnapshot();
        expect(snapshot.format).toBe(1);
        expect(snapshot.revision).toBe(CLIENT_VERSION);
        expect(snapshot.interfaceSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(snapshot.source.recording).toMatch(/^377\/.+\.jsonl$/);

        const index = JSON.parse(readFileSync('test/io/recordings/index.json', 'utf8')) as {
            recordings: { file: string; cacheSha256: string; revision: number }[];
        };
        const entry = index.recordings.find(candidate => candidate.file === snapshot.source.recording);
        expect(entry?.cacheSha256).toBe(snapshot.source.cacheSha256);
        expect(entry?.revision).toBe(snapshot.revision);

        for (const [name, id] of Object.entries(snapshot.names)) {
            expect(id).toBe(IF_IDS[constantOf(name) as keyof typeof IF_IDS]);
            expect(snapshot.components[String(id)]).toBeDefined();
        }
        expect(Object.keys(snapshot.names)).toHaveLength(49);
    });
});

describe.skipIf(skipUnless('cache-bundle'))('replay interface snapshot against the recorded cache', () => {
    test('the committed rows and hash equal the cache bundle the recording replays', () => {
        const snapshot = loadInterfaceSnapshot();
        const bytes = readCacheBundleArchive(process.env.RS2B0T_CACHE_BUNDLE!, snapshot.source.cacheSha256);
        const decoded = decodeInterfaceArchive(bytes);
        expect(decoded.sha256).toBe(snapshot.interfaceSha256);

        const original = IfType.list;
        try {
            IfType.init(new JagFile(bytes), null, []);
            for (const row of Object.values(snapshot.components)) {
                const live = IfType.list[row.id];
                expect(live).toBeDefined();
                expect(rowFields(live!)).toEqual({
                    layerId: row.layerId,
                    type: row.type,
                    buttonType: row.buttonType,
                    buttonText: row.buttonText,
                    text: row.text,
                    text2: row.text2,
                    ops: row.ops,
                    width: row.width,
                    height: row.height,
                    children: row.children,
                    clientCode: row.clientCode,
                    hide: row.hide,
                    objOps: row.objOps
                });
            }
        } finally {
            IfType.list = original;
        }
    });
});
