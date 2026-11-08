import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ServerProtKnown, ServerProtSizes } from '#/client/io/ServerProt.js';
import { knownServerOpcodes } from '#/client/io/serverOpcodes.js';
import Packet from '#/client/io/Packet.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));

const { Client } = await import('#/client/shell/Client.js');
type ClientInstance = InstanceType<typeof Client>;

const ZONE_CHILDREN = ['OBJ_COUNT', 'P_LOCMERGE', 'OBJ_REVEAL', 'MAP_ANIM', 'MAP_PROJANIM', 'OBJ_DEL', 'OBJ_ADD', 'LOC_ANIM', 'LOC_DEL', 'LOC_ADD_CHANGE', 'SOUND_AREA'];
const NAMED: Record<string, string> = {
    NPC_INFO: 'getNpcPos',
    PLAYER_INFO: 'getPlayerPos',
    LOGOUT: 'logout',
    REBUILD_NORMAL: 'rebuildNormal',
    REBUILD_REGION: 'rebuildRegion',
    UPDATE_ZONE_PARTIAL_FOLLOWS: 'zoneUpdatePartialFollows',
    UPDATE_ZONE_FULL_FOLLOWS: 'zoneUpdateFullFollows',
    UPDATE_ZONE_PARTIAL_ENCLOSED: 'zoneUpdatePartialEnclosed'
};

const HANDLERS = new Map(
    Object.getOwnPropertyNames(Client.prototype)
        .filter(method => method.startsWith('handle'))
        .map(method => [method.toLowerCase(), method] as const)
);

/** The handler a descriptor must reach: its own `handle<Name>` method, matched without case since the names run words together. */
function handlerFor(name: string): string {
    if (ZONE_CHILDREN.includes(name)) return 'zonePacket';
    if (NAMED[name]) return NAMED[name];
    const found = HANDLERS.get(`handle${name.replaceAll('_', '')}`.toLowerCase());
    if (!found) throw new Error(`no handler method for ${name}`);
    return found;
}

const FIXTURE = JSON.parse(readFileSync('test/io/fixtures/prot377/engine-prot.json', 'utf8')) as { server: { name: string; id: number; length: number }[] };

/** The 75 engine descriptors of revision 377, from the P1 fixture the generated table is held equal to. */
function descriptorNames(): [string, number][] {
    return FIXTURE.server.map(row => [row.name, row.id]);
}

class FeedStream {
    closed = false;
    msSinceData = 0;
    constructor(private bytes: number[]) {}
    get available(): number {
        return this.bytes.length;
    }
    write(): void {}
    async read(): Promise<number> {
        return this.bytes.shift() ?? -1;
    }
    async readBytes(dst: Uint8Array, off: number, len: number): Promise<void> {
        for (let i = 0; i < len; i++) dst[off + i] = this.bytes.shift() ?? 0;
    }
    close(): void {
        this.closed = true;
    }
}

function wire(id: number): number[] {
    const size = ServerProtSizes[id];
    const body = new Array<number>(size < 0 ? 3 : size).fill(0);
    if (size === -1) return [id, body.length, ...body];
    if (size === -2) return [id, 0, body.length, ...body];
    return [id, ...body];
}

test('the strict flag is on, so every dispatch below is fail-closed', () => {
    expect(Client.STRICT_PACKETS).toBe(true);
});

test('the built table knows exactly the 75 fixture descriptors, with the fixture sizes', () => {
    expect(descriptorNames()).toHaveLength(75);
    expect([...ServerProtKnown].sort((a, b) => a - b)).toEqual(descriptorNames().map(([, id]) => id).sort((a, b) => a - b));
    for (const row of FIXTURE.server) expect(ServerProtSizes[row.id], row.name).toBe(row.length);
});

test('the generated membership is required: a table without it, or with a malformed one, throws instead of falling back to sizes', () => {
    expect([...knownServerOpcodes({ ServerProtKnown })].sort((a, b) => a - b)).toEqual([...ServerProtKnown].sort((a, b) => a - b));
    expect(() => knownServerOpcodes({})).toThrow('missing or invalid generated server opcode membership');
    expect(() => knownServerOpcodes({ ServerProtSizes })).toThrow('missing or invalid generated server opcode membership');
    expect(() => knownServerOpcodes({ ServerProtKnown: [1, 2.5] })).toThrow('missing or invalid generated server opcode membership');
    expect(() => knownServerOpcodes({ ServerProtKnown: [300] })).toThrow('missing or invalid generated server opcode membership');
    expect(() => knownServerOpcodes({ ServerProtKnown: 'nope' })).toThrow('missing or invalid generated server opcode membership');
});

for (const [name, id] of descriptorNames()) {
    test(`${name} (${id}) reaches ${handlerFor(name)} through tcpIn and leaves the packet consumed`, async () => {
        const calls: { handler: string; opcode?: number; size: number }[] = [];
        const client = Object.assign(Object.create(Client.prototype), {
            stream: new FeedStream(wire(id)),
            randomIn: null,
            in: new Packet(new Uint8Array(5000)),
            ptype: -1,
            ptype0: -1,
            ptype1: -1,
            ptype2: -1,
            psize: 0,
            timeoutTimer: 0,
            ingame: true
        }) as ClientInstance;

        // Every handler the chain can call becomes a probe that consumes the whole payload, as a correct handler would.
        const probe = (handler: string) => function (this: ClientInstance, ...args: unknown[]): unknown {
            calls.push({ handler, ...(handler === 'zonePacket' ? { opcode: args[1] as number } : {}), size: this['psize'] });
            this['in'].pos = this['psize'];
            if (handler !== 'zonePacket' && !handler.startsWith('zoneUpdate') && handler !== 'logout') this['ptype'] = -1;
            return handler.startsWith('handle') ? true : undefined;
        };
        const all = new Set<string>([...Object.values(NAMED), 'zonePacket', ...descriptorNames().map(([n]) => handlerFor(n))]);
        for (const handler of all) (client as unknown as Record<string, unknown>)[handler] = probe(handler);

        const handled = await client['tcpIn']();
        expect(calls.map(call => call.handler)).toEqual([handlerFor(name)]);
        if (ZONE_CHILDREN.includes(name)) expect(calls[0].opcode).toBe(id);
        expect(calls[0].size).toBe(ServerProtSizes[id] < 0 ? 3 : ServerProtSizes[id]);
        expect(handled).toBe(name !== 'LOGOUT');
        expect(client['ptype']).toBe(-1);
    });
}

test('an opcode outside the 377 table fails closed under STRICT_PACKETS', async () => {
    const unknown = Array.from({ length: 256 }, (_, id) => id).find(id => !ServerProtKnown.includes(id))!;
    const client = Object.assign(Object.create(Client.prototype), {
        stream: new FeedStream([unknown]),
        randomIn: null,
        in: new Packet(new Uint8Array(64)),
        ptype: -1,
        ptype0: -1,
        ptype1: -1,
        ptype2: -1,
        psize: 0,
        timeoutTimer: 0,
        ingame: true
    }) as ClientInstance;
    const error = spyError();
    try {
        await expect(client['tcpIn']()).rejects.toThrow(`T1 - unknown opcode ${unknown}`);
    } finally {
        error.mockRestore();
    }
});

function spyError(): { mockRestore(): void } {
    const original = console.error;
    console.error = (): void => {};
    return { mockRestore: (): void => { console.error = original; } };
}
