import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { attach, detach, reader, type TemplateSource } from '#/bot/adapter/ClientAdapter.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import { skipUnless } from '../lib/skipUnless.js';
import { loadReplayFixtures } from '../io/replay/recording.js';
import { replayRecording } from '../io/replay/runtime.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({
    playMidi: (): void => {},
    setMidiVolume: (): void => {},
    stopMidi: (): void => {}
}));

interface CheckpointState {
    serverTile: { x: number; z: number; level: number };
    sceneState: number;
    ingame: boolean;
    sceneInstanced: boolean;
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
}

interface CheckpointRecord {
    type: 'checkpoint';
    label: string;
    state: CheckpointState;
}

function checkpoints(file: string): CheckpointRecord[] {
    const text = readFileSync(resolve('test/io/recordings', file), 'utf8');
    const out: CheckpointRecord[] = [];
    for (const line of text.split('\n')) {
        if (!line) {
            continue;
        }
        const row = JSON.parse(line) as { type: string };
        if (row.type === 'checkpoint') {
            out.push(row as CheckpointRecord);
        }
    }
    return out;
}

afterEach(detach);

function attachCheckpoint(state: CheckpointState): { lx: number; lz: number } {
    const lx = state.serverTile.x - state.mapBuildBaseX;
    const lz = state.serverTile.z - state.mapBuildBaseZ;
    const player = Object.assign(new ClientPlayer(), { x: lx << 7, z: lz << 7 });
    player.routeX[0] = lx;
    player.routeZ[0] = lz;
    attach({
        ingame: state.ingame,
        sceneState: state.sceneState,
        sceneInstanced: state.sceneInstanced,
        mapBuildBaseX: state.mapBuildBaseX,
        mapBuildBaseZ: state.mapBuildBaseZ,
        minusedlevel: state.serverTile.level,
        localPlayer: player
    } as never);
    return { lx, lz };
}

describe('adapter snapshots from 377 recordings', () => {
    test('every checkpoint round-trips through mapBuildBase', () => {
        const files = ['377/tutorial.jsonl', '377/mainland.jsonl', '377/instance.jsonl', '377/l1.jsonl'];
        let count = 0;
        for (const file of files) {
            for (const point of checkpoints(file)) {
                const { lx, lz } = attachCheckpoint(point.state);
                expect(lx).toBeGreaterThanOrEqual(0);
                expect(lz).toBeGreaterThanOrEqual(0);
                expect(lx).toBeLessThan(104);
                expect(lz).toBeLessThan(104);
                expect(reader.sceneState()).toBe(point.state.sceneState);
                expect(reader.ingame()).toBe(point.state.ingame);
                expect(reader.sceneInstanced()).toBe(point.state.sceneInstanced);
                expect(reader.mapBuildBase()).toEqual({ x: point.state.mapBuildBaseX, z: point.state.mapBuildBaseZ });
                expect(reader.serverTile()).toEqual(point.state.serverTile);
                expect(reader.worldTile()).toEqual(point.state.serverTile);
                expect(reader.toLocal(point.state.serverTile.x, point.state.serverTile.z)).toEqual({ lx, lz });
                expect(reader.toWorld(lx, lz)).toEqual(point.state.serverTile);
                count++;
            }
        }
        expect(count).toBeGreaterThan(0);
    });

    test('instance-built-scene uses the dynamic base 6632,48 and not the pre-instance tile', () => {
        const built = checkpoints('377/instance.jsonl').find(point => point.label === 'instance-built-scene');
        const before = checkpoints('377/instance.jsonl').find(point => point.label === 'before-instance-built-scene');
        expect(built).toBeDefined();
        expect(before).toBeDefined();
        attachCheckpoint(built!.state);
        expect(reader.sceneInstanced()).toBe(true);
        expect(reader.mapBuildBase()).toEqual({ x: 6632, z: 48 });
        expect(reader.serverTile()).toEqual({ x: 6680, z: 100, level: 0 });
        expect(reader.toLocal(6680, 100)).toEqual({ lx: 48, lz: 52 });
        expect(reader.toLocal(before!.state.serverTile.x, before!.state.serverTile.z)).toBeNull();
    });
});

const recordingIndex = resolve('test/io/recordings/index.json');
const missingIndex = !existsSync(recordingIndex);
if (missingIndex) console.info('SKIP: test/adapter/recordingSnapshots.test.ts: recording index is not present');
const missingCacheBundle = skipUnless('cache-bundle');
const REPLAY_BUDGET_MS = 120_000;

describe.skipIf(missingIndex || missingCacheBundle)('adapter snapshots from replayed 377 recordings', () => {
    test(
        'instance-built-scene exposes locs and populated templateSource from the replayed client',
        async () => {
            const fixtures = loadReplayFixtures();
            const instance = fixtures.find(fixture => fixture.recordingFile.includes('instance'));
            expect(instance).toBeDefined();
            let seen = 0;
            let locCount = 0;
            let templateSlots = 0;
            let playerTemplate: TemplateSource | null = null;
            await replayRecording(instance!.records, instance!.cacheBundle, instance!.protocol, info => {
                if (info.label !== 'instance-built-scene') {
                    return;
                }
                seen++;
                expect(info.adapter.sceneInstanced()).toBe(true);
                expect(info.adapter.mapBuildBase()).toEqual({ x: 6632, z: 48 });
                expect(info.adapter.serverTile()).toEqual({ x: 6680, z: 100, level: 0 });
                locCount = info.adapter.locs().length;
                const local = info.adapter.toLocal(6680, 100);
                expect(local).toEqual({ lx: 48, lz: 52 });
                playerTemplate = local ? (info.adapter.templateSource(local.lx, local.lz) as TemplateSource | null) : null;
                for (let level = 0; level < 4; level++) {
                    for (let cx = 0; cx < 13; cx++) {
                        for (let cz = 0; cz < 13; cz++) {
                            if (info.adapter.templateSource(cx * 8, cz * 8, level)) {
                                templateSlots++;
                            }
                        }
                    }
                }
            });
            expect(seen).toBe(1);
            expect(locCount).toBeGreaterThan(0);
            expect(templateSlots).toBeGreaterThan(0);
            expect(playerTemplate).not.toBeNull();
        },
        REPLAY_BUDGET_MS
    );

    test(
        'non-instance replay checkpoints have no template table',
        async () => {
            const fixtures = loadReplayFixtures();
            const tutorial = fixtures.find(fixture => fixture.recordingFile.includes('tutorial'));
            expect(tutorial).toBeDefined();
            let checkpoints = 0;
            await replayRecording(tutorial!.records, tutorial!.cacheBundle, tutorial!.protocol, info => {
                checkpoints++;
                expect(info.adapter.sceneInstanced()).toBe(false);
                expect(info.adapter.templateSource(48, 52)).toBeNull();
                expect(info.sceneBuild.locCount).toBeGreaterThan(0);
                expect(info.adapter.locs().length).toBeGreaterThan(0);
            });
            expect(checkpoints).toBeGreaterThan(0);
        },
        REPLAY_BUDGET_MS
    );
});
