import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<boolean> => true,
    replayWave: async (): Promise<boolean> => false,
    setWaveVolume: (): void => {}
}));

import Packet from '#/client/io/Packet.js';
import { JAVA_CHANNEL_BASE, javaGetVolume14, midivolToGain, type MidiBackend } from '#/client/sound/MidiBackend.js';
import { debugMidi, installMidiBackendForTest, playMidi, resetMidiFacadeForTest, setMidiVolume, stopMidi, tickMidiFacadeForTest } from '#/client/sound/MidiFacade.js';
import { spessaProcessorUrl } from '#/client/sound/backends/spessaBackend.js';
import { Client } from '#/client/shell/Client.js';

class FakeBackend implements MidiBackend {
    readonly id = 'spessa' as const;
    playing = false;
    pausedTime = 0;
    duration = 180;
    midivols: number[] = [];
    plays: { bytes: number; loop: boolean }[] = [];
    stops = 0;

    async setSoundfont(_data: ArrayBuffer | Uint8Array): Promise<void> {}

    async play(smf: Uint8Array, loop: boolean): Promise<void> {
        this.stop();
        this.plays.push({ bytes: smf.byteLength, loop });
        this.playing = true;
        this.pausedTime = 0;
    }

    stop(): void {
        this.stops += 1;
        this.playing = false;
        // Decision 012: pause only, never seek to duration (that leaked pausedTime).
        this.pausedTime = 0;
    }

    setMidivol(midivol: number): void {
        this.midivols.push(midivol);
    }

    isPlaying(): boolean {
        return this.playing;
    }
}

const SONG_A = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 1, 2, 3]);
const SONG_B = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 9, 8, 7, 6]);

interface ProbeClient {
    midiActive: boolean;
    midiVolume: number;
    nextMusicDelay: number;
    nextMidiSong: number;
    midiSong: number;
    in: Packet;
    psize: number;
    onDemand: { request: (archive: number, file: number) => void };
    saveMidi: (data: Uint8Array, fading: boolean) => void;
    handleMidiSong: () => boolean;
}

function probeClient(): ProbeClient {
    const client = Object.create(Client.prototype) as ProbeClient;
    client.midiActive = true;
    client.midiVolume = 96;
    client.nextMusicDelay = 0;
    client.nextMidiSong = -1;
    client.midiSong = -1;
    return client;
}

describe('java midivol curve', () => {
    test('javaGetVolume14 is zero at mute and scales with the Java sqrt mix', () => {
        expect(javaGetVolume14(JAVA_CHANNEL_BASE, 0)).toBe(0);
        expect(javaGetVolume14(JAVA_CHANNEL_BASE, 128)).toBe((Math.sqrt(((JAVA_CHANNEL_BASE * 128) >>> 8) * JAVA_CHANNEL_BASE) + 0.5) | 0);
        expect(javaGetVolume14(JAVA_CHANNEL_BASE, 96)).toBe((Math.sqrt(((JAVA_CHANNEL_BASE * 96) >>> 8) * JAVA_CHANNEL_BASE) + 0.5) | 0);
    });

    test('midivolToGain is 1 at 128, 0 at 0, and 96 is the Java relative step', () => {
        expect(midivolToGain(0)).toBe(0);
        expect(midivolToGain(128)).toBe(1);
        expect(midivolToGain(96)).toBe(javaGetVolume14(JAVA_CHANNEL_BASE, 96) / javaGetVolume14(JAVA_CHANNEL_BASE, 128));
        expect(midivolToGain(200)).toBe(1);
        expect(midivolToGain(-4)).toBe(0);
    });
});

describe('MidiFacade against a fake backend', () => {
    let fake: FakeBackend;

    beforeEach(() => {
        resetMidiFacadeForTest();
        fake = new FakeBackend();
        installMidiBackendForTest(fake);
    });

    afterEach(() => {
        resetMidiFacadeForTest();
        Client.lowMem = false;
    });

    test('setMidiVolume clamps to 0..128 and voladjusts the backend', () => {
        setMidiVolume(96, true);
        expect(debugMidi().midivol).toBe(96);
        setMidiVolume(200, true);
        expect(debugMidi().midivol).toBe(128);
        setMidiVolume(-8, true);
        expect(debugMidi().midivol).toBe(0);
        expect(fake.midivols.at(-1)).toBe(0);
    });

    test('a first play with fade starts immediately and loops', () => {
        playMidi(SONG_A, 0, true);
        expect(fake.plays).toEqual([{ bytes: SONG_A.byteLength, loop: true }]);
        expect(debugMidi().playing).toBe(true);
    });

    test('a jingle (no fade) plays once', () => {
        playMidi(SONG_A, 0, false);
        expect(fake.plays).toEqual([{ bytes: SONG_A.byteLength, loop: false }]);
    });

    test('swap while playing fades out then in and does not leak pausedTime', () => {
        playMidi(SONG_A, 0, true);
        expect(fake.plays).toHaveLength(1);
        playMidi(SONG_B, 0, true);
        expect(fake.plays).toHaveLength(1);
        expect(debugMidi().midiFadingOut).toBe(true);
        for (let i = 0; i < 13; i++) {
            tickMidiFacadeForTest();
        }
        expect(fake.plays).toEqual([
            { bytes: SONG_A.byteLength, loop: true },
            { bytes: SONG_B.byteLength, loop: true }
        ]);
        expect(fake.pausedTime).toBe(0);
        expect(fake.stops).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < 13; i++) {
            tickMidiFacadeForTest();
        }
        expect(debugMidi().midiFadingIn).toBe(false);
        expect(debugMidi().midiFadeVol).toBe(96);
        expect(fake.midivols.at(-1)).toBe(96);
    });

    test('hard-cut swap (no fade) plays the new song from t=0', () => {
        playMidi(SONG_A, 0, false);
        playMidi(SONG_B, 0, false);
        expect(fake.plays).toEqual([
            { bytes: SONG_A.byteLength, loop: false },
            { bytes: SONG_B.byteLength, loop: false }
        ]);
        expect(fake.pausedTime).toBe(0);
    });

    test('stopMidi clears fade flags and stops the backend', () => {
        playMidi(SONG_A, 0, true);
        stopMidi(false);
        expect(fake.playing).toBe(false);
        expect(debugMidi().midiFadingIn).toBe(false);
        expect(debugMidi().midiFadingOut).toBe(false);
    });

    test('MIDI_SONG still records nextMidiSong in lowMem without requesting or playing', () => {
        const requests: [number, number][] = [];
        const client = probeClient();
        client.onDemand = {
            request: (archive: number, file: number): void => {
                requests.push([archive, file]);
            }
        };
        Client.lowMem = true;
        const song = new Packet(new Uint8Array(8));
        song.p2_alt3(62);
        song.pos = 0;
        client.in = song;
        client.psize = 2;
        expect(client.handleMidiSong()).toBe(true);
        expect(client.nextMidiSong).toBe(62);
        expect(client.midiSong).toBe(-1);
        expect(requests).toEqual([]);
        expect(fake.plays).toEqual([]);
    });

    test('saveMidi is a no-op when midiActive is false or Client.lowMem is true', () => {
        const client = probeClient();
        Client.lowMem = true;
        client.saveMidi(SONG_A, true);
        expect(fake.plays).toEqual([]);

        Client.lowMem = false;
        client.midiActive = false;
        client.saveMidi(SONG_A, true);
        expect(fake.plays).toEqual([]);

        client.midiActive = true;
        client.saveMidi(SONG_B, false);
        expect(fake.plays).toEqual([{ bytes: SONG_B.byteLength, loop: false }]);
    });
});

describe('processor URL (pitfall 28)', () => {
    test('resolves beside botclient.js on an isolated /bot/<tag>/ page', () => {
        const loc = document.location as Location & { href: string; pathname: string };
        const origPath = loc.pathname;
        const origHref = loc.href;
        loc.pathname = '/bot-s11x.html';
        loc.href = 'http://localhost:81/bot-s11x.html';
        try {
            expect(spessaProcessorUrl()).toBe('http://localhost:81/bot/s11x/spessasynth_processor.min.js');
        } finally {
            loc.pathname = origPath;
            loc.href = origHref;
        }
    });

    test('resolves from a botclient.js script src when the page is not isolated', () => {
        const scripts = [{ src: 'http://localhost:81/rs2b0t/bot/botclient.js' }];
        const orig = document.getElementsByTagName.bind(document);
        document.getElementsByTagName = ((tag: string) => (tag === 'script' ? scripts : orig(tag))) as typeof document.getElementsByTagName;
        try {
            expect(spessaProcessorUrl()).toBe('http://localhost:81/rs2b0t/bot/spessasynth_processor.min.js');
        } finally {
            document.getElementsByTagName = orig;
        }
    });
});
