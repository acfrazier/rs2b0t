/**
 * Jagex 377 MIDI control plane over stock Spessa.
 *
 * Oracle: Client-Java `sign.MidiPlayer` + `signlink` midisave / audioLoop / midivol.
 * Softsynth: Spessa (one sequencer + one SF2 bank) — browser substitute for
 * `javax.sound.midi` Sequencer/Synthesizer. We do not reimplement SoftSynth;
 * we drive a stock player with the same play/stop/loop/volume policy Java used.
 *
 * Bank: SCC1_Florestan.sf2 on the page origin (Decision 012, pitfall 28).
 * Init is play-driven so a lowmem bot never fetches the processor or bank.
 */
import type { MidiBackend } from '#/client/sound/MidiBackend.js';
import { SpessaBackend } from '#/client/sound/backends/spessaBackend.js';

const DEFAULT_MIDIVOL = 96;
const AUDIO_LOOP_MS = 50;
/** Pitfall 28: origin-absolute; the 377 engine tracks this in public/client/. */
const FLORESTAN_URL = '/client/SCC1_Florestan.sf2';

type EarlyOp = { op: 'play'; data: Uint8Array; fade: boolean } | { op: 'stop' } | { op: 'vol'; midivol: number; applyNow: boolean | undefined };

let backend: MidiBackend | null = null;
let ready = false;
let initPromise: Promise<void> | null = null;
const earlyQueue: EarlyOp[] = [];

// --- signlink-style state (Java audioLoop) ---
let midifade = 0;
let midivol = DEFAULT_MIDIVOL;
let midiCmd: 'none' | 'stop' | 'voladjust' | 'play' = 'none';
let pendingMidi: Uint8Array | null = null;
let midiFadingIn = false;
let midiFadingOut = false;
let midiFadeVol = 0;
let loopHandle: ReturnType<typeof setInterval> | null = null;

function clampMidivol(midivolJava: number): number {
    let v = midivolJava | 0;
    if (v < 0) {
        v = 0;
    }
    if (v > 128) {
        v = 128;
    }
    return v;
}

async function loadFlorestan(b: MidiBackend): Promise<boolean> {
    try {
        const res = await fetch(FLORESTAN_URL);
        if (!res.ok) {
            console.warn('[midi] SCC1_Florestan.sf2 missing — MIDI disabled until bank available');
            return false;
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 1000) {
            console.warn('[midi] SCC1_Florestan.sf2 missing — MIDI disabled until bank available');
            return false;
        }
        await b.setSoundfont(buf);
        console.info(`[midi] setSoundfont Florestan from ${FLORESTAN_URL} (${buf.byteLength} bytes)`);
        return true;
    } catch {
        console.warn('[midi] SCC1_Florestan.sf2 missing — MIDI disabled until bank available');
        return false;
    }
}

/** Java signlink → midiPlayer.setVolume(0, midivol) — CC injection inside backend. */
function applyMidivol(midivolJava: number): void {
    if (!backend) {
        return;
    }
    backend.setMidivol(midivolJava);
}

function signlinkPlayMidi(): void {
    if (!backend) {
        return;
    }
    if (midiFadingOut) {
        return;
    }
    if (!midiFadingIn && midifade !== 0 && backend.isPlaying()) {
        midiFadingOut = true;
        midiFadeVol = midivol;
        return;
    }
    if (!pendingMidi) {
        return;
    }
    try {
        const loop = midifade !== 0;
        const mid = pendingMidi;
        const onErr = (e: unknown) => console.warn('[midi] play failed', e);
        if (midifade !== 0 && midiFadingIn) {
            // Java: after fade-out, start new sequence at midiFadeVol (0) then ramp midivol.
            // Re-entry during an in-progress fade-in keeps the ramp position (don't slam 0).
            midiFadingOut = false;
            applyMidivol(midiFadeVol);
            void backend
                .play(mid, loop)
                .then(() => {
                    applyMidivol(midiFadingIn ? midiFadeVol : midivol);
                })
                .catch(onErr);
        } else {
            applyMidivol(midivol);
            void backend
                .play(mid, loop)
                .then(() => applyMidivol(midivol))
                .catch(onErr);
        }
    } catch (e) {
        console.warn('[midi] play failed', e);
    }
}

function audioLoop(): void {
    if (!backend) {
        return;
    }
    if (midiFadingIn) {
        midiFadeVol += 8;
        if (midiFadeVol > midivol) {
            midiFadeVol = midivol;
        }
        applyMidivol(midiFadeVol);
        if (midiFadeVol === midivol) {
            midiFadingIn = false;
        }
    } else if (midiFadingOut) {
        midiFadeVol -= 8;
        if (midiFadeVol < 0) {
            midiFadeVol = 0;
        }
        applyMidivol(midiFadeVol);
        if (midiFadeVol === 0) {
            midiFadingOut = false;
            midiFadingIn = true;
            midiFadeVol = 0;
        }
    }

    if (midiCmd !== 'none') {
        if (midiCmd === 'stop') {
            backend.stop();
        } else if (midiCmd === 'voladjust') {
            applyMidivol(midivol);
        } else if (midiCmd === 'play') {
            signlinkPlayMidi();
        }
        if (!midiFadingOut) {
            midiCmd = 'none';
        }
    }
}

function startAudioLoop(): void {
    if (!loopHandle) {
        loopHandle = setInterval(audioLoop, AUDIO_LOOP_MS);
    }
}

function drainEarlyQueue(): void {
    while (earlyQueue.length) {
        const item = earlyQueue.shift()!;
        try {
            if (item.op === 'play') {
                playMidiStock(item.data, item.fade);
            } else if (item.op === 'stop') {
                stopMidiStock();
            } else {
                setMidiVolumeStock(item.midivol, item.applyNow);
            }
        } catch (e) {
            console.warn('[midi] early queue item failed', e);
        }
    }
}

async function init(): Promise<void> {
    backend = new SpessaBackend();
    const ok = await loadFlorestan(backend);
    if (!ok) {
        console.warn('[midi] continuing without soundfont — plays will fail until bank loads');
    }
    applyMidivol(DEFAULT_MIDIVOL);
    startAudioLoop();
    ready = true;
    console.info('[midi] Jagex 377 control plane ready (Spessa + Florestan, master midivol)');
    drainEarlyQueue();
}

function ensureInit(): void {
    if (initPromise) {
        return;
    }
    initPromise = init().catch(err => {
        console.error('[midi] init failed', err);
    });
}

function playMidiStock(data: Uint8Array, fade: boolean): void {
    if (!data || data.length === 0) {
        return;
    }
    midifade = fade ? 1 : 0;
    pendingMidi = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
    midiCmd = 'play';
    audioLoop();
}

function stopMidiStock(): void {
    midifade = 0;
    midiFadingIn = false;
    midiFadingOut = false;
    midiCmd = 'stop';
    audioLoop();
}

function setMidiVolumeStock(midivolJava: number, applyNow?: boolean): void {
    midivol = clampMidivol(midivolJava);
    if (applyNow !== false) {
        midiCmd = 'voladjust';
        audioLoop();
    }
}

/**
 * Java saveMidi(fade, data) after midisave → path → play.
 * Volume is signlink.midivol (options clientcode 3), not per-call dB.
 */
export function playMidi(data: Uint8Array, _volumeIgnored?: number, fade?: boolean): void {
    if (!data || data.length === 0) {
        return;
    }
    const fading = !!fade;
    if (!ready || !backend) {
        earlyQueue.push({
            op: 'play',
            data: data instanceof Uint8Array ? data.slice() : new Uint8Array(data),
            fade: fading
        });
        ensureInit();
        return;
    }
    playMidiStock(data, fading);
}

/**
 * Java setMidiVolume(midiActive, midivol): always store midivol;
 * voladjust only when applyNow (music already active).
 * Does not fetch Spessa assets: lowmem option writes must stay silent on the network.
 */
export function setMidiVolume(midivolJava: number, applyNow?: boolean): void {
    midivol = clampMidivol(midivolJava);
    if (!ready || !backend) {
        earlyQueue.push({ op: 'vol', midivol: midivolJava, applyNow });
        return;
    }
    setMidiVolumeStock(midivolJava, applyNow);
}

/** Java stopMidi — midifade=0, midi="stop". No asset fetch if music never started. */
export function stopMidi(_fade?: boolean): void {
    if (!ready || !backend) {
        earlyQueue.push({ op: 'stop' });
        return;
    }
    stopMidiStock();
}

export interface MidiDebugSnapshot {
    ready: boolean;
    midiCmd: string;
    midifade: number;
    midivol: number;
    midiFadeVol: number;
    midiFadingIn: boolean;
    midiFadingOut: boolean;
    pending: number;
    playing: boolean;
}

/** Snapshot for harness / once-over probes — not a game API. */
export function debugMidi(): MidiDebugSnapshot {
    return {
        ready,
        midiCmd,
        midifade,
        midivol,
        midiFadeVol,
        midiFadingIn,
        midiFadingOut,
        pending: pendingMidi?.length ?? 0,
        playing: backend?.isPlaying() ?? false
    };
}

/** Test-only: drive the control plane with a fake backend; never fetches processor or bank. */
export function installMidiBackendForTest(b: MidiBackend): void {
    backend = b;
    ready = true;
    initPromise = Promise.resolve();
    applyMidivol(midivol);
}

/** Test-only: one Java audioLoop 50 ms step without a wall-clock interval. */
export function tickMidiFacadeForTest(): void {
    audioLoop();
}

/** Test-only: drop interval, backend and queued ops so suites do not leak. */
export function resetMidiFacadeForTest(): void {
    if (loopHandle) {
        clearInterval(loopHandle);
        loopHandle = null;
    }
    backend = null;
    ready = false;
    initPromise = null;
    earlyQueue.length = 0;
    midifade = 0;
    midivol = DEFAULT_MIDIVOL;
    midiCmd = 'none';
    pendingMidi = null;
    midiFadingIn = false;
    midiFadingOut = false;
    midiFadeVol = 0;
}
