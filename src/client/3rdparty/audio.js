// Fix iOS Audio Context by Blake Kus https://gist.github.com/kus/3f01d60569eeadefe3a1
// MIT license
//
// Browser stand-in for Java signlink.wavesave / wavereplay / wavevol.
// PCM generation stays in JagFX (1:1 Wave); this only plays bytes.
(function () {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    if (window.AudioContext) {
        window.audioContext = new window.AudioContext({ sampleRate: 22050 });
    }
    var fixAudioContext = function (e) {
        if (window.audioContext) {
            var buffer = window.audioContext.createBuffer(1, 1, 22050);
            var source = window.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(window.audioContext.destination);
            if (source.start) {
                source.start(0);
            } else if (source.play) {
                source.play(0);
            } else if (source.noteOn) {
                source.noteOn(0);
            }
        }
        document.removeEventListener('touchstart', fixAudioContext);
        document.removeEventListener('touchend', fixAudioContext);
        document.removeEventListener('click', fixAudioContext);
    };
    document.addEventListener('touchstart', fixAudioContext);
    document.addEventListener('touchend', fixAudioContext);
    document.addEventListener('click', fixAudioContext);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            if (window.audioContext) {
                window.audioContext.resume();
            }
        }
    });
})();

let waveGain = null;
/** Last successfully queued PCM (WAV bytes) for replayWave — Java wavereplay. */
let lastWaveData = null;
/** True while a play is in flight — approximate signlink.savereq busy. */
let waveBusy = false;

function ensureGain() {
    if (!window.audioContext) {
        return false;
    }
    if (!waveGain) {
        waveGain = window.audioContext.createGain();
        waveGain.connect(window.audioContext.destination);
        waveGain.gain.value = 1;
    }
    return true;
}

/**
 * Java signlink.wavesave — queue PCM for play.
 * @returns {Promise<boolean>} false if busy (Java: savereq != null)
 */
export async function playWave(data) {
    if (!data || data.length === 0) {
        return true; // Java saveWave(null) → true
    }
    if (waveBusy) {
        return false;
    }
    if (!ensureGain()) {
        return false;
    }

    waveBusy = true;
    try {
        // Copy so lastWaveData outlives the generate buffer reuse (shared JagFX waveBytes)
        const copy = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
        lastWaveData = copy;

        const ab = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
        const audioBuffer = await window.audioContext.decodeAudioData(ab);
        const bufferSource = window.audioContext.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(waveGain);
        const clearBusy = () => {
            waveBusy = false;
        };
        bufferSource.onended = clearBusy;
        // Safety if onended is skipped (suspend / browser quirks)
        setTimeout(clearBusy, Math.max(50, (audioBuffer.duration * 1000) | 0) + 100);
        bufferSource.start();
        return true;
    } catch (e) {
        console.error(e);
        waveBusy = false;
        return false;
    }
}

/**
 * Java signlink.wavereplay — re-queue last wave if not busy.
 * @returns {Promise<boolean>}
 */
export async function replayWave() {
    if (waveBusy) {
        return false;
    }
    if (!lastWaveData) {
        return false;
    }
    // Re-play without regenerating synth (Java reuses savebuf)
    return playWave(lastWaveData);
}

/** Java signlink.wavevol — arg is dB-style like client options. */
export function setWaveVolume(dB) {
    if (!ensureGain()) {
        return;
    }
    waveGain.gain.value = Math.pow(10, dB / 20);
}
