import NpcType from '../../src/client/config/NpcType.js';
import SeqType from '../../src/client/config/SeqType.js';
import ClientNpc from '../../src/client/dash3d/ClientNpc.js';
import ClientPlayer from '../../src/client/dash3d/ClientPlayer.js';
import Packet from '../../src/client/io/Packet.js';
import { Client } from '../../src/client/shell/Client.js';

const seqStub = {
    priority: 0,
    duplicatebehaviour: 0,
    postanim_move: 0,
    preanim_move: 0,
    numFrames: 1,
    getDelay: () => 1
};

// SeqType.list is a static array; tests replace it with a delay stub.
const seqTypeList = SeqType as unknown as { list: SeqType[] };
seqTypeList.list = new Proxy([] as SeqType[], {
    get: (target, key) => (typeof key === 'string' && /^-?\d+$/.test(key) ? seqStub : Reflect.get(target, key))
});

function npcStub(id = 0): NpcType {
    const type = Object.create(NpcType.prototype) as NpcType;
    type.id = id;
    type.size = 1;
    type.turnspeed = 32;
    type.walkanim = -1;
    type.walkanim_b = -1;
    type.walkanim_l = -1;
    type.walkanim_r = -1;
    type.readyanim = -1;
    return type;
}

const npcTypeList = NpcType as unknown as { list: (id: number) => NpcType };
npcTypeList.list = (id: number) => npcStub(id);

export interface InfoClient {
    getPlayerPos(buf: Packet, size: number): void;
    getNpcPos(buf: Packet, size: number): void;
    players: (ClientPlayer | null)[];
    playerIds: Int32Array;
    playerCount: number;
    npc: (ClientNpc | null)[];
    npcIds: Int32Array;
    npcCount: number;
    localPlayer: ClientPlayer;
    minusedlevel: number;
    ptype: number;
}

export function freshClient(): InfoClient {
    const c = Object.create(Client.prototype) as Record<string, unknown>;
    c.players = new Array(2048).fill(null);
    c.playerIds = new Int32Array(2048);
    c.playerCount = 0;
    c.entityUpdateIds = new Int32Array(2048);
    c.entityUpdateCount = 0;
    c.entityRemovalIds = new Int32Array(1000);
    c.entityRemovalCount = 0;
    c.playerAppearanceBuffer = new Array(2048).fill(null);
    c.npc = new Array(16384).fill(null);
    c.npcIds = new Int32Array(16384);
    c.npcCount = 0;
    c.minusedlevel = 0;
    c.loginUser = 'sca';
    c.ignoreCount = 0;
    c.ignoreUserhash = [];
    c.chatDisabled = 0;
    c.ptype = 90;
    const local = new ClientPlayer();
    c.localPlayer = local;
    (c.players as (ClientPlayer | null)[])[2047] = local;
    c.addChat = () => {};
    Client.loopCycle = 1000;
    return c as unknown as InfoClient;
}

export function seedPlayers(client: InfoClient, count: number, route = 10): void {
    client.playerCount = count;
    for (let i = 0; i < count; i++) {
        const index = i + 1;
        const player = new ClientPlayer();
        player.routeX[0] = route;
        player.routeZ[0] = route;
        player.cycle = Client.loopCycle - 1;
        client.playerIds[i] = index;
        client.players[index] = player;
    }
}

export function seedNpcs(client: InfoClient, count: number, route = 10): void {
    client.npcCount = count;
    for (let i = 0; i < count; i++) {
        const index = i + 1;
        const npc = new ClientNpc();
        npc.type = NpcType.list(1);
        npc.routeX[0] = route;
        npc.routeZ[0] = route;
        npc.cycle = Client.loopCycle - 1;
        client.npcIds[i] = index;
        client.npc[index] = npc;
    }
}

export function runPlayerInfo(client: InfoClient, bytes: Uint8Array): void {
    client.getPlayerPos(new Packet(bytes), bytes.length);
}

export function runNpcInfo(client: InfoClient, bytes: Uint8Array): void {
    client.getNpcPos(new Packet(bytes), bytes.length);
}
