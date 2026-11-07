import AnimFrame from '#/client/dash3d/AnimFrame.js';

import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';

export const enum PreanimMove {
    DELAYMOVE = 0,
    DELAYANIM = 1,
    MERGE = 2
}

export const enum PostanimMove {
    DELAYMOVE = 0,
    ABORTANIM = 1,
    MERGE = 2
}

export const enum RestartMode {
    RESET = 1,
    RESETLOOP = 2
}

export default class SeqType {
    static numDefinitions: number = 0;
    static list: SeqType[] = [];
    static readonly STRICT: boolean = process.env.STRICT_CONFIG === '1';

    id: number = -1;
    numFrames: number = 0;
    /** Java int[] field777/778/779: unsigned g2, including frame ids >= 32768. */
    frames: Int32Array | null = null;
    iframes: Int32Array | null = null;
    delay: Int32Array | null = null;
    loops: number = -1;
    walkmerge: Int32Array | null = null;
    reachforward: boolean = false;
    priority: number = 5;
    replaceheldleft: number = -1;
    replaceheldright: number = -1;
    maxloops: number = 99;
    preanim_move: number = -1;
    postanim_move: number = -1;
    /** Java field789 default 2 (RestartMode.RESETLOOP) */
    duplicatebehaviour: number = RestartMode.RESETLOOP;
    /** Java field790 — opcode 12 stores g4 */
    unused12: number = 0;

    static init(config: JagFile): void {
        const dat: Packet = new Packet(config.read('seq.dat'));

        this.numDefinitions = dat.g2();
        this.list = new Array(this.numDefinitions);

        for (let id: number = 0; id < this.numDefinitions; id++) {
            if (!this.list[id]) {
                this.list[id] = new SeqType();
            }

            this.list[id].id = id;
            this.list[id].decode(dat);
        }

        if (SeqType.STRICT && dat.pos !== dat.length) {
            throw new Error(`SeqType: trailing config bytes (pos ${dat.pos}, end ${dat.length})`);
        }
    }

    getDelay(frame: number) {
        if (!this.delay || !this.frames) {
            return 0;
        }

        let delay = this.delay[frame];

        if (delay === 0) {
            const transform = AnimFrame.get(this.frames[frame]);
            if (transform != null) {
                delay = this.delay[frame] = transform.delay;
            }
        }

        if (delay === 0) {
            delay = 1;
        }

        return delay;
    }

    decode(dat: Packet): void {
        while (true) {
            const code = dat.g1();
            if (code === 0) {
                break;
            }

            if (code === 1) {
                this.numFrames = dat.g1();
                this.frames = new Int32Array(this.numFrames);
                this.iframes = new Int32Array(this.numFrames);
                this.delay = new Int32Array(this.numFrames);

                for (let i: number = 0; i < this.numFrames; i++) {
                    this.frames[i] = dat.g2();

                    const iframe = dat.g2();
                    this.iframes[i] = iframe === 65535 ? -1 : iframe;

                    this.delay[i] = dat.g2();
                }
            } else if (code === 2) {
                this.loops = dat.g2();
            } else if (code === 3) {
                const count: number = dat.g1();
                this.walkmerge = new Int32Array(count + 1);

                for (let i: number = 0; i < count; i++) {
                    this.walkmerge[i] = dat.g1();
                }

                this.walkmerge[count] = 9999999;
            } else if (code === 4) {
                this.reachforward = true;
            } else if (code === 5) {
                this.priority = dat.g1();
            } else if (code === 6) {
                this.replaceheldleft = dat.g2();
            } else if (code === 7) {
                this.replaceheldright = dat.g2();
            } else if (code === 8) {
                this.maxloops = dat.g1();
            } else if (code === 9) {
                this.preanim_move = dat.g1();
            } else if (code === 10) {
                this.postanim_move = dat.g1();
            } else if (code === 11) {
                this.duplicatebehaviour = dat.g1();
            } else if (code === 12) {
                this.unused12 = dat.g4();
            } else if (SeqType.STRICT) {
                throw new Error(`SeqType ${this.id}: unknown config opcode ${code}`);
            }
        }

        if (this.numFrames === 0) {
            this.numFrames = 1;

            this.frames = new Int32Array(1);
            this.frames[0] = -1;

            this.iframes = new Int32Array(1);
            this.iframes[0] = -1;

            this.delay = new Int32Array(1);
            this.delay[0] = -1;
        }

        if (this.preanim_move === -1) {
            if (this.walkmerge === null) {
                this.preanim_move = PreanimMove.DELAYMOVE;
            } else {
                this.preanim_move = PreanimMove.MERGE;
            }
        }

        if (this.postanim_move === -1) {
            if (this.walkmerge === null) {
                this.postanim_move = PostanimMove.DELAYMOVE;
            } else {
                this.postanim_move = PostanimMove.MERGE;
            }
        }
    }
}
