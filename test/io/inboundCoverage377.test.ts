import { readFileSync } from 'node:fs';
import { expect, mock, test } from 'bun:test';

import { skipUnless } from '../lib/skipUnless.js';
import { loadReplayFixtures } from './replay/recording.js';
import { replayRecording } from './replay/runtime.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));

const HANDLERS_TEST = 'test/client/shell/Client377Handlers.test.ts';
const ZONE_TEST = 'test/client/shell/ZonePackets377.test.ts';

/**
 * Descriptors none of the committed recordings carries, each with the semantic vector that drives its production decoder.
 * Why: a descriptor that no recording or vector exercises would ship with an unread 377 wire layout, so the list is closed and a stale entry fails below.
 */
const VECTORS: Record<string, { file: string; needle: string }> = {
    CAM_LOOKAT: { file: HANDLERS_TEST, needle: "['handleCamLookAt']" },
    CAM_MOVETO: { file: HANDLERS_TEST, needle: "['handleCamMoveTo']" },
    CAM_SHAKE: { file: HANDLERS_TEST, needle: "['handleCamShake']" },
    IF_OPENFULL: { file: HANDLERS_TEST, needle: "['handleIfOpenFull']" },
    IF_OPENSIDE: { file: HANDLERS_TEST, needle: "['handleIfOpenSide']" },
    IF_SETANGLE: { file: HANDLERS_TEST, needle: "['handleIfSetAngle']" },
    IF_SETMODEL: { file: HANDLERS_TEST, needle: "['handleIfSetModel']" },
    IF_SETOBJECT: { file: HANDLERS_TEST, needle: "['handleIfSetObject']" },
    IF_SETPOSITION: { file: HANDLERS_TEST, needle: "['handleIfSetPosition']" },
    IF_SETROTATION: { file: HANDLERS_TEST, needle: "['handleIfSetRotation']" },
    IF_SETSCROLLPOS: { file: HANDLERS_TEST, needle: "['handleIfSetScrollPos']" },
    IF_SHOWICON: { file: HANDLERS_TEST, needle: "['handleIfShowIcon']" },
    LAST_LOGIN_INFO: { file: HANDLERS_TEST, needle: "['handleLastLoginInfo']" },
    MESSAGE_PRIVATE: { file: HANDLERS_TEST, needle: "['handleMessagePrivate']" },
    MIDI_JINGLE: { file: HANDLERS_TEST, needle: "['handleMidiJingle']" },
    P_NAMEDIALOG: { file: HANDLERS_TEST, needle: "['handlePNamedialog']" },
    TUT_FLASH: { file: HANDLERS_TEST, needle: "['handleTutFlash']" },
    UPDATE_FRIENDLIST: { file: HANDLERS_TEST, needle: "['handleUpdateFriendList']" },
    UPDATE_REBOOT_TIMER: { file: HANDLERS_TEST, needle: "['handleUpdateRebootTimer']" },
    LOC_ANIM: { file: ZONE_TEST, needle: 'ServerProt.LOC_ANIM' },
    MAP_ANIM: { file: ZONE_TEST, needle: 'ServerProt.MAP_ANIM' },
    MAP_PROJANIM: { file: ZONE_TEST, needle: 'ServerProt.MAP_PROJANIM' },
    OBJ_COUNT: { file: ZONE_TEST, needle: 'ServerProt.OBJ_COUNT' },
    OBJ_DEL: { file: ZONE_TEST, needle: 'ServerProt.OBJ_DEL' },
    OBJ_REVEAL: { file: ZONE_TEST, needle: 'ServerProt.OBJ_REVEAL' },
    P_LOCMERGE: { file: ZONE_TEST, needle: 'ServerProt.P_LOCMERGE' },
    SOUND_AREA: { file: ZONE_TEST, needle: "describe('SOUND_AREA" }
};

test.skipIf(skipUnless('cache-bundle'))('every inbound descriptor is exercised by a recording through the runtime or by a semantic vector', async () => {
    const recorded = new Set<string>();
    let descriptors: string[] = [];
    const instanced: string[] = [];
    for (const fixture of loadReplayFixtures()) {
        const report = await replayRecording(fixture.records, fixture.cacheBundle, fixture.protocol);
        descriptors = report.recordedOpcodeCoverage.inbound.descriptors;
        for (const name of report.recordedOpcodeCoverage.inbound.seen) recorded.add(name);
        for (const checkpoint of report.checkpoints) {
            expect(checkpoint.state.sceneState).toBe(2);
            expect(checkpoint.sceneBuild.locCount).toBeGreaterThan(0);
            expect(checkpoint.sceneBuild.collisionZoneTiles).toBeGreaterThan(0);
            if (checkpoint.state.sceneInstanced) instanced.push(fixture.indexEntry.file);
        }
    }

    expect(descriptors).toHaveLength(75);
    expect(new Set(instanced).size).toBeGreaterThan(0);

    const unexercised: string[] = [];
    for (const name of descriptors) {
        if (recorded.has(name)) {
            expect(VECTORS[name], `${name} is recorded now; drop its vector entry`).toBeUndefined();
            continue;
        }
        const vector = VECTORS[name];
        if (!vector || !readFileSync(vector.file, 'utf8').includes(vector.needle)) unexercised.push(name);
    }
    console.log(`COVERAGE inbound: ${recorded.size} by recording, ${descriptors.length - recorded.size - unexercised.length} by semantic vector, ${unexercised.length} unexercised; instanced scene in ${[...new Set(instanced)].join(', ')}`);
    expect(unexercised).toEqual([]);
}, 300_000);
