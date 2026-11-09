import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { CollisionFlag } from '#/bot/event/webwalk/rsmod/flags.js';
import { CLIENT_VERSION } from '#/client/io/ClientProt.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';

interface StairEdge {
    from: NavPoint;
    to: NavPoint;
    action: string;
    kind?: string;
    locId?: number;
    openLocId?: number;
    locX?: number;
    locZ?: number;
    debugName?: string;
    disabledReason?: string;
    extraTicks?: number;
    _coordOffset?: NavPoint;
}

interface LocPlacement {
    angle: number;
    shape: number;
}

interface ReachStrategy {
    reached(
        flags: { get(x: number, z: number, level: number): number },
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

function argVal(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function pointKey(locId: number, x: number, z: number, level: number): string {
    return `${locId},${x},${z},${level}`;
}

function rotatedSize(width: number, length: number, angle: number): [number, number] {
    return angle & 1 ? [length, width] : [width, length];
}

function sideApproaches(locX: number, locZ: number, width: number, height: number, level: number): NavPoint[] {
    const candidates: NavPoint[] = [];
    const east = locX + width - 1;
    const north = locZ + height - 1;
    for (let z = locZ; z <= north; z++) {
        candidates.push({ x: locX - 1, z, level }, { x: east + 1, z, level });
    }
    for (let x = locX; x <= east; x++) {
        candidates.push({ x, z: locZ - 1, level }, { x, z: north + 1, level });
    }
    candidates.sort((a, b) => {
        const rank = (point: NavPoint): [number, number, number, number] => {
            const dx = point.x - locX;
            const dz = point.z - locZ;
            return [Math.max(Math.abs(dx), Math.abs(dz)), Math.abs(dx) + Math.abs(dz), -dz, dx];
        };
        const left = rank(a);
        const right = rank(b);
        for (let i = 0; i < left.length; i++) {
            if (left[i] !== right[i]) return left[i] - right[i];
        }
        return 0;
    });
    return candidates;
}

async function main(): Promise<void> {
    const revision = process.env.REVISION === undefined ? CLIENT_VERSION : Number(process.env.REVISION);
    if (revision !== 377) return;

    const engine = argVal('--engine') ?? process.env.ENGINE_DIR;
    const packPath = argVal('--pack') ?? process.env.NAV_PACK_PATH ?? 'out/collision.lcnav.gz';
    const out = argVal('--out') ?? 'src/bot/event/webwalk/data/stairEdges.json';
    if (!engine) throw new Error('Set ENGINE_DIR to the revision-matched Engine-TS checkout');

    const transportOut = argVal('--transports');
    const outputFiles = [out, ...(transportOut ? [transportOut] : [])].map(file => ({
        path: file,
        edges: JSON.parse(fs.readFileSync(file, 'utf8')) as StairEdge[]
    }));
    const edges = outputFiles.flatMap(file => file.edges);
    const reachOnlyDisableReason = `No walkable adjacent tile passes revision ${revision} reach while preserving a walkable landing for this loc placement.`;
    const generatedStairEdges = new Set(outputFiles[0]!.edges);
    const { configs } = loadLocTypes(engine, revision);
    const locIds = new Set(
        edges
            .filter(edge => !edge.disabledReason && (edge.kind === 'stair' || edge.kind === 'dungeon'))
            .flatMap(edge => [edge.locId, edge.openLocId])
            .filter((id): id is number => id !== undefined)
    );
    const placements = new Map<string, LocPlacement>();
    for (const square of loadMapsquares(engine)) {
        const lands = parseLands(new Reader(square.land));
        forEachLoc(new Reader(square.loc), instance => {
            if (!locIds.has(instance.locId)) return;
            const level = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
            placements.set(
                pointKey(instance.locId, square.mx * 64 + instance.x, square.mz * 64 + instance.z, level),
                { angle: instance.angle, shape: instance.shape }
            );
        });
    }

    let packBytes: Uint8Array<ArrayBufferLike> = fs.readFileSync(packPath);
    if (packBytes[0] === 0x1f && packBytes[1] === 0x8b) packBytes = gunzipSync(packBytes);
    const finder = new PathFinder(packBytes);
    const wallMask = finder.wallMask.bind(finder);
    const flags = {
        get(x: number, z: number, level: number): number {
            if (!finder.walkable(x, z, level)) return CollisionFlag.NULL;
            const walls = wallMask(x, z, level);
            return (
                ((walls & 1) ? CollisionFlag.WALL_NORTH : 0)
                | ((walls & 2) ? CollisionFlag.WALL_EAST : 0)
                | ((walls & 4) ? CollisionFlag.WALL_SOUTH : 0)
                | ((walls & 8) ? CollisionFlag.WALL_WEST : 0)
            );
        }
    };

    // The selected engine revision lives outside this project and is resolved through ENGINE_DIR.
    const { default: strategy } = await import(
        pathToFileURL(path.join(engine, 'src/engine/routefinder/ReachStrategy.ts')).href
    ) as { default: ReachStrategy };
    const changed: string[] = [];
    const disabled: string[] = [];
    const unresolved: string[] = [];

    for (const edge of edges) {
        if (edge.disabledReason || (edge.kind !== 'stair' && edge.kind !== 'dungeon')) continue;
        if (edge.locId === undefined || edge.locX === undefined || edge.locZ === undefined) {
            throw new Error(`${edge.debugName ?? edge.action}: active stair edge is missing loc identity`);
        }
        const primaryKey = pointKey(edge.locId, edge.locX, edge.locZ, edge.from.level);
        const openKey = edge.openLocId === undefined ? undefined : pointKey(edge.openLocId, edge.locX, edge.locZ, edge.from.level);
        const mappedLocId = placements.has(primaryKey)
            ? edge.locId
            : edge.openLocId !== undefined && openKey && placements.has(openKey) ? edge.openLocId : undefined;
        if (mappedLocId === undefined) {
            throw new Error(`${edge.debugName ?? edge.action} loc ${edge.locId} at ${edge.locX},${edge.locZ}: missing revision ${revision} loc/open-loc map placement`);
        }
        const config = configs[mappedLocId];
        const placement = placements.get(pointKey(mappedLocId, edge.locX, edge.locZ, edge.from.level));
        if (!config || !placement) {
            throw new Error(`${edge.debugName ?? edge.action} loc ${mappedLocId} at ${edge.locX},${edge.locZ}: missing revision ${revision} config or map placement`);
        }
        const [width, height] = rotatedSize(config.width, config.length, placement.angle);
        // Shantay Pass selects a different content branch on each side of the gate.
        const shantay = edge.debugName === 'shantay_pass_henge_doorway';
        const southToNorth = shantay && edge.to.z > edge.locZ!;
        const contentSide = (point: NavPoint): boolean =>
            !shantay || (southToNorth ? point.z <= edge.locZ! : point.z > edge.locZ!);
        const landingFor = (point: NavPoint): NavPoint => {
            const offset = edge._coordOffset;
            if (offset) {
                return { x: point.x + offset.x, z: point.z + offset.z, level: point.level + offset.level };
            }
            if (!shantay) return edge.to;
            return southToNorth
                ? { x: point.x, z: point.z + 3, level: point.level }
                : { x: edge.locX! + 2, z: edge.locZ! - 1, level: point.level };
        };
        const isReachableSide = (point: NavPoint): boolean => {
            const west = edge.locX! - 1;
            const east = edge.locX! + width;
            const south = edge.locZ! - 1;
            const north = edge.locZ! + height;
            const adjacent =
                (point.x === west && point.z >= edge.locZ! && point.z < edge.locZ! + height)
                || (point.x === east && point.z >= edge.locZ! && point.z < edge.locZ! + height)
                || (point.z === south && point.x >= edge.locX! && point.x < edge.locX! + width)
                || (point.z === north && point.x >= edge.locX! && point.x < edge.locX! + width);
            const landing = landingFor(point);
            const originalApproach =
                point.x === edge.from.x && point.z === edge.from.z && point.level === edge.from.level;
            if (
                (!adjacent && !originalApproach)
                || !contentSide(point)
                || !finder.walkable(point.x, point.z, point.level)
                || !finder.walkable(landing.x, landing.z, landing.level)
            ) return false;
            return strategy.reached(
                flags,
                point.level,
                point.x,
                point.z,
                edge.locX!,
                edge.locZ!,
                config.width,
                config.length,
                1,
                placement.angle,
                placement.shape,
                config.forceapproach
            );
        };

        if (isReachableSide(edge.from)) {
            if (shantay) edge.to = landingFor(edge.from);
            continue;
        }
        const candidates = sideApproaches(edge.locX, edge.locZ, width, height, edge.from.level);
        const candidate = candidates.find(isReachableSide);
        if (!candidate) {
            const details = candidates.map(point => {
                const landing = landingFor(point);
                let status = 'rejected by ReachStrategy';
                if (!finder.walkable(point.x, point.z, point.level)) status = 'blocked approach';
                else if (!finder.walkable(landing.x, landing.z, landing.level)) {
                    status = `blocked landing ${landing.x},${landing.z},${landing.level}`;
                }
                return `${point.x},${point.z}:${status}`;
            }).join(' ');
            const record =
                `${edge.locId},${edge.locX},${edge.locZ} current=${edge.from.x},${edge.from.z},${edge.from.level}; ${details}`;
            if (generatedStairEdges.has(edge)) {
                edge.disabledReason = reachOnlyDisableReason;
                delete edge.extraTicks;
                disabled.push(record);
            } else {
                unresolved.push(record);
            }
            continue;
        }
        changed.push(`${edge.locId},${edge.locX},${edge.locZ} ${edge.from.x},${edge.from.z},${edge.from.level} -> ${candidate.x},${candidate.z},${candidate.level}`);
        edge.from = candidate;
        if (shantay) edge.to = landingFor(candidate);
    }

    for (const edge of edges) {
        const offset = edge._coordOffset;
        if (!offset) continue;
        edge.to = {
            x: edge.from.x + offset.x,
            z: edge.from.z + offset.z,
            level: edge.from.level + offset.level
        };
        delete edge._coordOffset;
    }
    for (const outputFile of outputFiles) {
        const output = '[\n' + outputFile.edges.map(edge => `    ${JSON.stringify(edge)}`).join(',\n') + '\n]\n';
        fs.writeFileSync(outputFile.path, output);
    }
    console.log(`corrected ${changed.length} stair and transport approach tiles against revision ${revision} ReachStrategy; disabled ${disabled.length} generated stair edges with no reachable side; kept ${unresolved.length} transport stands active where no adjacent candidate passed`);
    for (const row of changed) console.log(row);
    for (const row of disabled) console.log(`disabled unreachable stair: ${row}`);
    for (const row of unresolved) console.log(`kept current transport stand active: ${row}`);
}

if (import.meta.main) await main();
