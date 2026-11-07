import VarpType from '#/client/config/VarpType.js';

import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';

export default class VarBitType {
    static numDefinitions: number = 0;
    static list: VarBitType[] = [];
    static readonly STRICT: boolean = process.env.STRICT_CONFIG === '1';

    basevar: number = -1;
    startbit: number = 0;
    endbit: number = 0;
    debugname: string = '';
    /** Java field1765 — opcode 2; also marks VarpType.scope during unpack */
    unused2: boolean = false;
    /** Java field1766 — opcode 3; default -1 */
    unused3: number = -1;
    /** Java field1767 — opcode 4 */
    unused4: number = 0;
    /** Java field1768 — opcode 5 clears; default true */
    unused5: boolean = true;

    static init(config: JagFile): void {
        const dat: Packet = new Packet(config.read('varbit.dat'));

        this.numDefinitions = dat.g2();
        this.list = new Array(this.numDefinitions);

        for (let id: number = 0; id < this.numDefinitions; id++) {
            if (!this.list[id]) {
                this.list[id] = new VarBitType();
            }

            this.list[id].decode(dat);

            // Java VarbitType.unpack: if field1765, mark linked VarpType.field1519
            if (this.list[id].unused2) {
                const base = this.list[id].basevar;
                if (base >= 0 && base < VarpType.list.length) {
                    VarpType.list[base].scope = true;
                }
            }
        }

        if (this.STRICT && dat.pos !== dat.length) {
            throw new Error(`VarBitType: trailing config bytes (pos ${dat.pos}, end ${dat.length})`);
        } else if (dat.pos != dat.data.length) {
            console.log('varbit load mismatch');
        }
    }

    /**
     * Port of Client-Java `VarbitType.method603` (377).
     */
    decode(dat: Packet): void {
        while (true) {
            const code = dat.g1();
            if (code === 0) {
                break;
            }

            if (code === 1) {
                this.basevar = dat.g2();
                this.startbit = dat.g1();
                this.endbit = dat.g1();
            } else if (code === 10) {
                this.debugname = dat.gjstr();
            } else if (code === 2) {
                this.unused2 = true;
            } else if (code === 3) {
                this.unused3 = dat.g4();
            } else if (code === 4) {
                this.unused4 = dat.g4();
            } else if (code === 5) {
                this.unused5 = false;
            } else if (VarBitType.STRICT) {
                throw new Error(`VarBitType: unknown config opcode ${code}`);
            } else {
                console.log('Error unrecognised config code: ', code);
            }
        }
    }
}
