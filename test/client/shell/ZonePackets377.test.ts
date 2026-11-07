import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import LocType from '#/client/config/LocType.js';
import SeqType from '#/client/config/SeqType.js';
import ClientLocAnim from '#/client/dash3d/ClientLocAnim.js';
import ClientObj from '#/client/dash3d/ClientObj.js';
import type Model from '#/client/dash3d/Model.js';
import type ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import LocChange from '#/client/dash3d/LocChange.js';
import { LocLayer } from '#/client/dash3d/LocLayer.js';
import ModelSource from '#/client/dash3d/ModelSource.js';
import LinkList from '#/client/datastruct/LinkList.js';
import Packet from '#/client/io/Packet.js';
import { ServerProt } from '#/client/io/ServerProt.js';
import ClientBuild from '#/client/shell/ClientBuild.js';
import JagFX from '#/client/sound/JagFX.js';

import { Client, feed, newWorld, sceneClient, type SceneClient } from './sceneClient.js';
import { builtOpcode, hex, rust377Cases } from './sceneSupport.js';

type Loc = InstanceType<typeof LocType>;

const cases = rust377Cases();
// the tile of every child vector: coord 53 is x nibble 3, z nibble 5
const ORIGIN_X = 48;
const ORIGIN_Z = 56;
const X = ORIGIN_X + 3;
const Z = ORIGIN_Z + 5;
const LOC_ID = 456;

const origLocList = LocType.list;
const origSeqList = SeqType.list;
const origCycle = Client.loopCycle;
const origDelays = JagFX.delays;
const origLowMem = Client.lowMem;

function zoneClient(): SceneClient {
    const client = sceneClient();
    client.zoneUpdateX = ORIGIN_X;
    client.zoneUpdateZ = ORIGIN_Z;
    client.groundh[0][X][Z] = 10;
    client.groundh[0][X + 1][Z] = 20;
    client.groundh[0][X + 1][Z + 1] = 30;
    client.groundh[0][X][Z + 1] = 40;
    return client;
}

function stack(client: SceneClient, ...objs: [number, number][]): LinkList<ClientObj> {
    const list = new LinkList<ClientObj>();
    for (const [id, count] of objs) {
        list.push(new ClientObj(id, count));
    }
    client.groundObj[0][X][Z] = list;
    return list;
}

function contents(list: LinkList<ClientObj> | null): [number, number][] {
    const result: [number, number][] = [];
    for (let obj = list?.head() ?? null; obj !== null; obj = list?.next() ?? null) {
        result.push([obj.id, obj.count]);
    }
    return result;
}

function locChanges(client: SceneClient): LocChange[] {
    const result: LocChange[] = [];
    for (let change = client.locChanges.head(); change !== null; change = client.locChanges.next()) {
        result.push(change);
    }
    return result;
}

/** Runs the engine bytes of a child through the production dispatcher; the name is resolved in the built ServerProt table. */
function child(client: SceneClient, name: string, bytes: Uint8Array, direct: (c: SceneClient, buf: Packet) => void): Packet {
    const buf = new Packet(bytes);
    const opcode = builtOpcode(name);
    if (opcode === undefined) {
        direct(client, buf);
    } else {
        client.zonePacket(buf, opcode);
    }
    return buf;
}

beforeEach(() => {
    Client.loopCycle = 5000;
    Client.lowMem = false;
});

afterEach(() => {
    LocType.list = origLocList;
    SeqType.list = origSeqList;
    Client.loopCycle = origCycle;
    Client.lowMem = origLowMem;
    JagFX.delays = origDelays;
});

describe('zone frames (Java ptypes 75, 40 and 183)', () => {
    test('UPDATE_ZONE_PARTIAL_FOLLOWS reads zone x then zone z', () => {
        const vector = cases.get(75)!;
        const client = sceneClient();
        feed(client, hex(vector.payloadHex));
        client.zoneUpdatePartialFollows();
        expect([client.zoneUpdateX, client.zoneUpdateZ]).toEqual([48, 56]);
        expect(client.in.pos).toBe(2);
    });

    test('UPDATE_ZONE_FULL_FOLLOWS reads zone z then zone x, and clears the zone', () => {
        const vector = cases.get(40)!;
        const client = sceneClient();
        client.minusedlevel = 1;
        const inside = new LinkList<ClientObj>();
        inside.push(new ClientObj(1, 1));
        client.groundObj[1][50][60] = inside;
        client.groundObj[1][56][60] = inside;
        client.groundObj[1][47][60] = inside;
        client.groundObj[0][50][60] = inside;

        const pending = new LocChange();
        pending.level = 1;
        pending.x = 55;
        pending.z = 63;
        const otherLevel = new LocChange();
        otherLevel.level = 0;
        otherLevel.x = 50;
        otherLevel.z = 60;
        const outside = new LocChange();
        outside.level = 1;
        outside.x = 56;
        outside.z = 60;
        for (const change of [pending, otherLevel, outside]) {
            client.locChanges.push(change);
        }

        feed(client, hex(vector.payloadHex));
        client.zoneUpdateFullFollows();

        expect(client.in.pos).toBe(2);
        expect([client.zoneUpdateX, client.zoneUpdateZ]).toEqual([48, 56]);
        expect(client.groundObj[1][50][60]).toBeNull();
        expect(client.groundObj[1][56][60]).toBe(inside);
        expect(client.groundObj[1][47][60]).toBe(inside);
        expect(client.groundObj[0][50][60]).toBe(inside);
        expect(client.shown).toEqual([[50, 60]]);
        expect(pending.endTime).toBe(0);
        expect(otherLevel.endTime).toBe(-1);
        expect(outside.endTime).toBe(-1);
    });

    // The children the 377 enclosed vector carries, by build-independent name.
    const CHILD_NAMES: Record<number, string> = {
        203: 'P_LOCMERGE',
        106: 'OBJ_REVEAL',
        142: 'LOC_ANIM',
        107: 'OBJ_ADD',
        121: 'OBJ_COUNT',
        181: 'MAP_PROJANIM',
        41: 'SOUND_AREA',
        59: 'MAP_ANIM',
        152: 'LOC_ADD_CHANGE',
        208: 'OBJ_DEL',
        88: 'LOC_DEL'
    };

    /** The vector's frame rebuilt from its children, with each child opcode as the built ServerProt table spells it. */
    function enclosedFrame(translate: boolean): Uint8Array {
        const vector = cases.get(183)!;
        const out: number[] = Array.from(hex(vector.payloadHex).subarray(0, 2));
        for (const code of vector.children!) {
            const built = builtOpcode(CHILD_NAMES[code]);
            if (translate && built === undefined) {
                continue;
            }
            out.push(translate ? built! : code, ...hex(cases.get(code)!.payloadHex));
        }
        return Uint8Array.from(out);
    }

    test('the vector is the origin followed by its eleven children, each opcode and body', () => {
        const vector = cases.get(183)!;
        expect(vector.children).toEqual([203, 106, 142, 107, 121, 181, 41, 59, 152, 208, 88]);
        expect(enclosedFrame(false)).toEqual(hex(vector.payloadHex));
    });

    test('UPDATE_ZONE_PARTIAL_ENCLOSED runs the children in order and consumes the frame exactly', () => {
        const bytes = enclosedFrame(true);
        const client = zoneClient();
        client.minusedlevel = 0;
        feed(client, bytes);

        client.zoneUpdatePartialEnclosed();

        expect(client.in.pos).toBe(bytes.length);
        expect([client.zoneUpdateX, client.zoneUpdateZ]).toEqual([48, 56]);
        // reveal and add put two 17767 stacks; the count change looks for 1234 and finds none; the delete removes the first
        expect(contents(client.groundObj[0][X][Z])).toEqual([[17767, 2345]]);
        expect(client.spotanims.head()).not.toBeNull();
        expect(client.projectiles.head()).not.toBeNull();
        // LOC_ADD_CHANGE then LOC_DEL on the same tile and layer share one change, which ends as a removal
        const changes = locChanges(client);
        expect(changes.length).toBe(1);
        expect([changes[0].newType, changes[0].newShape, changes[0].newAngle]).toEqual([-1, 10, 3]);
    });

    test('an unknown child fails closed under STRICT_PACKETS', () => {
        const client = zoneClient();
        expect(() => client.zonePacket(new Packet(new Uint8Array(4)), 255)).toThrow('unknown zone child');
    });
});

describe('object children', () => {
    test('OBJ_ADD: obj, tile, count', () => {
        const client = zoneClient();
        const buf = child(client, 'OBJ_ADD', hex(cases.get(107)!.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_ADD));
        expect(buf.pos).toBe(5);
        expect(contents(client.groundObj[0][X][Z])).toEqual([[17767, 2345]]);
        expect(client.shown).toEqual([[X, Z]]);
    });

    test('OBJ_ADD on a stack adds to it, and ignores a tile outside the scene', () => {
        const client = zoneClient();
        stack(client, [5, 1]);
        child(client, 'OBJ_ADD', hex(cases.get(107)!.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_ADD));
        expect(contents(client.groundObj[0][X][Z])).toEqual([
            [5, 1],
            [17767, 2345]
        ]);

        const far = zoneClient();
        far.zoneUpdateX = 200;
        child(far, 'OBJ_ADD', hex(cases.get(107)!.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_ADD));
        expect(far.shown).toEqual([]);
    });

    test('OBJ_REVEAL: tile, count, obj, receiver; the receiver sees nothing', () => {
        const vector = cases.get(106)!;
        expect(vector.fields).toMatchObject({ count: 2345, obj: 17767, receiverId: 321 });

        const other = zoneClient();
        other.selfSlot = 7;
        const buf = child(other, 'OBJ_REVEAL', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_REVEAL));
        expect(buf.pos).toBe(7);
        expect(contents(other.groundObj[0][X][Z])).toEqual([[17767, 2345]]);

        const receiver = zoneClient();
        receiver.selfSlot = 321;
        child(receiver, 'OBJ_REVEAL', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_REVEAL));
        expect(receiver.groundObj[0][X][Z]).toBeNull();
        expect(receiver.shown).toEqual([]);
    });

    test('OBJ_COUNT: tile, obj, old count, new count; the object id is compared without bit 15', () => {
        const vector = cases.get(121)!;
        const client = zoneClient();
        const list = stack(client, [17767, 999], [17767, 1234]);
        const buf = child(client, 'OBJ_COUNT', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_COUNT));
        expect(buf.pos).toBe(7);
        expect(contents(list)).toEqual([
            [17767, 999],
            [17767, 2345]
        ]);
        expect(client.shown).toEqual([[X, Z]]);

        const none = zoneClient();
        const untouched = stack(none, [17767, 999]);
        child(none, 'OBJ_COUNT', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_COUNT));
        expect(contents(untouched)).toEqual([[17767, 999]]);
    });

    test('OBJ_DEL: obj, tile; removes the first match and empties the tile', () => {
        const vector = cases.get(208)!;
        const client = zoneClient();
        const list = stack(client, [4, 1], [17767, 3], [17767, 4]);
        const buf = child(client, 'OBJ_DEL', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_DEL));
        expect(buf.pos).toBe(3);
        expect(contents(list)).toEqual([
            [4, 1],
            [17767, 4]
        ]);

        const last = zoneClient();
        stack(last, [17767, 3]);
        child(last, 'OBJ_DEL', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.OBJ_DEL));
        expect(last.groundObj[0][X][Z]).toBeNull();
        expect(last.shown).toEqual([[X, Z]]);
    });
});

describe('loc children', () => {
    test('LOC_ADD_CHANGE: shape and angle, loc, tile', () => {
        const vector = cases.get(152)!;
        expect(vector.fields).toMatchObject({ shape: 10, angle: 3, loc: 456 });
        const client = zoneClient();
        const buf = child(client, 'LOC_ADD_CHANGE', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.LOC_ADD_CHANGE));
        expect(buf.pos).toBe(4);
        const [change] = locChanges(client);
        expect([change.level, change.layer, change.x, change.z]).toEqual([0, LocLayer.GROUND, X, Z]);
        expect([change.newType, change.newShape, change.newAngle, change.startTime, change.endTime]).toEqual([456, 10, 3, 0, -1]);
    });

    test('LOC_DEL: tile, then shape and angle', () => {
        const vector = cases.get(88)!;
        const client = zoneClient();
        const buf = child(client, 'LOC_DEL', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.LOC_DEL));
        expect(buf.pos).toBe(2);
        const [change] = locChanges(client);
        expect([change.layer, change.x, change.z, change.newType, change.newShape, change.newAngle]).toEqual([LocLayer.GROUND, X, Z, -1, 10, 3]);
    });

    test('a second change for the same tile and layer updates the first', () => {
        const client = zoneClient();
        child(client, 'LOC_ADD_CHANGE', hex(cases.get(152)!.payloadHex), (c, b) => c.zonePacket(b, ServerProt.LOC_ADD_CHANGE));
        child(client, 'LOC_DEL', hex(cases.get(88)!.payloadHex), (c, b) => c.zonePacket(b, ServerProt.LOC_DEL));
        expect(locChanges(client).length).toBe(1);
        expect(locChanges(client)[0].newType).toBe(-1);
    });

    describe('LOC_ANIM: sequence, shape and angle, tile', () => {
        const vector = cases.get(142)!;
        const bytes = (shape: number, angle: number): Uint8Array => {
            const out = hex(vector.payloadHex);
            out[2] = ((shape << 2) | angle) + 128;
            return out;
        };
        const typecode = (LOC_ID << 14) | X | (Z << 7) | (2 << 29);

        function animClient(): SceneClient {
            const client = zoneClient();
            SeqType.list = [];
            SeqType.list[321] = Object.assign(Object.create(SeqType.prototype) as InstanceType<typeof SeqType>, { numFrames: 2, loops: -1 });
            return client;
        }

        function expectAnim(model: unknown, shape: number, angle: number): void {
            expect(model).toBeInstanceOf(ClientLocAnim);
            const anim = model as ClientLocAnim;
            expect([anim.index, anim.shape, anim.angle]).toEqual([LOC_ID, shape, angle]);
            expect([anim.heightSW, anim.heightSE, anim.heightNE, anim.heightNW]).toEqual([10, 20, 30, 40]);
            expect(anim.anim).toBe(SeqType.list[321]);
        }

        test('the vector animates a scenery loc with the placement heights', () => {
            expect(vector.fields).toMatchObject({ seq: 321, shape: 10, angle: 3 });
            const client = animClient();
            const world = newWorld(client);
            world.addScenery(0, X, Z, 0, new ModelSource(), typecode, 0, 1, 1, 0);
            const buf = child(client, 'LOC_ANIM', bytes(10, 3), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            expect(buf.pos).toBe(4);
            expectAnim(world.getScene(0, X, Z)!.model, 10, 3);
        });

        test('a diagonal centrepiece (shape 11) animates as shape 10', () => {
            const client = animClient();
            const world = newWorld(client);
            world.addScenery(0, X, Z, 0, new ModelSource(), typecode, 0, 1, 1, 0);
            child(client, 'LOC_ANIM', bytes(11, 1), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            expectAnim(world.getScene(0, X, Z)!.model, 10, 1);
        });

        test('a wall animates, and an L wall animates both of its models', () => {
            const client = animClient();
            const world = newWorld(client);
            world.setWall(0, X, Z, 0, 1, 0, new ModelSource(), null, typecode, 0);
            child(client, 'LOC_ANIM', bytes(0, 2), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            expectAnim(world.getWall(0, X, Z)!.model1, 0, 2);

            const l = animClient();
            const lWorld = newWorld(l);
            lWorld.setWall(0, X, Z, 0, 1, 0, new ModelSource(), new ModelSource(), typecode, 0);
            child(l, 'LOC_ANIM', bytes(2, 3), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            const wall = lWorld.getWall(0, X, Z)!;
            expectAnim(wall.model1, 2, 3 + 4);
            expectAnim(wall.model2, 2, 0);
        });

        test('a wall decoration passes its own south-east height, not the north-east one', () => {
            const client = animClient();
            const world = newWorld(client);
            world.setDecor(0, X, Z, 0, 0, 0, typecode, new ModelSource(), 0, 0, 0);
            child(client, 'LOC_ANIM', bytes(4, 2), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            expectAnim(world.getDecor(0, Z, X)!.model, 4, 0);
        });

        test('a ground decoration animates as shape 22', () => {
            const client = animClient();
            const world = newWorld(client);
            world.setGroundDecor(new ModelSource(), 0, X, Z, 0, typecode, 0);
            child(client, 'LOC_ANIM', bytes(22, 2), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            expectAnim(world.getGd(0, X, Z)!.model, 22, 2);
        });

        test('a tile at the scene edge, or with no world, is skipped', () => {
            const edge = animClient();
            newWorld(edge);
            edge.zoneUpdateX = 96;
            edge.zoneUpdateZ = 96;
            const buf = child(edge, 'LOC_ANIM', hex('0141ab7f'), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM));
            expect(buf.pos).toBe(4);

            const empty = animClient();
            expect(child(empty, 'LOC_ANIM', bytes(10, 3), (c, b) => c.zonePacket(b, ServerProt.LOC_ANIM)).pos).toBe(4);
        });
    });

    describe('LOC_MERGE: a loc models onto a player for a while', () => {
        const vector = cases.get(203)!;

        let mergeModel: Model | null = null;

        function mergeClient(): { client: SceneClient; player: ClientPlayer } {
            const client = zoneClient();
            const player = {} as ClientPlayer;
            client.players[321] = player;
            const model = {} as Model;
            mergeModel = model;
            const loc = Object.create(LocType.prototype) as Loc;
            loc.width = 2;
            loc.length = 3;
            loc.getModel = (() => model) as unknown as Loc['getModel'];
            LocType.list = (() => loc) as typeof LocType.list;
            return { client, player };
        }

        test('reads the 14 engine bytes and applies the extent, offset and timers', () => {
            expect(vector.fields).toMatchObject({ locId: 456, shape: 10, angle: 3, west: 48, east: 53, north: 64, south: 59, srcX: 50, srcZ: 60, startCycle: 123, endCycle: 234, playerSlot: 321 });
            const { client, player } = mergeClient();
            const buf = child(client, 'P_LOCMERGE', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.P_LOCMERGE));

            expect(buf.pos).toBe(14);
            expect(player.locModel).toBe(mergeModel);
            expect([player.locStartCycle, player.locStopCycle]).toEqual([123 + 5000, 234 + 5000]);
            // angle 3 swaps the 2x3 footprint, so the offset centres a 3x2 box on the tile
            expect([player.locOffsetX, player.locOffsetZ]).toEqual([X * 128 + 3 * 64, Z * 128 + 2 * 64]);
            // the signed extents (-2 and 3 across, -1 and 4 down) are put in order, then added to the tile
            expect([player.minTileX, player.maxTileX, player.minTileZ, player.maxTileZ]).toEqual([X - 2, X + 3, Z - 1, Z + 4]);
            const [change] = locChanges(client);
            expect([change.layer, change.x, change.z, change.newType, change.newShape, change.newAngle]).toEqual([LocLayer.GROUND, X, Z, -1, 0, 0]);
            expect([change.startTime, change.endTime]).toEqual([124, 235]);
        });

        test('the receiving player can be the local one', () => {
            const { client } = mergeClient();
            const local = {} as ClientPlayer;
            client.selfSlot = 321;
            client.localPlayer = local;
            child(client, 'P_LOCMERGE', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.P_LOCMERGE));
            expect(local.locStartCycle).toBe(123 + 5000);
        });

        test('an absent player consumes the bytes and changes nothing', () => {
            const { client } = mergeClient();
            client.players[321] = null;
            const buf = child(client, 'P_LOCMERGE', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.P_LOCMERGE));
            expect(buf.pos).toBe(14);
            expect(locChanges(client)).toEqual([]);
        });
    });
});

describe('effect children', () => {
    test('MAP_ANIM: tile, spot, height, delay', () => {
        const vector = cases.get(59)!;
        const client = zoneClient();
        const buf = child(client, 'MAP_ANIM', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.MAP_ANIM));
        expect(buf.pos).toBe(6);
        const spot = client.spotanims.head()!;
        // the ground height at the tile centre is the interpolation of the four corners set in zoneClient: 25
        expect([spot.level, spot.x, spot.z, spot.y, spot.startCycle]).toEqual([0, X * 128 + 64, Z * 128 + 64, 25 - 55, 5000 + 7]);
    });

    test('MAP_PROJANIM: tile, signed offsets, target, spot, heights, delays, arc', () => {
        const vector = cases.get(181)!;
        expect(vector.fields).toMatchObject({ dstX: 48, srcX: 50, dstZ: 63, srcZ: 60, target: -321, spotanim: 456, srcHeight: 7, dstHeight: 8, startDelay: 123, endDelay: 234, peak: 45, arc: 67 });
        const client = zoneClient();
        const buf = child(client, 'MAP_PROJANIM', hex(vector.payloadHex), (c, b) => c.zonePacket(b, ServerProt.MAP_PROJANIM));
        expect(buf.pos).toBe(15);

        const proj = client.projectiles.head()!;
        expect([proj.level, proj.srcX, proj.srcZ]).toEqual([0, X * 128 + 64, Z * 128 + 64]);
        expect([proj.h1, proj.h2]).toEqual([25 - 7 * 4, 8 * 4]);
        expect([proj.t1, proj.t2, proj.angle, proj.startpos, proj.target]).toEqual([5000 + 123, 5000 + 234, 45, 67, -321]);
    });

    test('MAP_PROJANIM with the 65535 sentinel is consumed and ignored', () => {
        const bytes = hex(cases.get(181)!.payloadHex);
        bytes[5] = 0xff;
        bytes[6] = 0xff;
        const client = zoneClient();
        const buf = child(client, 'MAP_PROJANIM', bytes, (c, b) => c.zonePacket(b, ServerProt.MAP_PROJANIM));
        expect(buf.pos).toBe(15);
        expect(client.projectiles.head()).toBeNull();
    });

    test('MAP_PROJANIM starting outside the scene is ignored', () => {
        const client = zoneClient();
        client.zoneUpdateX = 102;
        child(client, 'MAP_PROJANIM', hex(cases.get(181)!.payloadHex), (c, b) => c.zonePacket(b, ServerProt.MAP_PROJANIM));
        expect(client.projectiles.head()).toBeNull();
    });

    describe('SOUND_AREA (new in 377): tile, sound, range and loops', () => {
        const vector = cases.get(41)!;

        function soundClient(routeX: number, routeZ: number): SceneClient {
            const client = zoneClient();
            client.localPlayer = { routeX: [routeX], routeZ: [routeZ] } as unknown as ClientPlayer;
            JagFX.delays = new Int32Array(1000);
            JagFX.delays[456] = 17;
            return client;
        }

        test('queues the wave when the player is within range', () => {
            expect(vector.javaValues).toEqual([53, 456, 115]);
            // 115 = range 7 in the high nibble, loops 3 in the low bits
            const client = soundClient(X + 7, Z - 7);
            const buf = child(client, 'SOUND_AREA', hex(vector.payloadHex), (c, b) => c.zoneSoundArea(b));
            expect(buf.pos).toBe(4);
            expect([client.waveCount, client.waveIds[0], client.waveLoops[0], client.waveDelay[0]]).toEqual([1, 456, 3, 17]);
        });

        test('is silent beyond the range, with sound off, in low memory, or when the queue is full', () => {
            const play = (client: SceneClient): number => {
                child(client, 'SOUND_AREA', hex(vector.payloadHex), (c, b) => c.zoneSoundArea(b));
                return client.waveCount;
            };
            expect(play(soundClient(X + 8, Z))).toBe(0);
            expect(play(soundClient(X, Z + 8))).toBe(0);
            expect(play(soundClient(X - 8, Z))).toBe(0);

            const off = soundClient(X, Z);
            off.waveEnabled = false;
            expect(play(off)).toBe(0);

            const full = soundClient(X, Z);
            full.waveCount = 50;
            expect(play(full)).toBe(50);

            Client.lowMem = true;
            expect(play(soundClient(X, Z))).toBe(0);
        });
    });
});

describe('loc change queue (Java updateLocChanges)', () => {
    interface Applied {
        args: unknown[];
    }
    const applied: Applied[] = [];
    const origAvailable = ClientBuild.changeLocAvailable;
    const origUnchecked = ClientBuild.changeLocUnchecked;

    beforeEach(() => {
        applied.length = 0;
        ClientBuild.changeLocAvailable = () => true;
        ClientBuild.changeLocUnchecked = (...args: unknown[]) => {
            applied.push({ args });
        };
    });

    afterEach(() => {
        ClientBuild.changeLocAvailable = origAvailable;
        ClientBuild.changeLocUnchecked = origUnchecked;
    });

    function pending(client: SceneClient, fields: Partial<LocChange>): LocChange {
        const change = Object.assign(new LocChange(), { level: 0, layer: LocLayer.GROUND, x: 20, z: 30 }, fields);
        client.locChanges.push(change);
        return change;
    }

    test('a permanent change waits out its start delay, applies once, and stays', () => {
        const client = zoneClient();
        newWorld(client);
        client.sceneState = 2;
        const change = pending(client, { newType: 7, newShape: 10, newAngle: 1, oldType: 9, oldShape: 10, oldAngle: 0, startTime: 2, endTime: -1 });

        client.locChangeDoQueue();
        expect(applied.length).toBe(0);
        client.locChangeDoQueue();
        expect(applied.length).toBe(1);
        expect(applied[0].args.slice(0, 6)).toEqual([0, 20, 30, 7, 10, 1]);
        expect(change.startTime).toBe(-1);
        client.locChangeDoQueue();
        expect(applied.length).toBe(1);
        expect(locChanges(client)).toEqual([change]);
    });

    test('a timed change restores the old loc when its end time runs out, then is dropped', () => {
        const client = zoneClient();
        newWorld(client);
        client.sceneState = 2;
        pending(client, { newType: 7, newShape: 10, newAngle: 1, oldType: 9, oldShape: 10, oldAngle: 2, startTime: 1, endTime: 3 });

        client.locChangeDoQueue();
        expect(applied.length).toBe(1);
        client.locChangeDoQueue();
        expect(applied.length).toBe(1);
        client.locChangeDoQueue();
        expect(applied.length).toBe(2);
        expect(applied[1].args.slice(0, 6)).toEqual([0, 20, 30, 9, 10, 2]);
        expect(locChanges(client)).toEqual([]);
    });

    test('a change that matches what is already there is dropped once applied', () => {
        const client = zoneClient();
        newWorld(client);
        client.sceneState = 2;
        pending(client, { newType: 7, newShape: 10, newAngle: 1, oldType: 7, oldShape: 10, oldAngle: 1, startTime: 0, endTime: -1 });
        client.locChangeDoQueue();
        expect(locChanges(client)).toEqual([]);
    });

    test('nothing runs before the scene is built', () => {
        const client = zoneClient();
        newWorld(client);
        client.sceneState = 1;
        pending(client, { newType: 7, newShape: 10, startTime: 0, endTime: -1 });
        client.locChangeDoQueue();
        expect(applied.length).toBe(0);
    });

    test('the post-build pass keeps permanent changes and drops the timed ones', () => {
        const client = zoneClient();
        newWorld(client);
        const keep = pending(client, { newType: 7, startTime: 5, endTime: -1 });
        pending(client, { newType: 8, x: 21, startTime: 5, endTime: 40 });
        client.locChangePostBuildCorrect();
        expect(locChanges(client)).toEqual([keep]);
        expect(keep.startTime).toBe(0);
    });
});
