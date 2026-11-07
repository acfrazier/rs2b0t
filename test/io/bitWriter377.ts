/** MSB-first bit writer matching Packet.gBit. Test-only; production uses Packet. */
export class BitWriter377 {
    private bytes: number[] = [];
    private bitPosition = 0;

    write(width: number, value: number): void {
        for (let bit = width - 1; bit >= 0; bit--) {
            const byte = (this.bitPosition / 8) | 0;
            if (byte === this.bytes.length) {
                this.bytes.push(0);
            }
            const shift = 7 - (this.bitPosition % 8);
            this.bytes[byte] |= ((value >>> bit) & 1) << shift;
            this.bitPosition++;
        }
    }

    align(): void {
        if (this.bitPosition % 8 !== 0) {
            this.bitPosition = ((this.bitPosition + 7) / 8) | 0;
            this.bitPosition *= 8;
            while (this.bytes.length < this.bitPosition / 8) {
                this.bytes.push(0);
            }
        }
    }

    finish(): Uint8Array {
        return Uint8Array.from(this.bytes);
    }
}

export function signed5(value: number): number {
    return value > 15 ? value - 32 : value;
}

export function encodeSigned5(value: number): number {
    return value & 31;
}
