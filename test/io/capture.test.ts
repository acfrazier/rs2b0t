import { describe, expect, test } from 'bun:test';
import { sameQuiescentState, type CaptureSnapshot } from '../../e2e/tap-377/capture-page.js';
import { assertCaptureFrames, bankSlotPoint, rearranged } from '../../e2e/tap-377/capture-scenarios.js';
import type { Direction, FrameRecord, RecordingRecord } from '../../tools/tap-377/format.js';
import protocol from './fixtures/prot377/engine-prot.json';

const ready = (): CaptureSnapshot => ({
    state: { serverTile: { x: 3200, z: 3200, level: 0 }, sceneState: 2, ingame: true, sceneInstanced: false, mapBuildBaseX: 3152, mapBuildBaseZ: 3152 },
    cycle: 100, tick: 10, inboundCount: 7, segment: 1, moving: false, remaining: 0,
    main: -1, chat: -1, side: -1, countDialog: false, bankArrangeMode: 0, foreignPlayer: false, packetFailure: false
});

describe('capture checkpoint admission', () => {
    test('accepts an unchanged built scene while packets and cycles advance', () => {
        const after = ready();
        after.inboundCount = 9;
        after.cycle = 105;
        expect(sameQuiescentState(ready(), after)).toBe(true);
    });
    test('rejects movement, unbuilt scenes, pending cache files, and segment transitions', () => {
        for (const patch of [{ moving: true }, { remaining: 1 }, { segment: 2 }]) {
            expect(sameQuiescentState(ready(), { ...ready(), ...patch })).toBe(false);
        }
        for (const patch of [{ sceneState: 1 }, { ingame: false }, { sceneInstanced: true }, { mapBuildBaseX: 3200 }]) {
            expect(sameQuiescentState(ready(), { ...ready(), state: { ...ready().state, ...patch } })).toBe(false);
        }
    });
    test('compares every route-head coordinate, never the interpolated player position', () => {
        for (const key of ['x', 'z', 'level'] as const) {
            const after = ready();
            after.state.serverTile[key]++;
            expect(sameQuiescentState(ready(), after)).toBe(false);
        }
    });
});

describe('capture drag fixtures', () => {
    test('uses two different non-adjacent rearrangements', () => {
        const items = [1, 2, 3, 4, 5];
        const swapped = rearranged(items, 0, 4, false);
        expect(swapped).toEqual([5, 2, 3, 4, 1]);
        expect(rearranged(swapped, 4, 1, true)).toEqual([5, 1, 2, 3, 4]);
        expect(items).toEqual([1, 2, 3, 4, 5]);
    });
    test('targets visible first-row inventory slots only', () => {
        expect(bankSlotPoint(0)).toEqual({ x: 95, y: 78 });
        expect(bankSlotPoint(4)).toEqual({ x: 283, y: 78 });
        for (const slot of [-1, 8, 0.5]) expect(() => bankSlotPoint(slot)).toThrow();
    });
});

describe('capture scenario packet evidence', () => {
    // This gate counts named actions and checks the two drag vectors. check-recording separately checks complete frame envelopes.
    const packet = (direction: Direction, name: string, payload = ''): FrameRecord => {
        const descriptor = (direction === 'in' ? protocol.server : protocol.client).find(packet => packet.name === name);
        if (!descriptor) throw new Error(`missing fixture descriptor ${name}`);
        return { type: 'frame', segment: 1, direction, ordinal: 1, tick: 1, bytes: descriptor.id.toString(16).padStart(2, '0') + payload };
    };
    const evidence = (): RecordingRecord[] => [
        { type: 'login', segment: 1, replies: [0, 2], staffmodlevel: 0, mouseTracked: false, reconnect: false },
        ...['PLAYER_INFO', 'REBUILD_NORMAL', 'P_COUNTDIALOG', 'IF_OPENMAIN_SIDE', 'UPDATE_INV_FULL', 'LOGOUT'].map(name => packet('in', name)),
        ...['IF_BUTTON', 'OPNPC1', 'OPLOC1', 'OPLOC2', 'RESUME_PAUSEBUTTON', 'INV_BUTTON5', 'RESUME_P_COUNTDIALOG', 'MESSAGE_PUBLIC'].map(name => packet('out', name)),
        packet('out', 'INV_BUTTOND', '84008015860000'), packet('out', 'INV_BUTTOND', '81008115860400'),
        { type: 'end', segment: 1, reason: 'logout', inboundCount: 6, outboundCount: 10 },
        { type: 'login', segment: 2, replies: [0, 2], staffmodlevel: 0, mouseTracked: false, reconnect: false },
        { ...packet('in', 'LOGOUT'), segment: 2 },
        { type: 'end', segment: 2, reason: 'logout', inboundCount: 1, outboundCount: 0 }
    ];

    test('requires both independent non-adjacent drag vectors', () => {
        expect(() => assertCaptureFrames('mainland', evidence(), protocol)).not.toThrow();
        const wrong = evidence().map(record => record.type === 'frame' && record.bytes.endsWith('81008115860400') ? { ...record, bytes: record.bytes.slice(0, -4) + '0004' } : record);
        expect(() => assertCaptureFrames('mainland', wrong, protocol)).toThrow('drag encodings');
    });
    test('does not accept packet presence without clean session ends', () => {
        const incomplete = evidence().filter(record => record.type !== 'end');
        expect(() => assertCaptureFrames('mainland', incomplete, protocol)).toThrow('logout and relogin');
    });
    test('does not accept a normal scene as instance evidence', () => {
        expect(() => assertCaptureFrames('instance', evidence(), protocol)).toThrow('REBUILD_REGION');
    });
});
