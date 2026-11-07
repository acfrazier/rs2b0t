import { expect, test, describe } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { nextCoordTool, SPADE_SPAWNS, SPADE_NAME, TRIO, PROFESSOR, MURPHY, KOJO } from '#/bot/api/ai/clues/data/toolAcquire.js';

const contentDir = process.env.CONTENT_DIR;
const mapsDir = contentDir === undefined ? undefined : join(contentDir, 'maps');
const has377Maps =
    contentDir !== undefined &&
    mapsDir !== undefined &&
    existsSync(mapsDir) &&
    existsSync(join(contentDir, 'scripts/_unpack/377/all.obj'));

if (!has377Maps) {
    console.log('SKIP: toolAcquire map verification needs CONTENT_DIR with 377 maps and packed definitions');
}

function mapSpadeTiles(): string[] {
    if (contentDir === undefined || mapsDir === undefined) {
        return [];
    }
    const spawns: string[] = [];
    for (const file of readdirSync(mapsDir).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
        const square = /^m(\d+)_(\d+)\.jm2$/.exec(file);
        if (!square) {
            continue;
        }
        const mapX = Number(square[1]) * 64;
        const mapZ = Number(square[2]) * 64;
        let inObjects = false;
        for (const line of readFileSync(join(mapsDir, file), 'utf8').split(/\r?\n/)) {
            if (line.startsWith('====')) {
                inObjects = line.trim() === '==== OBJ ====';
                continue;
            }
            if (!inObjects) {
                continue;
            }
            const placed = /^(\d+) (\d+) (\d+): 952(?: \d+)?$/.exec(line.trim());
            if (placed) {
                spawns.push(`${mapX + Number(placed[2])},${mapZ + Number(placed[3])},${Number(placed[1])}`);
            }
        }
    }
    return spawns.sort();
}

describe('nextCoordTool (item-keyed chain order)', () => {
    test('nothing held -> sextant first', () => {
        expect(nextCoordTool({ sextant: false, watch: false, chart: false })).toBe('sextant');
    });
    test('sextant held, no watch -> watch', () => {
        expect(nextCoordTool({ sextant: true, watch: false, chart: false })).toBe('watch');
    });
    test('sextant+watch held, no chart -> chart', () => {
        expect(nextCoordTool({ sextant: true, watch: true, chart: false })).toBe('chart');
    });
    test('all three held -> null (done)', () => {
        expect(nextCoordTool({ sextant: true, watch: true, chart: true })).toBe(null);
    });
    test('strict order: a held watch without a sextant still asks for the sextant first', () => {
        expect(nextCoordTool({ sextant: false, watch: true, chart: false })).toBe('sextant');
    });
});

describe.skipIf(!has377Maps)('377 map-derived spade spawns', () => {
    test('matches every object 952 placement in the 377 maps', () => {
        const mapTiles = mapSpadeTiles();
        const configuredTiles = SPADE_SPAWNS.map(tile => `${tile.x},${tile.z},${tile.level}`).sort();
        expect(mapTiles).toHaveLength(5);
        expect(configuredTiles).toEqual(mapTiles);
    });
});

describe('data sanity', () => {
    // 377: the maps place five spade ground items (toolAcquire.ts header carries the maps/*.jm2 lines);
    // the list spans both continents so a dig anywhere has a spawn to walk to.
    test('five spade spawns across the map, pairwise well apart', () => {
        expect(SPADE_SPAWNS.length).toBe(5);
        const seen = new Set(SPADE_SPAWNS.map(t => `${t.x},${t.z},${t.level}`));
        expect(seen.size).toBe(SPADE_SPAWNS.length);
        for (const tile of SPADE_SPAWNS) {
            expect(SPADE_SPAWNS.filter(other => other.distanceTo(tile) <= 100).length).toBe(1);
        }
    });
    test('trio + spade names', () => {
        expect(TRIO).toEqual(['Sextant', 'Watch', 'Chart']);
        expect(SPADE_NAME).toBe('Spade');
    });
    test('three NPC stops with distinct anchors and a Treasure-Trails preference', () => {
        const anchors = [PROFESSOR, MURPHY, KOJO].map(s => `${s.anchor.x},${s.anchor.z}`);
        expect(new Set(anchors).size).toBe(3);
        expect(PROFESSOR.prefer.join(' ').toLowerCase()).toContain('treasure');
    });
});
