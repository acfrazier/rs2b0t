import Tile from '../../geometry/Tile.js';
import { resolveDestination } from '../../api/map/WalkDestinations.js';

export const MAP_PICK = 'Map pick';
export const UNSET_TILE = new Tile(0, 0, 0);

export function isSetCustomTile(tile: { x: number; z: number }): boolean {
    return tile.x !== 0 || tile.z !== 0;
}

export function hasArrived(
    here: { x: number; z: number; level: number },
    dest: { x: number; z: number; level: number },
    radius: number
): boolean {
    if (here.level !== dest.level) {
        return false;
    }
    return Math.max(Math.abs(here.x - dest.x), Math.abs(here.z - dest.z)) <= radius;
}

export interface WalkTarget {
    readonly tile: Tile;
    readonly label: string;
    readonly named: boolean;
}

/**
 * Named dropdown dest wins over a leftover map pick.
 * Why: Pick on Map writes customTile and used to keep winning after the user chose a city (#732).
 */
export function resolveWalkTarget(
    destination: string,
    custom: { x: number; z: number; level: number }
): WalkTarget | null {
    const named = resolveDestination(destination);
    if (named) {
        return { tile: named.tile, label: named.name, named: true };
    }
    if (destination === MAP_PICK || isSetCustomTile(custom)) {
        if (!isSetCustomTile(custom)) {
            return null;
        }
        return {
            tile: new Tile(custom.x, custom.z, custom.level),
            label: `${MAP_PICK} ${custom.x},${custom.z}`,
            named: false
        };
    }
    return null;
}
