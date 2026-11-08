import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import IfType from '#/client/config/IfType.js';
import JagFile from '#/client/io/JagFile.js';

const SNAPSHOT_PATH = 'test/io/fixtures/if377/interfaces.json';

/** One component row captured from the replay cache bundle's interface archive. */
export interface SnapshotComponent {
    id: number;
    layerId: number;
    type: number;
    buttonType: number;
    buttonText: string | null;
    text: string | null;
    text2: string | null;
    ops: (string | null)[] | null;
    width: number;
    height: number;
    children: number[] | null;
    clientCode: number;
    hide: boolean;
    objOps: boolean;
}

export interface InterfaceSnapshot {
    format: 1;
    revision: number;
    source: {
        recording: string;
        cacheSha256: string;
        engineCommit: string;
        contentCommit: string;
        clientCommit: string;
    };
    interfaceSha256: string;
    names: Record<string, number>;
    components: Record<string, SnapshotComponent>;
}

let cached: InterfaceSnapshot | null = null;

/** The committed snapshot the replay archive server serves for this revision. */
export function loadInterfaceSnapshot(): InterfaceSnapshot {
    cached ??= JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as InterfaceSnapshot;
    return cached;
}

export function snapshotComponent(id: number): SnapshotComponent {
    const component = loadInterfaceSnapshot().components[String(id)];
    if (!component) {
        throw new Error(`the interface snapshot has no component ${id}`);
    }
    return component;
}

export function snapshotId(name: string): number {
    const id = loadInterfaceSnapshot().names[name];
    if (id === undefined) {
        throw new Error(`the interface snapshot has no pack name '${name}'`);
    }
    return id;
}

/** Installs the snapshot rows as the client's live interface table; returns the restore hook. */
export function installInterfaceSnapshot(): () => void {
    const original = IfType.list;
    const list: IfType[] = [];
    for (const row of Object.values(loadInterfaceSnapshot().components)) {
        const component = new IfType();
        component.id = row.id;
        component.layerId = row.layerId;
        component.type = row.type;
        component.buttonType = row.buttonType;
        component.buttonText = row.buttonText;
        component.text = row.text;
        component.text2 = row.text2;
        component.iop = row.ops;
        component.width = row.width;
        component.height = row.height;
        component.children = row.children === null ? null : [...row.children];
        component.clientCode = row.clientCode;
        component.hide = row.hide;
        component.objOps = row.objOps;
        component.linkObjType = row.type === 2 ? new Int32Array(row.width * row.height) : null;
        component.linkObjNumber = row.type === 2 ? new Int32Array(row.width * row.height) : null;
        list[row.id] = component;
    }
    IfType.list = list;
    return () => {
        IfType.list = original;
    };
}

/** Decodes the `interface` archive bytes served by the recording's replay cache. */
export function decodeInterfaceArchive(archiveBytes: Uint8Array): { data: Uint8Array; sha256: string } {
    const jag = new JagFile(archiveBytes);
    const data = jag.read('data');
    if (!data) {
        throw new Error('interface archive has no data file');
    }
    return { data, sha256: createHash('sha256').update(data).digest('hex') };
}

/** Reads one cache bundle from a directory laid out as the evidence root's `cache-bundles`. */
export function readCacheBundleArchive(directory: string, cacheSha256: string): Uint8Array {
    const bundle = JSON.parse(readFileSync(join(directory, `${cacheSha256}.json`), 'utf8')) as {
        archives: Record<string, string>;
    };
    const encoded = bundle.archives.interface;
    if (!encoded) {
        throw new Error('cache bundle has no interface archive');
    }
    return Uint8Array.from(Buffer.from(encoded, 'base64'));
}
