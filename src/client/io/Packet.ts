import Linkable2 from '#/client/datastruct/Linkable2.js';
import LinkList from '#/client/datastruct/LinkList.js';

import Isaac from '#/client/io/Isaac.js';

import { bigIntModPow, bigIntToBytes, bytesToBigInt } from '#/client/util/JsUtil.js';

export default class Packet extends Linkable2 {
    private static readonly CRC32_POLYNOMIAL: number = 0xedb88320;

    private static readonly crctable: Int32Array = new Int32Array(256);
    private static readonly bitmask: Uint32Array = new Uint32Array(33);

    private static readonly cacheMin: LinkList<Packet> = new LinkList();
    private static readonly cacheMid: LinkList<Packet> = new LinkList();
    private static readonly cacheMax: LinkList<Packet> = new LinkList();

    private static cacheMinCount: number = 0;
    private static cacheMidCount: number = 0;
    private static cacheMaxCount: number = 0;

    static {
        for (let i: number = 0; i < 32; i++) {
            Packet.bitmask[i] = (1 << i) - 1;
        }
        Packet.bitmask[32] = 0xffffffff;

        for (let i: number = 0; i < 256; i++) {
            let remainder: number = i;

            for (let bit: number = 0; bit < 8; bit++) {
                if ((remainder & 1) === 1) {
                    remainder = (remainder >>> 1) ^ Packet.CRC32_POLYNOMIAL;
                } else {
                    remainder >>>= 1;
                }
            }

            Packet.crctable[i] = remainder;
        }
    }

    static getcrc(src: Uint8Array, offset: number, length: number): number {
        let crc = 0xffffffff;
        for (let i = offset; i < length; i++) {
            crc = (crc >>> 8) ^ this.crctable[(crc ^ src[i]) & 0xff];
        }
        return ~crc;
    }

    static checkcrc(src: Uint8Array, offset: number, length: number, expected: number = 0): boolean {
        return Packet.getcrc(src, offset, length) == expected;
    }

    private readonly view: DataView;
    readonly data: Uint8Array;

    pos: number = 0;
    bitPos: number = 0;
    random: Isaac | null = null;

    constructor(src: Uint8Array | Int8Array | null) {
        if (!src) {
            throw new Error();
        }

        super();

        if (src instanceof Int8Array) {
            this.data = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
        } else {
            this.data = src;
        }

        this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    }

    get length(): number {
        return this.view.byteLength;
    }

    get available(): number {
        return this.view.byteLength - this.pos;
    }

    static alloc(type: number): Packet {
        let cached: Packet | null = null;
        if (type === 0 && Packet.cacheMinCount > 0) {
            Packet.cacheMinCount--;
            cached = Packet.cacheMin.popFront();
        } else if (type === 1 && Packet.cacheMidCount > 0) {
            Packet.cacheMidCount--;
            cached = Packet.cacheMid.popFront();
        } else if (type === 2 && Packet.cacheMaxCount > 0) {
            Packet.cacheMaxCount--;
            cached = Packet.cacheMax.popFront();
        }

        if (cached) {
            cached.pos = 0;
            return cached;
        }

        if (type === 0) {
            return new Packet(new Uint8Array(100));
        } else if (type === 1) {
            return new Packet(new Uint8Array(5000));
        } else {
            return new Packet(new Uint8Array(30000));
        }
    }

    release(): void {
        this.pos = 0;

        if (this.length === 100 && Packet.cacheMinCount < 1000) {
            Packet.cacheMin.push(this);
            Packet.cacheMinCount++;
        } else if (this.length === 5000 && Packet.cacheMidCount < 250) {
            Packet.cacheMid.push(this);
            Packet.cacheMidCount++;
        } else if (this.length === 30000 && Packet.cacheMaxCount < 50) {
            Packet.cacheMax.push(this);
            Packet.cacheMaxCount++;
        }
    }

    g1(): number {
        return this.view.getUint8(this.pos++);
    }

    g1b(): number {
        return this.view.getInt8(this.pos++);
    }

    g2(): number {
        const result: number = this.view.getUint16(this.pos);
        this.pos += 2;
        return result;
    }

    g2b(): number {
        const result: number = this.view.getInt16(this.pos);
        this.pos += 2;
        return result;
    }

    g3(): number {
        const result: number = (this.view.getUint8(this.pos++) << 16) | this.view.getUint16(this.pos);
        this.pos += 2;
        return result;
    }

    g4(): number {
        const result: number = this.view.getInt32(this.pos);
        this.pos += 4;
        return result;
    }

    // --- 377 alternate encodings from Client-TS 377 ---

    g1_alt1(): number {
        return (this.data[this.pos++] - 128) & 0xff;
    }

    g1_alt2(): number {
        return (-this.data[this.pos++]) & 0xff;
    }

    g1_alt3(): number {
        return (128 - this.data[this.pos++]) & 0xff;
    }

    g1b_alt1(): number {
        const value = (this.data[this.pos++] - 128) & 0xff;
        return value > 127 ? value - 256 : value;
    }

    g1b_alt2(): number {
        const value = (-this.data[this.pos++]) & 0xff;
        return value > 127 ? value - 256 : value;
    }

    g1b_alt3(): number {
        const value = (128 - this.data[this.pos++]) & 0xff;
        return value > 127 ? value - 256 : value;
    }

    g2_alt1(): number {
        this.pos += 2;
        return ((this.data[this.pos - 1] & 0xff) << 8) + (this.data[this.pos - 2] & 0xff);
    }

    g2_alt2(): number {
        this.pos += 2;
        return ((this.data[this.pos - 2] & 0xff) << 8) + ((this.data[this.pos - 1] - 128) & 0xff);
    }

    g2_alt3(): number {
        this.pos += 2;
        return ((this.data[this.pos - 1] & 0xff) << 8) + ((this.data[this.pos - 2] - 128) & 0xff);
    }

    g2s_alt1(): number {
        return this.g2b_alt1();
    }

    g2s_alt2(): number {
        return this.g2b_alt2();
    }

    g2s_alt3(): number {
        this.pos += 2;
        const value = ((this.data[this.pos - 1] & 0xff) << 8) + ((this.data[this.pos - 2] - 128) & 0xff);
        return value > 32767 ? value - 65536 : value;
    }

    g2b_alt1(): number {
        this.pos += 2;
        let value = ((this.data[this.pos - 1] & 0xff) << 8) + (this.data[this.pos - 2] & 0xff);
        if (value > 32767) value -= 65536;
        return value;
    }

    g2b_alt2(): number {
        this.pos += 2;
        let value = ((this.data[this.pos - 2] & 0xff) << 8) + ((this.data[this.pos - 1] - 128) & 0xff);
        if (value > 32767) value -= 65536;
        return value;
    }

    g3_alt1(): number {
        this.pos += 3;
        return (
            ((this.data[this.pos - 1] & 0xff) << 16) +
            ((this.data[this.pos - 2] & 0xff) << 8) +
            (this.data[this.pos - 3] & 0xff)
        );
    }

    g3_alt2(): number {
        this.pos += 3;
        return (
            ((this.data[this.pos - 3] & 0xff) << 16) +
            ((this.data[this.pos - 1] & 0xff) << 8) +
            (this.data[this.pos - 2] & 0xff)
        );
    }

    g3_alt3(): number {
        this.pos += 3;
        return (
            (this.data[this.pos - 1] & 0xff) +
            ((this.data[this.pos - 2] & 0xff) << 16) +
            ((this.data[this.pos - 3] & 0xff) << 8)
        );
    }

    g3s_alt1(): number {
        this.pos += 3;
        const value =
            ((this.data[this.pos - 1] & 0xff) << 16) +
            ((this.data[this.pos - 2] & 0xff) << 8) +
            (this.data[this.pos - 3] & 0xff);
        return value > 0xffffff ? value - 0x1000000 : value;
    }

    g3s_alt2(): number {
        this.pos += 3;
        const value =
            ((this.data[this.pos - 3] & 0xff) << 16) +
            ((this.data[this.pos - 1] & 0xff) << 8) +
            (this.data[this.pos - 2] & 0xff);
        return value > 0xffffff ? value - 0x1000000 : value;
    }

    g3s_alt3(): number {
        this.pos += 3;
        const value =
            ((this.data[this.pos - 2] & 0xff) << 16) +
            ((this.data[this.pos - 3] & 0xff) << 8) +
            (this.data[this.pos - 1] & 0xff);
        return value > 0xffffff ? value - 0x1000000 : value;
    }

    g4_alt1(): number {
        this.pos += 4;
        return (
            (this.data[this.pos - 4] & 0xff) +
            ((this.data[this.pos - 3] & 0xff) << 8) +
            ((this.data[this.pos - 1] & 0xff) << 24) +
            ((this.data[this.pos - 2] & 0xff) << 16)
        );
    }

    g4_alt2(): number {
        this.pos += 4;
        return (
            (this.data[this.pos - 3] & 0xff) +
            ((this.data[this.pos - 4] & 0xff) << 8) +
            ((this.data[this.pos - 2] & 0xff) << 24) +
            ((this.data[this.pos - 1] & 0xff) << 16)
        );
    }

    g4_alt3(): number {
        this.pos += 4;
        return (
            (this.data[this.pos - 2] & 0xff) +
            ((this.data[this.pos - 1] & 0xff) << 8) +
            ((this.data[this.pos - 3] & 0xff) << 24) +
            ((this.data[this.pos - 4] & 0xff) << 16)
        );
    }

    g4s_alt1(): number {
        this.pos += 4;
        const value =
            ((this.data[this.pos - 1] & 0xff) << 24) +
            ((this.data[this.pos - 2] & 0xff) << 16) +
            ((this.data[this.pos - 3] & 0xff) << 8) +
            (this.data[this.pos - 4] & 0xff);
        return value > 0x7fffffff ? value - 0x100000000 : value;
    }

    g4s_alt2(): number {
        this.pos += 4;
        const value =
            ((this.data[this.pos - 2] & 0xff) << 24) +
            ((this.data[this.pos - 1] & 0xff) << 16) +
            ((this.data[this.pos - 4] & 0xff) << 8) +
            (this.data[this.pos - 3] & 0xff);
        return value > 0x7fffffff ? value - 0x100000000 : value;
    }

    g4s_alt3(): number {
        this.pos += 4;
        const value =
            ((this.data[this.pos - 3] & 0xff) << 24) +
            ((this.data[this.pos - 4] & 0xff) << 16) +
            ((this.data[this.pos - 1] & 0xff) << 8) +
            (this.data[this.pos - 2] & 0xff);
        return value > 0x7fffffff ? value - 0x100000000 : value;
    }

    g8(): bigint {
        const result: bigint = this.view.getBigInt64(this.pos);
        this.pos += 8;
        return result;
    }

    gsmarts(): number {
        return this.view.getUint8(this.pos) < 0x80 ? this.g1() - 0x40 : this.g2() - 0xc000;
    }

    gsmart(): number {
        return this.view.getUint8(this.pos) < 0x80 ? this.g1() : this.g2() - 0x8000;
    }

    gjstr(): string {
        const view: DataView = this.view;
        const length: number = view.byteLength;
        let str: string = '';
        let b: number;
        while ((b = view.getUint8(this.pos++)) !== 10 && this.pos < length) {
            str += String.fromCharCode(b);
        }
        return str;
    }


    gdata(length: number, offset: number, dest: Uint8Array | Int8Array): void {
        dest.set(this.data.subarray(this.pos, this.pos + length), offset);
        this.pos += length;
    }

    gdata_alt1(dest: Uint8Array | Int8Array, offset: number, length: number): void {
        for (let i = offset + length - 1; i >= offset; i--) {
            dest[i] = this.data[this.pos++];
        }
    }

    gdata_alt2(dest: Uint8Array | Int8Array, offset: number, length: number): void {
        for (let i = offset; i < offset + length; i++) {
            dest[i] = (this.data[this.pos++] - 128) & 0xff;
        }
    }

    gdata_alt3(dest: Uint8Array | Int8Array, offset: number, length: number): void {
        for (let i = offset + length - 1; i >= offset; i--) {
            dest[i] = (this.data[this.pos++] - 128) & 0xff;
        }
    }

    p1Enc(opcode: number): void {
        this.view.setUint8(this.pos++, (opcode + (this.random?.nextInt ?? 0)) & 0xff);
    }

    p1(value: number): void {
        this.view.setUint8(this.pos++, value);
    }

    p1_alt1(value: number): void {
        this.view.setUint8(this.pos++, (value + 128) & 0xff);
    }

    p1_alt2(value: number): void {
        this.view.setUint8(this.pos++, (-value) & 0xff);
    }

    p1_alt3(value: number): void {
        this.view.setUint8(this.pos++, (128 - value) & 0xff);
    }

    p2(value: number): void {
        this.view.setUint16(this.pos, value);
        this.pos += 2;
    }

    ip2(value: number): void {
        this.view.setUint16(this.pos, value, true);
        this.pos += 2;
    }

    p2_alt1(value: number): void {
        this.data[this.pos++] = value;
        this.data[this.pos++] = value >> 8;
    }

    p2_alt2(value: number): void {
        this.data[this.pos++] = value >> 8;
        this.data[this.pos++] = value + 128;
    }

    p2_alt3(value: number): void {
        this.data[this.pos++] = value + 128;
        this.data[this.pos++] = value >> 8;
    }

    p3(value: number): void {
        this.view.setUint8(this.pos++, value >> 16);
        this.view.setUint16(this.pos, value);
        this.pos += 2;
    }

    p4(value: number): void {
        this.view.setInt32(this.pos, value);
        this.pos += 4;
    }

    ip4(value: number): void {
        this.view.setInt32(this.pos, value, true);
        this.pos += 4;
    }

    p8(value: bigint): void {
        this.view.setBigInt64(this.pos, value);
        this.pos += 8;
    }

    pjstr(str: string): void {
        const view: DataView = this.view;
        const length: number = str.length;
        for (let i: number = 0; i < length; i++) {
            view.setUint8(this.pos++, str.charCodeAt(i));
        }
        view.setUint8(this.pos++, 10);
    }

    pdata(src: Uint8Array, offset: number, length: number): void {
        this.data.set(src.subarray(offset, offset + length), this.pos);
        this.pos += length;
    }

    psize1(size: number): void {
        this.view.setUint8(this.pos - size - 1, size);
    }

    gBitStart(): void {
        this.bitPos = this.pos << 3;
    }

    gBitEnd(): void {
        this.pos = (this.bitPos + 7) >>> 3;
    }

    gBit(n: number): number {
        let bytePos: number = this.bitPos >>> 3;
        let remaining: number = 8 - (this.bitPos & 7);
        let value: number = 0;
        this.bitPos += n;

        for (; n > remaining; remaining = 8) {
            value += (this.view.getUint8(bytePos++) & Packet.bitmask[remaining]) << (n - remaining);
            n -= remaining;
        }

        if (n === remaining) {
            value += this.view.getUint8(bytePos) & Packet.bitmask[remaining];
        } else {
            value += (this.view.getUint8(bytePos) >>> (remaining - n)) & Packet.bitmask[n];
        }

        return value;
    }

    rsaenc(mod: bigint, exp: bigint): void {
        const length: number = this.pos;
        this.pos = 0;

        const temp: Uint8Array = new Uint8Array(length);
        this.gdata(length, 0, temp);

        const bigRaw: bigint = bytesToBigInt(temp);
        const bigEnc: bigint = bigIntModPow(bigRaw, exp, mod);
        const rawEnc: Uint8Array = bigIntToBytes(bigEnc);

        this.pos = 0;
        this.p1(rawEnc.length);
        this.pdata(rawEnc, 0, rawEnc.length);
    }
}
