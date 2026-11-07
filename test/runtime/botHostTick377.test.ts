import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { BotHost } = await import('#/bot/runtime/BotHost.js');
const { attach, detach, reader } = await import('#/bot/adapter/ClientAdapter.js');
const { default: LocType } = await import('#/client/config/LocType.js');
import { ServerProt } from '#/client/io/ServerProt.js';
import { loadReplayRecordings } from '../io/replay/recording.js';

const handle = (ptype: number): void => (BotHost as unknown as { handlePacket(ptype: number): void }).handlePacket(ptype);

// Why: LocType.list is a process-wide static; a stub left behind broke every later file's loc decoder.
const realLocList = LocType.list;
beforeEach(() => {
    LocType.list = ((id: number) => ({ name: `loc${id}`, op: ['Mine'], multiloc: [] })) as unknown as typeof LocType.list;
});
afterEach(() => {
    LocType.list = realLocList;
});

test('a server tick is one PLAYER_INFO: NPC_INFO, rebuilds and zone packets never advance tickCount', () => {
    const before = BotHost.tickCount;
    let listened = 0;
    const off = BotHost.addTickListener(() => { listened++; });
    try {
        for (const ptype of [ServerProt.NPC_INFO, ServerProt.REBUILD_NORMAL, ServerProt.REBUILD_REGION, ServerProt.UPDATE_ZONE_PARTIAL_ENCLOSED, ServerProt.OBJ_ADD, ServerProt.SOUND_AREA]) {
            handle(ptype);
        }
        expect(BotHost.tickCount).toBe(before);
        expect(listened).toBe(0);
        handle(ServerProt.PLAYER_INFO);
        expect(BotHost.tickCount).toBe(before + 1);
        expect(listened).toBe(1);
    } finally {
        off();
    }
});

test('every committed 377 recording carries exactly one PLAYER_INFO per game tick after its login burst', () => {
    for (const recording of loadReplayRecordings()) {
        const names = new Map(recording.protocol.server.map(descriptor => [descriptor.id, descriptor.name]));
        const perTick = new Map<string, number>();
        const ticks = new Set<string>();
        for (const line of readFileSync(`test/io/recordings/${recording.indexEntry.file}`, 'utf8').split('\n')) {
            if (!line) continue;
            const record = JSON.parse(line) as { type?: string; direction?: string; segment?: number; tick?: number; bytes?: string };
            if (record.type !== 'frame' || record.direction !== 'in' || record.tick === 0) continue;
            const key = `${record.segment}:${record.tick}`;
            ticks.add(key);
            if (names.get(parseInt(record.bytes!.slice(0, 2), 16)) === 'PLAYER_INFO') perTick.set(key, (perTick.get(key) ?? 0) + 1);
        }
        expect(ticks.size, recording.indexEntry.file).toBeGreaterThan(10);
        for (const key of ticks) expect(perTick.get(key), `${recording.indexEntry.file} tick ${key}`).toBe(1);
    }
});

afterAll(() => detach());

test('a scene rebuild drops the loc snapshot memo, so an instanced scene never reads the previous one', () => {
    let sceneReads = 0;
    attach({
        world: {
            wallType: (): number => 0,
            sceneType: (_level: number, lx: number, lz: number): number => { sceneReads++; return lx === 1 && lz === 2 ? (7 << 14) | 1 : 0; },
            gdType: (): number => 0,
            decorType: (): number => 0
        },
        localPlayer: { x: 0, z: 0 },
        minusedlevel: 0,
        mapBuildBaseX: 3200,
        mapBuildBaseZ: 3200
    } as never);

    for (const ptype of [ServerProt.REBUILD_NORMAL, ServerProt.REBUILD_REGION, ServerProt.P_LOCMERGE]) {
        reader.locs();
        const swept = sceneReads;
        reader.locs();
        expect(sceneReads, 'the second read is served from the memo').toBe(swept);
        handle(ptype);
        reader.locs();
        expect(sceneReads, `ptype ${ptype} dropped the memo`).toBeGreaterThan(swept);
    }
});
