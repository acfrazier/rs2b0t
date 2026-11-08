import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const wave = {
    calls: [] as number[],
    results: [] as boolean[]
};

function installWaveMock(): void {
    mock.module('#/client/3rdparty/audio.js', () => ({
        playWave: async (data: Uint8Array): Promise<boolean> => {
            wave.calls.push(data.byteLength);
            const next = wave.results.shift();
            return next ?? false;
        },
        replayWave: async (): Promise<boolean> => false,
        setWaveVolume: (): void => {}
    }));
}

installWaveMock();

import Packet from '#/client/io/Packet.js';
import JagFX from '#/client/sound/JagFX.js';
import { Client } from '#/client/shell/Client.js';

const originalGenerate = JagFX.generate;

interface QueueProbe {
    waveCount: number;
    waveIds: Int32Array;
    waveLoops: Int32Array;
    waveDelay: Int32Array;
    lastWaveId: number;
    lastWaveLoops: number;
    lastWaveLength: number;
    lastWaveStartTime: number;
    nextMusicDelay: number;
    waveEnabled: boolean;
    out: Packet;
    in: Packet;
    soundsDoQueue(): Promise<void>;
    handleSynthSound(): boolean;
}

function probe(): QueueProbe {
    const client = Object.create(Client.prototype) as QueueProbe;
    client.waveCount = 0;
    client.waveIds = new Int32Array(50);
    client.waveLoops = new Int32Array(50);
    client.waveDelay = new Int32Array(50);
    client.lastWaveId = -1;
    client.lastWaveLoops = -1;
    client.lastWaveLength = 0;
    client.lastWaveStartTime = 0;
    client.nextMusicDelay = 0;
    client.waveEnabled = true;
    client.out = new Packet(new Uint8Array(16));
    return client;
}

describe('soundsDoQueue busy retry', () => {
    beforeEach(() => {
        wave.calls.length = 0;
        wave.results.length = 0;
        installWaveMock();
        Client.lowMem = false;
    });

    afterEach(() => {
        JagFX.generate = originalGenerate;
        Client.lowMem = false;
    });

    test('a second wave queued while one plays is retried, not dropped', async () => {
        JagFX.generate = (id: number): Packet => {
            const pos = id === 1 ? 22 : 22 * 1000;
            const buf = new Packet(new Uint8Array(pos));
            buf.pos = pos;
            return buf;
        };
        const client = probe();
        client.waveCount = 2;
        client.waveIds[0] = 1;
        client.waveLoops[0] = 1;
        client.waveDelay[0] = 0;
        client.waveIds[1] = 2;
        client.waveLoops[1] = 1;
        client.waveDelay[1] = 0;
        wave.results.push(true, false);

        await client.soundsDoQueue();

        expect(wave.calls).toEqual([22, 22000]);
        expect(client.waveCount).toBe(1);
        expect([client.waveIds[0], client.waveLoops[0], client.waveDelay[0]]).toEqual([2, 1, -5]);
        expect(client.lastWaveId).toBe(1);
        expect(client.lastWaveLoops).toBe(1);
        expect(client.out.pos).toBe(0);

        wave.results.push(true);
        await client.soundsDoQueue();
        expect(client.waveCount).toBe(0);
        expect(client.lastWaveId).toBe(2);
        expect(client.lastWaveLoops).toBe(1);
        expect(wave.calls).toEqual([22, 22000, 22000]);
    });

    test('lowmem still does not queue a delayed synth', () => {
        Client.lowMem = true;
        const client = probe();
        const input = new Packet(new Uint8Array(8));
        input.p2(52);
        input.p1(3);
        input.p2(7);
        input.pos = 0;
        client.in = input;
        expect(client.handleSynthSound()).toBe(true);
        expect(client.waveCount).toBe(0);
        expect(wave.calls).toEqual([]);
    });
});
