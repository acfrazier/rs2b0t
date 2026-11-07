import { describe, expect, test } from 'bun:test';

import LinkList from '#/client/datastruct/LinkList.js';
import ClientObj from '#/client/dash3d/ClientObj.js';
import LocChange from '#/client/dash3d/LocChange.js';

import { feed, onDemandStub, sceneClient } from './sceneClient.js';
import { hex, packTemplate, regionPayload, regionSlot, rust377Cases } from './sceneSupport.js';

const cases = rust377Cases();

function normal(zoneX: number, zoneZ: number): Uint8Array {
    // REBUILD_NORMAL: g2 zone z, then g2_alt3 zone x (low byte plus 128 first)
    return Uint8Array.from([(zoneZ >> 8) & 0xff, zoneZ & 0xff, ((zoneX & 0xff) + 128) & 0xff, (zoneX >> 8) & 0xff]);
}

describe('REBUILD_NORMAL (Java ptype 222)', () => {
    test('decodes the engine encoder bytes: zone z first, then zone x', () => {
        const vector = cases.get(222)!;
        expect(vector.fields).toMatchObject({ zoneX: 400, zoneZ: 401 });
        expect(hex(vector.payloadHex)).toEqual(normal(400, 401));

        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, hex(vector.payloadHex));
        client.rebuildNormal();

        expect(client.in.pos).toBe(4);
        expect(client.mapBuildCentreZoneX).toBe(400);
        expect(client.mapBuildCentreZoneZ).toBe(401);
        expect(client.mapBuildBaseX).toBe((400 - 6) * 8);
        expect(client.mapBuildBaseZ).toBe((401 - 6) * 8);
        expect(client.sceneInstanced).toBe(false);
        expect(client.sceneState).toBe(1);
        expect(client.awaitingPlayerInfo).toBe(true);
    });

    test('requests the land and loc file of each map square around the centre, in x-then-z order', () => {
        const client = sceneClient();
        const od = onDemandStub();
        client.onDemand = od;
        feed(client, normal(400, 401));
        client.rebuildNormal();

        expect(Array.from(client.mapBuildIndex!)).toEqual([(49 << 8) + 49, (49 << 8) + 50, (50 << 8) + 49, (50 << 8) + 50]);
        expect(od.maps).toEqual([
            [49, 49, 0],
            [49, 49, 1],
            [49, 50, 0],
            [49, 50, 1],
            [50, 49, 0],
            [50, 49, 1],
            [50, 50, 0],
            [50, 50, 1]
        ]);
        expect(od.requests).toEqual(od.maps.map(([x, z, type]) => [3, x * 1000 + z * 10 + type]));
        expect(client.mapBuildGroundFile).toEqual([49 * 1000 + 49 * 10, 49 * 1000 + 50 * 10, 50 * 1000 + 49 * 10, 50 * 1000 + 50 * 10]);
        expect(client.mapBuildLocationFile).toEqual(client.mapBuildGroundFile.map(file => file + 1));
        expect(client.mapBuildGroundData).toEqual([null, null, null, null]);
    });

    test('does nothing but clear the instance flag when the centre is unchanged and the scene is built', () => {
        const client = sceneClient();
        const od = onDemandStub();
        client.onDemand = od;
        feed(client, normal(400, 401));
        client.rebuildNormal();
        client.sceneState = 2;
        client.sceneInstanced = true;
        od.maps.length = 0;

        feed(client, normal(400, 401));
        client.rebuildNormal();

        expect(client.sceneState).toBe(2);
        expect(client.sceneInstanced).toBe(false);
        expect(od.maps).toEqual([]);
        expect(client.in.pos).toBe(4);
    });

    test('rebuilds when the centre changes, or the scene is still loading', () => {
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, normal(400, 401));
        client.rebuildNormal();
        client.sceneState = 2;

        feed(client, normal(401, 401));
        client.rebuildNormal();
        expect(client.sceneState).toBe(1);
        expect(client.mapBuildBaseX).toBe((401 - 6) * 8);

        feed(client, normal(401, 401));
        client.rebuildNormal();
        expect(client.sceneState).toBe(1);
    });

    test('truncates the map square coordinates for the tutorial island, so zone 386 counts as map 48', () => {
        const client = sceneClient();
        const od = onDemandStub();
        client.onDemand = od;
        feed(client, normal(386, 386));
        client.rebuildNormal();

        expect(client.withinTutorialIsland).toBe(true);
        expect(Array.from(client.mapBuildIndex!)).toEqual([47, 48, 49].flatMap(x => [47, 48, 49].map(z => (x << 8) + z)));
        const excluded = [(47 << 8) + 49, (48 << 8) + 49, (49 << 8) + 49, (49 << 8) + 47];
        client.mapBuildIndex!.forEach((square, i) => {
            const skipped = excluded.includes(square);
            expect(client.mapBuildGroundFile[i] === -1).toBe(skipped);
            expect(client.mapBuildLocationFile[i] === -1).toBe(skipped);
        });
        expect(od.maps.length).toBe(2 * 5);
    });

    test('the second tutorial island rule: map 48, 148', () => {
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, normal(386, 1186));
        client.rebuildNormal();
        expect(client.withinTutorialIsland).toBe(true);

        feed(client, normal(400, 1186));
        client.rebuildNormal();
        expect(client.withinTutorialIsland).toBe(false);
    });

    test('moves every position by the base shift: entities, ground objects, pending locs and the flag', () => {
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, normal(400, 401));
        client.rebuildNormal();

        const npc = { routeX: new Array<number>(10).fill(50), routeZ: new Array<number>(10).fill(60), x: 5000, z: 6000 };
        const player = { routeX: new Array<number>(10).fill(70), routeZ: new Array<number>(10).fill(80), x: 7000, z: 8000 };
        (client.npc as unknown[])[4] = npc;
        (client.players as unknown[])[9] = player;
        client.minimapFlagX = 30;
        client.minimapFlagZ = 40;

        const here = new LinkList<ClientObj>();
        here.push(new ClientObj(1, 1));
        const far = new LinkList<ClientObj>();
        far.push(new ClientObj(2, 1));
        client.groundObj[0][20][22] = here;
        client.groundObj[2][3][4] = far;

        const keep = new LocChange();
        keep.x = 20;
        keep.z = 22;
        const drop = new LocChange();
        drop.x = 3;
        drop.z = 4;
        client.locChanges.push(keep);
        client.locChanges.push(drop);
        client.cinemaCam = true;

        // the centre moves 1 zone east and 2 zones north: the base moves (+8, +16)
        feed(client, normal(401, 403));
        client.rebuildNormal();

        expect(npc.routeX.every(v => v === 42)).toBe(true);
        expect(npc.routeZ.every(v => v === 44)).toBe(true);
        expect([npc.x, npc.z]).toEqual([5000 - 8 * 128, 6000 - 16 * 128]);
        expect(player.routeX.every(v => v === 62)).toBe(true);
        expect([player.x, player.z]).toEqual([7000 - 8 * 128, 8000 - 16 * 128]);
        expect([client.minimapFlagX, client.minimapFlagZ]).toEqual([22, 24]);
        expect(client.groundObj[0][12][6]).toBe(here);
        expect(client.groundObj[0][20][22]).toBeNull();
        expect(client.groundObj[2][3][4]).toBeNull();
        expect(client.cinemaCam).toBe(false);
        expect([keep.x, keep.z]).toEqual([12, 6]);
        expect(drop.prev).toBeNull();
        expect(client.locChanges.head()).toBe(keep);
        expect(client.locChanges.next()).toBeNull();
    });

    test('a shift to the south west copies in the other direction without clobbering', () => {
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, normal(402, 404));
        client.rebuildNormal();
        const list = new LinkList<ClientObj>();
        list.push(new ClientObj(1, 1));
        client.groundObj[1][50][60] = list;

        feed(client, normal(401, 402));
        client.rebuildNormal();

        expect(client.groundObj[1][58][76]).toBe(list);
        expect(client.groundObj[1][50][60]).not.toBe(list);
    });
});

describe('REBUILD_REGION (Java ptype 53)', () => {
    function template(level: number, zoneX: number, zoneZ: number, rotation: number, srcLevel: number, srcZoneX: number, srcZoneZ: number): [number, number] {
        return [regionSlot(level, zoneX, zoneZ), packTemplate(srcLevel, srcZoneX, srcZoneZ, rotation)];
    }

    test('decodes the engine encoder bytes into the 4x13x13 template grid', () => {
        const vector = cases.get(53)!;
        const present = new Map<number, number>([
            template(0, 394 - 394, 395 - 395, 3, 2, 401, 802),
            template(1, 400 - 394, 401 - 395, 1, 1, 403, 806),
            template(3, 406 - 394, 407 - 395, 2, 3, 401, 802)
        ]);
        expect(regionPayload(400, 401, present)).toEqual(hex(vector.payloadHex));

        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, hex(vector.payloadHex));
        client.rebuildRegion();

        expect(client.in.pos).toBe(vector.payloadHex.length / 2);
        expect(client.sceneInstanced).toBe(true);
        expect(client.sceneState).toBe(1);
        expect([client.mapBuildCentreZoneX, client.mapBuildCentreZoneZ]).toEqual([400, 401]);
        expect([client.mapBuildBaseX, client.mapBuildBaseZ]).toEqual([(400 - 6) * 8, (401 - 6) * 8]);
        for (let level = 0; level < 4; level++) {
            for (let x = 0; x < 13; x++) {
                for (let z = 0; z < 13; z++) {
                    expect(client.sceneMapRegion[level][x][z]).toBe(present.get(regionSlot(level, x, z)) ?? -1);
                }
            }
        }
        // each template reads back as level, source zone x and z, and rotation
        const first = client.sceneMapRegion[0][0][0];
        expect([(first >> 24) & 3, (first >> 14) & 0x3ff, (first >> 3) & 0x7ff, (first >> 1) & 3]).toEqual([2, 401, 802, 3]);
    });

    test('reads all 26 bits of every template and none of the neighbours', () => {
        const max = (1 << 26) - 1;
        const dense = new Map<number, number>();
        for (let slot = 0; slot < 4 * 169; slot++) {
            dense.set(slot, slot % 2 === 0 ? max : slot * 1000);
        }
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, regionPayload(1234, 2345, dense));
        client.rebuildRegion();

        for (let slot = 0; slot < 4 * 169; slot++) {
            expect(client.sceneMapRegion[Math.floor(slot / 169)][Math.floor((slot % 169) / 13)][slot % 13]).toBe(dense.get(slot)!);
        }
        expect([client.mapBuildCentreZoneX, client.mapBuildCentreZoneZ]).toEqual([1234, 2345]);

        const empty = sceneClient();
        empty.onDemand = onDemandStub();
        feed(empty, regionPayload(1234, 2345, new Map()));
        empty.rebuildRegion();
        expect(empty.sceneMapRegion.every(plane => plane.every(row => row.every(v => v === -1)))).toBe(true);
        expect(empty.mapBuildIndex).toEqual(new Int32Array(0));
    });

    test('requests each distinct source square once, in plane, zone-x, zone-z order', () => {
        const client = sceneClient();
        const od = onDemandStub();
        client.onDemand = od;
        const present = new Map<number, number>([
            template(0, 0, 1, 0, 0, 8 * 5, 8 * 7),
            template(0, 0, 0, 1, 0, 8 * 3, 8 * 9),
            template(1, 2, 2, 2, 0, 8 * 5 + 3, 8 * 7 + 2),
            template(1, 0, 0, 3, 1, 8 * 3 + 1, 8 * 10),
            template(3, 12, 12, 0, 2, 8 * 5, 8 * 9)
        ]);
        feed(client, regionPayload(835, 12, present));
        client.rebuildRegion();

        // slot order: level 0 (0,0) -> map (3,9); (0,1) -> map (5,7); level 1 (0,0) -> (3,10); (2,2) -> (5,7) again; level 3 -> (5,9)
        expect(Array.from(client.mapBuildIndex!)).toEqual([(3 << 8) + 9, (5 << 8) + 7, (3 << 8) + 10, (5 << 8) + 9]);
        expect(od.requests.length).toBe(8);
        expect(od.requests[0]).toEqual([3, 3 * 1000 + 9 * 10]);
        expect(od.requests[1]).toEqual([3, 3 * 1000 + 9 * 10 + 1]);
        expect(client.mapBuildGroundData).toEqual([null, null, null, null]);
    });

    test('a repeat of the same centre with the scene built keeps the scene but refreshes the templates', () => {
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, regionPayload(835, 12, new Map([template(0, 0, 0, 0, 0, 8, 8)])));
        client.rebuildRegion();
        client.sceneState = 2;

        feed(client, regionPayload(835, 12, new Map([template(0, 1, 1, 2, 0, 16, 16)])));
        client.rebuildRegion();

        expect(client.sceneState).toBe(2);
        expect(client.sceneMapRegion[0][0][0]).toBe(-1);
        expect(client.sceneMapRegion[0][1][1]).toBe(packTemplate(0, 16, 16, 2));
    });

    test('a normal rebuild after an instance ends the instanced scene', () => {
        const client = sceneClient();
        client.onDemand = onDemandStub();
        feed(client, regionPayload(835, 12, new Map()));
        client.rebuildRegion();
        expect(client.sceneInstanced).toBe(true);
        feed(client, normal(400, 401));
        client.rebuildNormal();
        expect(client.sceneInstanced).toBe(false);
        expect(client.mapBuildIndex!.length).toBe(4);
    });
});
