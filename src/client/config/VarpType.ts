import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';

export default class VarpType {
    static numDefinitions: number = 0;
    static list: VarpType[] = [];
    static readonly STRICT: boolean = process.env.STRICT_CONFIG === '1';
    /** Java field1508 — count of transmit-to-server varps */
    static codeCount: number = 0;
    /** Java field1509 — ids of transmit-to-server varps (opcode 3) */
    static codeIds: Int32Array | null = null;

    /** Java field1511 — opcode 1 */
    type: number = 0;
    /** Java field1512 — opcode 2 */
    type2: number = 0;
    /** Java field1513 — opcode 3 */
    transmit: boolean = false;
    /** Java field1514 — opcode 4 clears; default true */
    keepBit: boolean = true;
    /** Java field1515 — opcode 5 (client-side behaviour) */
    clientcode: number = 0;
    /** Java field1516 — opcode 6 */
    protect: boolean = false;
    /** Java field1517 — opcode 7 */
    unused7: number = 0;
    /** Java field1518 — 1 from opcode 8, 2 from opcode 13 */
    scopeType: number = 0;
    /** Java field1519 — set by opcodes 8/11/13 and VarBitType opcode 2 */
    scope: boolean = false;
    /** Java field1520 — opcode 12; default -1 */
    unused12: number = -1;
    /** Java field1521 — opcode 14 clears; default true */
    unused14: boolean = true;
    /** Java field1510 — opcode 10 */
    debugname: string = '';

    static init(config: JagFile): void {
        const dat: Packet = new Packet(config.read('varp.dat'));

        this.codeCount = 0;
        this.numDefinitions = dat.g2();
        this.list = new Array(this.numDefinitions);
        this.codeIds = new Int32Array(this.numDefinitions);

        for (let id: number = 0; id < this.numDefinitions; id++) {
            if (!this.list[id]) {
                this.list[id] = new VarpType();
            }

            this.list[id].decode(id, dat);
        }

        if (this.STRICT && dat.pos !== dat.length) {
            throw new Error(`VarpType: trailing config bytes (pos ${dat.pos}, end ${dat.length})`);
        } else if (dat.pos != dat.data.length) {
            console.log('varptype load mismatch');
        }
    }

    /**
     * Port of Client-Java `VarpType.method485` (377).
     */
    decode(id: number, dat: Packet): void {
        while (true) {
            const code = dat.g1();
            if (code === 0) {
                break;
            }

            if (code === 1) {
                this.type = dat.g1();
            } else if (code === 2) {
                this.type2 = dat.g1();
            } else if (code === 3) {
                this.transmit = true;
                if (VarpType.codeIds) {
                    VarpType.codeIds[VarpType.codeCount++] = id;
                }
            } else if (code === 4) {
                this.keepBit = false;
            } else if (code === 5) {
                this.clientcode = dat.g2();
            } else if (code === 6) {
                this.protect = true;
            } else if (code === 7) {
                this.unused7 = dat.g4();
            } else if (code === 8) {
                this.scopeType = 1;
                this.scope = true;
            } else if (code === 10) {
                this.debugname = dat.gjstr();
            } else if (code === 11) {
                this.scope = true;
            } else if (code === 12) {
                this.unused12 = dat.g4();
            } else if (code === 13) {
                this.scopeType = 2;
                this.scope = true;
            } else if (code === 14) {
                this.unused14 = false;
            } else if (VarpType.STRICT) {
                throw new Error(`VarpType ${id}: unknown config opcode ${code}`);
            } else {
                console.log('Error unrecognised config code: ', code);
            }
        }
    }
}
