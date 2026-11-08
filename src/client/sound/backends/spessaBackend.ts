/**
 * SpessaSynth (Apache-2.0) backend — stock WorkletSynthesizer + Sequencer.
 *
 * Volume: master GainNode only, Java midivol relative curve (Decision 012).
 * Spessa plays the SMF as-is (including song CC7 automation). midivol is the
 * outer options fader — not CC injection (lock muted us; intercept thrashed FPS).
 *
 * Processor URL is relative to the bundle (pitfall 28): /bot/<tag>/ or /rs2b0t/bot/,
 * never the engine's absolute /client/ path.
 */
import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';

import type { MidiBackend } from '#/client/sound/MidiBackend.js';
import { midivolToGain } from '#/client/sound/MidiBackend.js';

type AudioWindow = Window & {
    AudioContext: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
};

function audioWindow(): AudioWindow {
    return window as AudioWindow;
}

/** Pitfall 28: resolve the worklet next to botclient.js / client.js, not /client/. */
export function spessaProcessorUrl(): string {
    if (typeof document !== 'undefined' && document.location) {
        const loc = document.location;
        const isolated = /^\/bot-([^/.]+)\.html$/.exec(loc.pathname);
        if (isolated) {
            return new URL(`/bot/${isolated[1]}/spessasynth_processor.min.js`, loc.href).href;
        }
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i]?.src;
            if (!src) {
                continue;
            }
            if (src.includes('botclient.js') || /(?:^|\/)client\.js(?:\?|$)/.test(src)) {
                return new URL('spessasynth_processor.min.js', src).href;
            }
        }
        if (loc.pathname.startsWith('/rs2b0t/')) {
            return new URL('/rs2b0t/bot/spessasynth_processor.min.js', loc.href).href;
        }
    }
    if (typeof import.meta.url === 'string' && import.meta.url.length > 0 && !import.meta.url.startsWith('file:')) {
        return new URL('spessasynth_processor.min.js', import.meta.url).href;
    }
    return 'spessasynth_processor.min.js';
}

export class SpessaBackend implements MidiBackend {
    readonly id = 'spessa' as const;

    private ctx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private synth: WorkletSynthesizer | null = null;
    private seq: Sequencer | null = null;
    private ready = false;
    private playing = false;
    private soundfontLoaded = false;
    private midivol = 96;
    private unlockInstalled = false;
    /** Incremented at each play() so a superseded load never calls seq.play(). */
    private playGen = 0;

    /**
     * Browser autoplay: AudioContext starts `suspended` until a user gesture.
     * `ctx.resume()` may **never resolve** until focus/click — do not await it
     * unbounded or SF2 load / song load holds the whole MIDI init path (and
     * feels like the client is stuck until the window is focused).
     */
    private async tryResume(maxWaitMs = 80): Promise<void> {
        if (!this.ctx || this.ctx.state !== 'suspended') {
            return;
        }
        try {
            const { promise: timeout, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve, maxWaitMs);
            await Promise.race([this.ctx.resume().catch(() => {}), timeout]);
        } catch {
            /* still suspended — unlock listeners will retry */
        }
    }

    /** One-shot + visibility unlock so music starts when the tab is focused/clicked. */
    private installUnlock(): void {
        if (this.unlockInstalled || !this.ctx) {
            return;
        }
        this.unlockInstalled = true;
        const ctx = this.ctx;
        const kick = () => {
            if (ctx.state === 'suspended') {
                void ctx.resume().catch(() => {});
            }
        };
        for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown'] as const) {
            window.addEventListener(ev, kick, { capture: true, passive: true });
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                kick();
            }
        });
        window.addEventListener('focus', kick);
    }

    private async ensure(): Promise<void> {
        if (this.ready && this.synth && this.seq) {
            return;
        }
        const w = audioWindow();
        if (!w.audioContext) {
            w.AudioContext = w.AudioContext || w.webkitAudioContext!;
            w.audioContext = new w.AudioContext({ sampleRate: 22050 });
        }
        this.ctx = w.audioContext;
        this.installUnlock();
        // Bounded: never block SF2/worklet setup on autoplay policy
        await this.tryResume(80);

        const processor = spessaProcessorUrl();
        console.info(`[midi:spessa] addModule ${processor}`);
        await this.ctx.audioWorklet.addModule(processor);

        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = midivolToGain(this.midivol);
        this.gainNode.connect(this.ctx.destination);

        // eventsEnabled MUST be true: Spessa only posts sequencerReturn (songChange,
        // songListChange, …) when enabled. With false, loadNewSongList never completes
        // on the main thread → play waits forever → mute.
        this.synth = new WorkletSynthesizer(this.ctx, { eventsEnabled: true });
        this.synth.connect(this.gainNode);
        await this.synth.isReady;

        this.seq = new Sequencer(this.synth);
        this.seq.eventHandler.addEvent('songEnded', 'midi-backend', () => {
            this.playing = false;
        });

        this.ready = true;
        console.info('[midi:spessa] ready (master midivol gain only)');
    }

    private applyMasterGain(): void {
        if (!this.gainNode || !this.ctx) {
            return;
        }
        const g = midivolToGain(this.midivol);
        const t = this.ctx.currentTime;
        this.gainNode.gain.cancelScheduledValues(t);
        this.gainNode.gain.setValueAtTime(g, t);
    }

    private copyToArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
        if (data instanceof ArrayBuffer) {
            return data.slice(0);
        }
        return data.slice().buffer as ArrayBuffer;
    }

    async setSoundfont(data: ArrayBuffer | Uint8Array): Promise<void> {
        await this.ensure();
        const ab = this.copyToArrayBuffer(data);
        const nbytes = ab.byteLength;
        await this.synth!.soundBankManager.addSoundBank(ab, 'main');
        this.soundfontLoaded = true;
        console.info(`[midi:spessa] soundfont loaded (${nbytes} bytes)`);
    }

    async play(smf: Uint8Array, loop: boolean): Promise<void> {
        await this.ensure();
        if (!this.soundfontLoaded) {
            throw new Error('[midi:spessa] setSoundfont before play');
        }
        // Bounded resume — full unlock on next gesture/focus via installUnlock
        await this.tryResume(80);

        const gen = ++this.playGen;
        this.stop();

        const ab = this.copyToArrayBuffer(smf);
        const { promise: loaded, resolve, reject } = Promise.withResolvers<void>();
        const tid = 'midi-backend-load';
        const eid = 'midi-backend-err';
        const cleanup = () => {
            try {
                this.seq!.eventHandler.removeEvent('songChange', tid);
            } catch {
                /* ignore */
            }
            try {
                this.seq!.eventHandler.removeEvent('midiError', eid);
            } catch {
                /* ignore */
            }
        };
        // 4s not 15s: suspended audio often never fires songChange until focus;
        // long hangs felt like the client was stuck.
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('[midi:spessa] loadNewSongList timed out'));
        }, 4000);
        this.seq!.eventHandler.addEvent('songChange', tid, () => {
            clearTimeout(timer);
            cleanup();
            resolve();
        });
        this.seq!.eventHandler.addEvent('midiError', eid, (err: unknown) => {
            clearTimeout(timer);
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
        });
        try {
            this.seq!.loadNewSongList([{ binary: ab, fileName: 'song.mid' }]);
        } catch (e) {
            clearTimeout(timer);
            cleanup();
            reject(e);
        }
        await loaded;

        if (gen !== this.playGen) {
            return;
        }

        this.seq!.loopCount = loop ? -1 : 0;
        // Java MidiPlayer.play = setSequence + start from the beginning.
        // Seeking stop() to old duration leaked pausedTime into seq.play() so the
        // new track started minutes in (or looked like it never changed).
        try {
            this.seq!.currentTime = 0;
        } catch {
            /* ignore */
        }
        this.seq!.play();
        this.playing = true;
        // Do not applyMasterGain here — MidiFacade owns midivol / fade ±8.
        // Slamming gain to this.midivol (often 0 at fade-in start) cancelled the ramp.
        console.info(`[midi:spessa] play smf=${smf.byteLength}B loop=${loop} duration=${(this.seq!.duration ?? 0).toFixed(2)}s midivol=${this.midivol} gain=${midivolToGain(this.midivol).toFixed(3)} t=${(this.seq!.currentTime ?? 0).toFixed(2)}`);
    }

    stop(): void {
        if (!this.seq) {
            return;
        }
        // Java MidiPlayer.stop = sequencer.stop + all-notes-off. Do not seek to
        // duration: Spessa treats time>=duration as loop/restart, and the main
        // thread pausedTime becomes the old song length (track swap starts late).
        try {
            this.seq.pause();
        } catch {
            /* ignore */
        }
        try {
            this.synth?.stopAll(true);
        } catch {
            /* ignore */
        }
        this.playing = false;
    }

    setMidivol(midivol: number): void {
        let v = midivol | 0;
        if (v < 0) {
            v = 0;
        }
        if (v > 128) {
            v = 128;
        }
        this.midivol = v;
        this.applyMasterGain();
    }

    isPlaying(): boolean {
        return this.playing && !!this.seq && !this.seq.paused && !this.seq.isFinished;
    }
}
