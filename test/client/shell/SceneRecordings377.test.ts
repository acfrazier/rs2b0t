import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import ClientObj from '#/client/dash3d/ClientObj.js';
import { LocLayer } from '#/client/dash3d/LocLayer.js';
import type { CheckpointRecord, FrameRecord, Protocol, RecordingRecord } from '../../../tools/tap-377/format.js';
import { loadReplayRecordings } from '../../io/replay/recording.js';

import { Client, feed, onDemandStub, sceneClient, type SceneClient } from './sceneClient.js';
import { builtOpcode, hex } from './sceneSupport.js';

const recordings = loadReplayRecordings(377);
const origCycle = Client.loopCycle;

beforeEach(() => {
    Client.loopCycle = 1000;
});

afterEach(() => {
    Client.loopCycle = origCycle;
});

interface Handled {
    opcode: number;
    name: string;
}

// the recorded descriptors already carry the built table's spelling (P_LOCMERGE, not LOC_MERGE)
const ZONE_CHILDREN = new Set(['P_LOCMERGE', 'OBJ_REVEAL', 'LOC_ANIM', 'OBJ_ADD', 'OBJ_COUNT', 'MAP_PROJANIM', 'SOUND_AREA', 'MAP_ANIM', 'LOC_ADD_CHANGE', 'OBJ_DEL', 'LOC_DEL']);

/** Splits one recorded inbound frame into opcode and body by the pinned descriptor's length rule. */
function body(frame: FrameRecord, protocol: Protocol): { name: string; body: Uint8Array } {
    const bytes = hex(frame.bytes);
    const descriptor = protocol.server.find(d => d.id === bytes[0])!;
    const prefix = descriptor.length === -1 ? 1 : descriptor.length === -2 ? 2 : 0;
    return { name: descriptor.name, body: bytes.subarray(1 + prefix) };
}

function built(name: string): number | undefined {
    return builtOpcode(name);
}

/** In a 289-numbered build the child opcodes inside an enclosed frame are renumbered; in a 377 build this is the identity. */
function renumberEnclosed(data: Uint8Array, protocol: Protocol): Uint8Array {
    const out = Array.from(data.subarray(0, 2));
    for (let pos = 2; pos < data.length; ) {
        const descriptor = protocol.server.find(d => d.id === data[pos])!;
        const opcode = built(descriptor.name);
        if (opcode === undefined) {
            throw new Error(`the built ServerProt table has no ${descriptor.name}`);
        }
        out.push(opcode, ...data.subarray(pos + 1, pos + 1 + descriptor.length));
        pos += 1 + descriptor.length;
    }
    return Uint8Array.from(out);
}

/** Feeds a recorded frame to the production handler for it; anything else is not this slice's. */
function dispatch(client: SceneClient, name: string, data: Uint8Array, protocol: Protocol): boolean {
    feed(client, name === 'UPDATE_ZONE_PARTIAL_ENCLOSED' ? renumberEnclosed(data, protocol) : data);
    if (name === 'REBUILD_NORMAL') {
        client.rebuildNormal();
        // the build itself happens in the frame loop; the replay marks it done so a repeat centre is the no-op it is live
        client.sceneState = 2;
    } else if (name === 'REBUILD_REGION') {
        client.rebuildRegion();
        client.sceneState = 2;
    } else if (name === 'UPDATE_ZONE_PARTIAL_FOLLOWS') {
        client.zoneUpdatePartialFollows();
    } else if (name === 'UPDATE_ZONE_FULL_FOLLOWS') {
        client.zoneUpdateFullFollows();
    } else if (name === 'UPDATE_ZONE_PARTIAL_ENCLOSED') {
        client.zoneUpdatePartialEnclosed();
    } else if (ZONE_CHILDREN.has(name)) {
        const opcode = built(name);
        if (opcode === undefined) {
            return false;
        }
        client.zonePacket(client.in, opcode);
    } else {
        return false;
    }
    return true;
}

interface Segment {
    frames: FrameRecord[];
    checkpoints: CheckpointRecord[];
}

function segmentsOf(records: RecordingRecord[]): Segment[] {
    const segments = new Map<number, Segment>();
    const of = (n: number): Segment => segments.get(n) ?? (segments.set(n, { frames: [], checkpoints: [] }), segments.get(n)!);
    for (const record of records) {
        if (record.type === 'frame' && record.direction === 'in') {
            of(record.segment).frames.push(record);
        } else if (record.type === 'checkpoint') {
            of(record.segment).checkpoints.push(record);
        }
    }
    return [...segments.values()];
}

function freshClient(): SceneClient {
    const client = sceneClient();
    client.onDemand = onDemandStub();
    return client;
}

describe('revision 377 recordings through the production scene handlers', () => {
    for (const recording of recordings) {
        test(`${recording.recordingFile}: every rebuild and zone frame is consumed exactly, and each checkpoint's scene base matches`, () => {
            const handled: Handled[] = [];
            let checkpoints = 0;

            for (const segment of segmentsOf(recording.records)) {
                const client = freshClient();
                let inbound = 0;
                const due = [...segment.checkpoints];
                const check = (): void => {
                    while (due.length > 0 && due[0].inboundCount <= inbound) {
                        const checkpoint = due.shift()!;
                        expect(checkpoint.inboundCount).toBe(inbound);
                        expect(client.sceneInstanced).toBe(checkpoint.state.sceneInstanced);
                        expect(client.mapBuildBaseX).toBe(checkpoint.state.mapBuildBaseX);
                        expect(client.mapBuildBaseZ).toBe(checkpoint.state.mapBuildBaseZ);
                        checkpoints++;
                    }
                };

                check();
                for (const record of segment.frames) {
                    inbound++;
                    const frame = body(record, recording.protocol);
                    if (dispatch(client, frame.name, frame.body, recording.protocol)) {
                        handled.push({ opcode: hex(record.bytes)[0], name: frame.name });
                        expect(client.in.pos).toBe(client.psize);
                    }
                    check();
                }
                expect(due).toEqual([]);
            }

            expect(checkpoints).toBeGreaterThan(0);
            expect(handled.filter(h => h.name === 'REBUILD_NORMAL').length).toBeGreaterThan(0);
            expect(handled.filter(h => h.name === 'UPDATE_ZONE_FULL_FOLLOWS').length).toBeGreaterThan(0);
        });
    }

    test('the instance recording carries a REBUILD_REGION and reaches the dynamic base the checkpoint names', () => {
        const recording = recordings.find(r => r.recordingFile === '377/instance.jsonl')!;
        const client = freshClient();
        let instanced: { x: number; z: number; slots: number } | null = null;
        let segment = 0;
        for (const record of recording.records) {
            if (record.type === 'login') {
                segment = record.segment;
            }
            if (record.type !== 'frame' || record.direction !== 'in' || record.segment !== 2) {
                continue;
            }
            const frame = body(record, recording.protocol);
            if (frame.name !== 'REBUILD_REGION') {
                continue;
            }
            dispatch(client, frame.name, frame.body, recording.protocol);
            let slots = 0;
            for (const plane of client.sceneMapRegion) {
                for (const row of plane) {
                    slots += row.filter(v => v !== -1).length;
                }
            }
            instanced = { x: client.mapBuildBaseX, z: client.mapBuildBaseZ, slots };
        }

        expect(segment).toBeGreaterThan(0);
        expect(instanced).not.toBeNull();
        // the recorded checkpoint: base (6632, 48), far above any real map tile
        expect([instanced!.x, instanced!.z]).toEqual([6632, 48]);
        expect(client.sceneInstanced).toBe(true);
        expect(instanced!.slots).toBeGreaterThan(0);
        expect(client.mapBuildIndex!.length).toBeGreaterThan(0);
        expect(client.mapBuildIndex!.length).toBeLessThanOrEqual(instanced!.slots);
    });

    test('recorded zone frames reach the ground-object and loc-change state', () => {
        const mainland = recordings.find(r => r.recordingFile === '377/mainland.jsonl')!;
        const client = freshClient();
        let adds = 0;
        let locOps = 0;
        let segment = 0;
        for (const record of mainland.records) {
            if (record.type === 'login') {
                segment = record.segment;
                continue;
            }
            if (record.type !== 'frame' || record.direction !== 'in' || record.segment !== segment) {
                continue;
            }
            const frame = body(record, mainland.protocol);
            if (!dispatch(client, frame.name, frame.body, mainland.protocol)) {
                continue;
            }
            if (frame.name === 'OBJ_ADD') {
                adds++;
            }
            if (frame.name === 'LOC_ADD_CHANGE' || frame.name === 'LOC_DEL') {
                locOps++;
            }
        }

        expect(adds).toBeGreaterThan(0);
        expect(locOps).toBeGreaterThan(0);
        expect(client.shown.length).toBeGreaterThan(0);
        for (let change = client.locChanges.head(); change !== null; change = client.locChanges.next()) {
            expect(change.layer).toBeGreaterThanOrEqual(LocLayer.WALL);
            expect(change.layer).toBeLessThanOrEqual(LocLayer.GROUND_DECOR);
            expect(change.x).toBeGreaterThanOrEqual(0);
            expect(change.x).toBeLessThan(104);
        }
        let stacked = 0;
        for (let x = 0; x < 104; x++) {
            for (let z = 0; z < 104; z++) {
                for (let obj: ClientObj | null | undefined = client.groundObj[0][x][z]?.head(); obj; obj = client.groundObj[0][x][z]?.next()) {
                    stacked++;
                    expect(obj.id).toBeLessThan(65536);
                }
            }
        }
        expect(stacked).toBeGreaterThan(0);
    });
});
