/** Pitfall 3: the strict flags are class-definition-time constants, and no in-repo command used to set them, so a deliberate under-consumed packet and unknown config opcode passed silently.
 *  Why here: `test/setup-dom.ts` is the bunfig preload, so the flags are set before these classes are defined; without it both checks would pass.
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));

// Static imports would evaluate these modules before mock.module runs, so the audio shims must be
// installed first; this is the loading-boundary exception, as in test/client/shell/Multiloc.test.ts.
const { Client } = await import('#/client/shell/Client.js');
const { default: LocType } = await import('#/client/config/LocType.js');
const { assertPacketConsumed } = await import('#/client/io/packetGuard.js');
const { default: Packet } = await import('#/client/io/Packet.js');

type Loc = InstanceType<typeof LocType>;

describe('strict flags are on under bun test', () => {
    test('the preload sets them before any class definition', () => {
        expect(process.env.STRICT_PACKETS).toBe('1');
        expect(process.env.STRICT_CONFIG).toBe('1');
        expect(Client.STRICT_PACKETS).toBe(true);
        expect(LocType.STRICT).toBe(true);
    });

    test('a packet that did not consume its declared bytes throws', () => {
        expect(() => assertPacketConsumed(77, 12, 10)).toThrow('packet 77 declared 12 bytes, consumed 10');
        expect(() => assertPacketConsumed(-1, 0, 0)).not.toThrow();
    });

    test('an unknown config opcode throws', () => {
        const type = Object.create(LocType.prototype) as Loc;
        type.id = 7;
        expect(() => type.decode(new Packet(new Uint8Array([200, 0])))).toThrow('LocType 7: unknown config opcode 200');
    });
});
