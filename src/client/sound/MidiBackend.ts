/**
 * Thin softsynth surface under MidiFacade (Decision 012).
 * Mirrors Java: one sequence + bank + start/stop + midivol (MidiPlayer CC volume).
 */
export type MidiBackendId = 'spessa';

export interface MidiBackend {
    readonly id: MidiBackendId;

    /** Load Florestan (or other) SF2/SF3 bytes. */
    setSoundfont(data: ArrayBuffer | Uint8Array): Promise<void>;

    /**
     * Hard-stop any current sequence, then play SMF bytes.
     * @param loop if true, loop infinitely (Java midifade==1 song); else once (jingle)
     */
    play(smf: Uint8Array, loop: boolean): Promise<void>;

    /** Hard stop — no residual voices/streams if backend allows. */
    stop(): void;

    /**
     * Java signlink.midivol 0..128 (options ladder + fade).
     * Backend should apply MidiPlayer-style channel volume (CC7/39), not invent a ladder.
     */
    setMidivol(midivol: number): void;

    /** True while a sequence is actively playing (best-effort). */
    isPlaying(): boolean;
}

/** Default channel expression base — Java MidiPlayer.resetChannels. */
export const JAVA_CHANNEL_BASE = 12800;

/**
 * Java MidiPlayer.getVolume(channelIndex) core:
 *   expr = sqrt(((channelBase * midivol) >>> 8) * channelBase) + 0.5
 * Returns 14-bit value later split into CC7 (high) / CC39 (low).
 */
export function javaGetVolume14(channelBase: number, midivol: number): number {
    const v = Math.max(0, Math.min(128, midivol | 0));
    const ch = channelBase | 0;
    if (v <= 0 || ch <= 0) {
        return 0;
    }
    const mixed = ((ch * v) >>> 8) * ch;
    return (Math.sqrt(mixed) + 0.5) | 0;
}

/**
 * Relative master gain (legacy / headroom only). Prefer setMidivol + CC injection.
 * midivol 128 → 1.0 using the same relative curve as getVolume14.
 */
export function midivolToGain(midivol: number): number {
    const v = Math.max(0, Math.min(128, midivol | 0));
    if (v <= 0) {
        return 0;
    }
    return javaGetVolume14(JAVA_CHANNEL_BASE, v) / javaGetVolume14(JAVA_CHANNEL_BASE, 128);
}
