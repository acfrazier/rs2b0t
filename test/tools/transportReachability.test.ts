import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, test } from 'bun:test';

import transports from '#/bot/event/webwalk/data/transports.json';
import stairEdges from '#/bot/event/webwalk/data/stairEdges.json';
import { BLOCK_MAP_SQUARE, LEVELS, MAP_X, MAP_Z, REMOVE_ROOFS, Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, packCoord, parseLands } from '../../tools/nav/lib.js';
import { skipUnless } from '../lib/skipUnless.js';

interface Point {
    x: number;
    z: number;
    level: number;
}

interface Edge {
    from: Point;
    to: Point;
    action: string;
    kind?: string;
    locId?: number;
    openLocId?: number;
    locX?: number;
    locZ?: number;
    debugName?: string;
    disabledReason?: string;
}

interface LocConfig {
    width: number;
    length: number;
    blockwalk: boolean;
    blockrange: boolean;
    active: number;
    forceapproach: number;
}

interface CollisionEngine {
    allocateIfAbsent(x: number, z: number, level: number): void;
    add(x: number, z: number, level: number, mask: number): void;
    changeWall(x: number, z: number, level: number, angle: number, shape: number, blockrange: boolean, add: boolean): void;
    changeLoc(x: number, z: number, level: number, width: number, length: number, blockrange: boolean, add: boolean): void;
    get(x: number, z: number, level: number): number;
}

interface ReachStrategy {
    reached(
        flags: CollisionEngine,
        level: number,
        srcX: number,
        srcZ: number,
        destX: number,
        destZ: number,
        destWidth: number,
        destHeight: number,
        srcSize: number,
        angle: number,
        shape: number,
        blockAccessFlags: number
    ): boolean;
}

interface EngineFlags {
    CollisionFlag: { FLOOR: number; ROOF: number; WALK_BLOCKED: number };
    LocLayer: { WALL: number; GROUND: number; GROUND_DECOR: number };
    locShapeLayer(shape: number): number;
}

interface ReachEvidence {
    collision: CollisionEngine;
    configs: LocConfig[];
    placements: Map<string, { shape: number; angle: number }>;
    strategy: ReachStrategy;
    flags: EngineFlags['CollisionFlag'];
    locLayer: EngineFlags['LocLayer'];
    locShapeLayer: EngineFlags['locShapeLayer'];
}

const transportRows = transports as Edge[];
const stairRows = stairEdges as Edge[];
const activeEdges = [...transportRows, ...stairRows];

let evidencePromise: Promise<ReachEvidence> | null = null;

function placementKey(locId: number, x: number, z: number, level: number): string {
    return `${locId},${x},${z},${level}`;
}

function loadEngineReachEvidence(): Promise<ReachEvidence> {
    if (!evidencePromise) {
        evidencePromise = (async () => {
            const engineDir = process.env.ENGINE_DIR;
            if (!engineDir) throw new Error('ENGINE_DIR is required for the independent 377 engine census');

            const engineRoot = path.join(engineDir, 'src/engine/routefinder');
            const [{ default: CollisionEngineClass }, { default: strategy }, engineFlags] = await Promise.all([
                import(pathToFileURL(path.join(engineRoot, 'CollisionEngine.ts')).href) as Promise<{ default: new () => CollisionEngine }>,
                import(pathToFileURL(path.join(engineRoot, 'ReachStrategy.ts')).href) as Promise<{ default: ReachStrategy }>,
                import(pathToFileURL(path.join(engineRoot, 'flags.ts')).href) as Promise<EngineFlags>
            ]);
            const collision = new CollisionEngineClass();
            const { configs } = loadLocTypes(engineDir, 377);
            const placements = new Map<string, { shape: number; angle: number }>();

            // Match GameMap.loadGround/loadLocations from the pinned engine, but fill
            // an isolated engine CollisionEngine so this census does not use our nav pack.
            for (const square of loadMapsquares(engineDir)) {
                const lands = parseLands(new Reader(square.land));
                const mapX = square.mx * MAP_X;
                const mapZ = square.mz * MAP_Z;
                for (let level = 0; level < LEVELS; level++) {
                    for (let x = 0; x < MAP_X; x++) {
                        for (let z = 0; z < MAP_Z; z++) {
                            const absoluteX = mapX + x;
                            const absoluteZ = mapZ + z;
                            if (x % 7 === 0 && z % 7 === 0) collision.allocateIfAbsent(absoluteX, absoluteZ, level);
                            const coord = packCoord(x, z, level);
                            const land = lands[coord]!;
                            if ((land & REMOVE_ROOFS) !== 0) collision.add(absoluteX, absoluteZ, level, engineFlags.CollisionFlag.ROOF);
                            if ((land & BLOCK_MAP_SQUARE) !== BLOCK_MAP_SQUARE) continue;
                            const actualLevel = bridgedLevel(lands, coord, x, z, level);
                            if (actualLevel >= 0) collision.add(absoluteX, absoluteZ, actualLevel, engineFlags.CollisionFlag.FLOOR);
                        }
                    }
                }
                forEachLoc(new Reader(square.loc), instance => {
                    const absoluteX = mapX + instance.x;
                    const absoluteZ = mapZ + instance.z;
                    const actualLevel = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
                    if (actualLevel < 0) return;
                    const config = configs[instance.locId] as LocConfig | undefined;
                    if (!config) throw new Error(`Missing revision 377 loc config ${instance.locId} in maps-server.zip`);
                    placements.set(
                        placementKey(instance.locId, absoluteX, absoluteZ, actualLevel),
                        { shape: instance.shape, angle: instance.angle }
                    );
                    if (!config.blockwalk) return;
                    const layer = engineFlags.locShapeLayer(instance.shape);
                    if (layer === engineFlags.LocLayer.WALL) {
                        collision.changeWall(absoluteX, absoluteZ, actualLevel, instance.angle, instance.shape, config.blockrange, true);
                    } else if (layer === engineFlags.LocLayer.GROUND) {
                        const width = instance.angle === 1 || instance.angle === 3 ? config.length : config.width;
                        const length = instance.angle === 1 || instance.angle === 3 ? config.width : config.length;
                        collision.changeLoc(absoluteX, absoluteZ, actualLevel, width, length, config.blockrange, true);
                    } else if (layer === engineFlags.LocLayer.GROUND_DECOR && config.active === 1) {
                        collision.add(absoluteX, absoluteZ, actualLevel, engineFlags.CollisionFlag.FLOOR);
                    }
                });
            }

            return {
                collision,
                configs,
                placements,
                strategy,
                flags: engineFlags.CollisionFlag,
                locLayer: engineFlags.LocLayer,
                locShapeLayer: engineFlags.locShapeLayer
            };
        })();
    }
    return evidencePromise;
}

function isWalkable(evidence: ReachEvidence, point: Point): boolean {
    return (evidence.collision.get(point.x, point.z, point.level) & evidence.flags.WALK_BLOCKED) === 0;
}

function rejects(edge: Edge, evidence: ReachEvidence): string | null {
    const locId = edge.locId;
    const locX = edge.locX;
    const locZ = edge.locZ;
    const placementText = `${locX ?? '??'},${locZ ?? '??'},L${edge.from.level}`;
    const standText = `${edge.from.x},${edge.from.z},L${edge.from.level}`;
    const identity = `${edge.debugName ?? edge.action} loc=${locId ?? '??'} placement=${placementText} stand=${standText}`;
    if (locId === undefined || locX === undefined || locZ === undefined) return `${identity}: missing loc placement identity`;
    const primaryKey = placementKey(locId, locX, locZ, edge.from.level);
    const openKey = edge.openLocId === undefined ? undefined : placementKey(edge.openLocId, locX, locZ, edge.from.level);
    const mappedLocId = evidence.placements.has(primaryKey)
        ? locId
        : edge.openLocId !== undefined && openKey && evidence.placements.has(openKey) ? edge.openLocId : undefined;
    if (mappedLocId === undefined) {
        const openText = edge.openLocId === undefined ? '' : ` or open loc ${edge.openLocId}`;
        return `${identity}: no revision 377 map placement for loc ${locId}${openText}`;
    }
    const config = evidence.configs[mappedLocId];
    if (!config) return `${identity}: missing revision 377 loc config ${mappedLocId}`;
    const placement = evidence.placements.get(placementKey(mappedLocId, locX, locZ, edge.from.level));
    if (!placement) return `${identity}: no revision 377 map placement for loc ${mappedLocId}`;
    if (!isWalkable(evidence, edge.from)) return `${identity}: approach is blocked by GameMap collision`;
    if (!evidence.strategy.reached(
        evidence.collision,
        edge.from.level,
        edge.from.x,
        edge.from.z,
        locX,
        locZ,
        config.width,
        config.length,
        1,
        placement.angle,
        placement.shape,
        config.forceapproach
    )) return `${identity}: engine ReachStrategy.reached rejected this approach`;
    return null;
}

describe.skipIf(skipUnless('engine'))('independent 377 engine transport reach census', () => {
    test('every active transport and stair edge is reachable in GameMap collision', async () => {
        const evidence = await loadEngineReachEvidence();
        const isCandidate = (edge: Edge): boolean =>
            !edge.disabledReason && (edge.kind === 'stair' || edge.kind === 'dungeon');
        const transportCandidates = transportRows.filter(isCandidate);
        const stairCandidates = stairRows.filter(isCandidate);
        const rejectedTransports = transportCandidates.flatMap(edge => {
            const reason = rejects(edge, evidence);
            return reason ? [reason] : [];
        });
        const rejectedStairs = stairCandidates.flatMap(edge => {
            const reason = rejects(edge, evidence);
            return reason ? [reason] : [];
        });
        for (const row of rejectedTransports) console.error(`REJECTED 377 transport: ${row}`);
        for (const row of rejectedStairs) console.error(`REJECTED 377 stair edge: ${row}`);
        console.log(
            `377 engine transport reach census: ${transportCandidates.length - rejectedTransports.length}/${transportCandidates.length} reachable, ${rejectedTransports.length} rejected`
        );
        console.log(
            `377 engine stair-edge reach census: ${stairCandidates.length - rejectedStairs.length}/${stairCandidates.length} reachable, ${rejectedStairs.length} rejected`
        );
        expect(rejectedTransports).toEqual([]);
        expect(rejectedStairs).toEqual([]);
    });
    test('content portal keeps its engine-reachable loc-tile stand', async () => {
        const edge = activeEdges.find(edge =>
            edge.locId === 2000
            && edge.locX === 2575
            && edge.locZ === 9861
            && edge.debugName === 'baxtorian_door_waterfall_quest'
        );
        expect(edge).toBeDefined();
        expect(edge?.disabledReason).toBeUndefined();
        expect(edge?.from).toEqual({ x: 2575, z: 9861, level: 0 });
        const evidence = await loadEngineReachEvidence();
        expect(edge && rejects(edge, evidence)).toBeNull();
    });
});
