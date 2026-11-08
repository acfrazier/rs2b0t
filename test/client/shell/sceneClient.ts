import { mock } from 'bun:test';

import LinkList from '#/client/datastruct/LinkList.js';
import type ClientObj from '#/client/dash3d/ClientObj.js';
import type ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import type ClientNpc from '#/client/dash3d/ClientNpc.js';
import type ClientProj from '#/client/dash3d/ClientProj.js';
import CollisionMap, { BuildArea } from '#/client/dash3d/CollisionMap.js';
import type LocChange from '#/client/dash3d/LocChange.js';
import type MapSpotAnim from '#/client/dash3d/MapSpotAnim.js';
import World from '#/client/dash3d/World.js';
import Packet from '#/client/io/Packet.js';
import { Int32Array3d, TypedArray1d, TypedArray3d, Uint8Array3d } from '#/client/util/Arrays.js';

// Why: mock.module has to run before the client modules load, and static imports are hoisted above it.
mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));

export const { Client } = await import('#/client/shell/Client.js');

export interface OnDemandStub {
    maps: [number, number, number][];
    requests: [number, number][];
    getMapFile(x: number, z: number, type: number): number;
    request(archive: number, file: number): void;
    clearPrefetches(): void;
    prefetch(archive: number, file: number): void;
}

/** The production Client with the private scene state this slice owns, reachable by name. */
export interface SceneClient {
    in: Packet;
    psize: number;
    out: { sent: number[]; p1Enc(op: number): void };
    sceneState: number;
    sceneInstanced: boolean;
    sceneMapRegion: Int32Array[][];
    sceneLoadStartTime: number;
    withinTutorialIsland: boolean;
    awaitingPlayerInfo: boolean;
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    mapBuildPrevBaseX: number;
    mapBuildPrevBaseZ: number;
    mapBuildCentreZoneX: number;
    mapBuildCentreZoneZ: number;
    mapBuildIndex: Int32Array | null;
    mapBuildGroundFile: number[];
    mapBuildLocationFile: number[];
    mapBuildGroundData: (Uint8Array | null)[] | null;
    mapBuildLocationData: (Uint8Array | null)[] | null;
    npc: (ClientNpc | null)[];
    players: (ClientPlayer | null)[];
    localPlayer: ClientPlayer | null;
    selfSlot: number;
    minusedlevel: number;
    minimapLevel: number;
    minimapFlagX: number;
    minimapFlagZ: number;
    cinemaCam: boolean;
    groundObj: (LinkList<ClientObj> | null)[][][];
    locChanges: LinkList<LocChange>;
    projectiles: LinkList<ClientProj>;
    spotanims: LinkList<MapSpotAnim>;
    zoneUpdateX: number;
    zoneUpdateZ: number;
    world: World | null;
    groundh: Int32Array[][];
    mapl: Uint8Array[][];
    collision: CollisionMap[];
    onDemand: OnDemandStub | null;
    waveEnabled: boolean;
    waveCount: number;
    waveIds: Int32Array;
    waveLoops: Int32Array;
    waveDelay: Int32Array;
    shown: [number, number][];
    showObject(x: number, z: number): void;
    clearCaches(): void;
    rebuildNormal(): void;
    rebuildRegion(): void;
    zoneUpdatePartialFollows(): void;
    zoneUpdateFullFollows(): void;
    zoneUpdatePartialEnclosed(): void;
    zonePacket(buf: Packet, opcode: number): void;
    zoneSoundArea(buf: Packet): void;
    locChangeDoQueue(): void;
    locChangePostBuildCorrect(): void;
    checkScene(): number;
    mapBuild(): void;
}

export function onDemandStub(): OnDemandStub {
    return {
        maps: [],
        requests: [],
        getMapFile(x, z, type) {
            this.maps.push([x, z, type]);
            return x * 1000 + z * 10 + type;
        },
        request(archive, file) {
            this.requests.push([archive, file]);
        },
        clearPrefetches() {},
        prefetch() {}
    };
}

/** The bare Client the other tests use: the prototype plus the fields the scene handlers read. */
export function sceneClient(): SceneClient {
    const client = Object.create(Client.prototype) as SceneClient;
    Object.assign(client, {
        in: new Packet(new Uint8Array(0)),
        psize: 0,
        out: {
            sent: [] as number[],
            p1Enc(op: number): void {
                this.sent.push(op);
            }
        },
        sceneState: 0,
        sceneInstanced: false,
        sceneMapRegion: new Int32Array3d(BuildArea.LEVELS, 13, 13),
        sceneLoadStartTime: 0,
        withinTutorialIsland: false,
        awaitingPlayerInfo: false,
        mapBuildBaseX: 0,
        mapBuildBaseZ: 0,
        mapBuildPrevBaseX: 0,
        mapBuildPrevBaseZ: 0,
        mapBuildCentreZoneX: 0,
        mapBuildCentreZoneZ: 0,
        mapBuildIndex: null,
        mapBuildGroundFile: [],
        mapBuildLocationFile: [],
        mapBuildGroundData: null,
        mapBuildLocationData: null,
        npc: new TypedArray1d(16384, null),
        players: new TypedArray1d(2048, null),
        localPlayer: null,
        selfSlot: -1,
        minusedlevel: 0,
        minimapLevel: 0,
        minimapFlagX: 0,
        minimapFlagZ: 0,
        cinemaCam: false,
        groundObj: new TypedArray3d(BuildArea.LEVELS, BuildArea.SIZE, BuildArea.SIZE, null),
        locChanges: new LinkList<LocChange>(),
        projectiles: new LinkList<ClientProj>(),
        spotanims: new LinkList<MapSpotAnim>(),
        zoneUpdateX: 0,
        zoneUpdateZ: 0,
        world: null,
        groundh: new Int32Array3d(BuildArea.LEVELS, BuildArea.SIZE + 1, BuildArea.SIZE + 1),
        mapl: new Uint8Array3d(BuildArea.LEVELS, BuildArea.SIZE, BuildArea.SIZE),
        collision: [0, 1, 2, 3].map(() => new CollisionMap()),
        onDemand: null,
        waveEnabled: true,
        waveCount: 0,
        waveIds: new Int32Array(50),
        waveLoops: new Int32Array(50),
        waveDelay: new Int32Array(50),
        shown: [] as [number, number][],
        clearCaches(): void {}
    });
    // ObjType decoding needs the 377 config; the ordering of the stack is not what these tests cover.
    client.showObject = (x: number, z: number): void => {
        client.shown.push([x, z]);
    };
    return client;
}

export function newWorld(client: SceneClient): World {
    client.world = new World(client.groundh, BuildArea.SIZE, BuildArea.LEVELS, BuildArea.SIZE);
    return client.world;
}

export function feed(client: SceneClient, bytes: Uint8Array): void {
    client.in = new Packet(bytes);
    client.psize = bytes.length;
}
