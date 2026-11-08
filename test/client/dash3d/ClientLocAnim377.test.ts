import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
// Why: mock.module has to run before the client modules load, and static imports are hoisted above it.

const { Client } = await import('#/client/shell/Client.js');
const { default: ClientLocAnim } = await import('#/client/dash3d/ClientLocAnim.js');
const { default: LocType } = await import('#/client/config/LocType.js');
const { default: SeqType } = await import('#/client/config/SeqType.js');

type Loc = InstanceType<typeof LocType>;
type Seq = InstanceType<typeof SeqType>;

interface Call {
    shape: number;
    angle: number;
    heights: number[];
    frame: number;
}

const calls: Call[] = [];
const origLoc = LocType.list;
const origSeq = SeqType.list;
const origCycle = Client.loopCycle;

function seq(delays: number[], frames: number[], loops: number): Seq {
    const s = Object.create(SeqType.prototype) as Seq;
    s.numFrames = delays.length;
    s.delay = Int32Array.from(delays);
    s.frames = Int32Array.from(frames);
    s.loops = loops;
    return s;
}

interface JavaState {
    seq: Seq | null;
    frame: number;
    cycle: number;
}

// Client-Java 377 ClientLocAnim.method239 (the frame bookkeeping), transcribed with its label and nested loops.
function javaFrame(state: JavaState, loopCycle: number): number {
    let frame = -1;
    if (state.seq) {
        let elapsed = loopCycle - state.cycle;
        if (elapsed > 100 && state.seq.loops > 0) {
            elapsed = 100;
        }
        done: {
            do {
                do {
                    if (elapsed <= state.seq.getDelay(state.frame)) {
                        break done;
                    }
                    elapsed -= state.seq.getDelay(state.frame);
                    state.frame++;
                } while (state.frame < state.seq.numFrames);
                state.frame -= state.seq.loops;
            } while (state.frame >= 0 && state.frame < state.seq.numFrames);
            state.seq = null;
        }
        state.cycle = loopCycle - elapsed;
        if (state.seq) {
            frame = state.seq.frames![state.frame];
        }
    }
    return frame;
}

beforeEach(() => {
    calls.length = 0;
    const loc = Object.create(LocType.prototype) as Loc;
    loc.id = 7;
    loc.multiloc = [];
    loc.multivarbit = -1;
    loc.getModel = ((shape: number, angle: number, sw: number, se: number, ne: number, nw: number, frame: number) => {
        calls.push({ shape, angle, heights: [sw, se, ne, nw], frame });
        return null;
    }) as Loc['getModel'];
    LocType.list = (() => loc) as typeof LocType.list;
    SeqType.list = [];
});

afterEach(() => {
    LocType.list = origLoc;
    SeqType.list = origSeq;
    Client.loopCycle = origCycle;
});

describe('ClientLocAnim (Client-Java 377)', () => {
    test('starts one cycle behind the build cycle so the first draw advances', () => {
        SeqType.list[3] = seq([4, 6, 5], [10, 11, 12], 1);
        Client.loopCycle = 1000;
        const anim = new ClientLocAnim(7, 10, 1, 1, 2, 3, 4, 3, false);
        expect(anim.animCycle).toBe(999);
        expect(anim.animFrame).toBe(0);
    });

    test('draws the same frame as the Java frame loop on every cycle', () => {
        for (const [delays, loops] of [
            [[4, 6, 5], 1],
            [[4, 6, 5], 0],
            [[4, 6, 5], -1],
            [[2, 2], 2]
        ] as [number[], number][]) {
            SeqType.list[3] = seq(delays, delays.map((_, i) => 20 + i), loops);
            Client.loopCycle = 1000;
            const anim = new ClientLocAnim(7, 10, 1, 1, 2, 3, 4, 3, false);
            const java: JavaState = { seq: SeqType.list[3], frame: 0, cycle: 999 };

            calls.length = 0;
            for (let cycle = 1000; cycle < 1060; cycle += cycle % 7 === 0 ? 5 : 1) {
                Client.loopCycle = cycle;
                anim.getTempModel();
                expect(calls.at(-1)?.frame).toBe(javaFrame(java, cycle));
            }
        }
    });

    test('a long gap is clamped to 100 cycles on a looping sequence only', () => {
        SeqType.list[3] = seq([4, 6, 5], [10, 11, 12], 1);
        Client.loopCycle = 1000;
        const anim = new ClientLocAnim(7, 10, 1, 1, 2, 3, 4, 3, false);
        const java: JavaState = { seq: SeqType.list[3], frame: 0, cycle: 999 };
        Client.loopCycle = 5000;
        anim.getTempModel();
        expect(calls.at(-1)?.frame).toBe(javaFrame(java, 5000));
    });

    test('a multiloc-only loc has no sequence and draws frame -1 with the placement geometry', () => {
        Client.loopCycle = 1000;
        const anim = new ClientLocAnim(7, 22, 3, 10, 20, 30, 40, -1, true);
        expect(anim.anim).toBeNull();
        expect(anim.animCycle).toBe(999);

        anim.getTempModel();
        expect(calls).toEqual([{ shape: 22, angle: 3, heights: [10, 20, 30, 40], frame: -1 }]);
    });
});
