import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CLIENT_VERSION } from '#/client/io/ClientProt.js';
import CollisionEngine from '#/bot/event/webwalk/rsmod/CollisionEngine.js';
import { changeLocCollision } from '#/bot/event/webwalk/rsmod/collision.js';
import { CollisionFlag, LocShape } from '#/bot/event/webwalk/rsmod/flags.js';
import { LocDef, Reader, forEachLoc, loadLocTypes, loadMapsquares } from '../../tools/nav/lib.js';

const engineDir = process.env.ENGINE_DIR;
const selectedRevision = process.env.REVISION === undefined ? CLIENT_VERSION : Number(process.env.REVISION);

function packOnlyEngine(engine: string): string {
    const source = resolve(engine);
    const root = mkdtempSync(join(tmpdir(), 'rs2b0t-pack-only-'));
    try {
        mkdirSync(join(root, 'data/pack/server'), { recursive: true });
        mkdirSync(join(root, 'data/pack/client'), { recursive: true });
        symlinkSync(join(source, 'data/pack/server/loc.dat'), join(root, 'data/pack/server/loc.dat'));
        symlinkSync(join(source, 'data/pack/client/config'), join(root, 'data/pack/client/config'));
        return root;
    } catch (error) {
        rmSync(root, { recursive: true, force: true });
        throw error;
    }
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function decode(bytes: number[], revision: number): { config: LocDef; reader: Reader } {
    const reader = new Reader(Uint8Array.from(bytes));
    const config = new LocDef();
    config.decodeType(reader, revision);
    return { config, reader };
}

describe('LocDef', () => {
    test('keeps opcode 61 category without disturbing following fields', () => {
        const { config, reader } = decode([61, 0x12, 0x34, 14, 2, 0], 377);

        expect(config.category).toBe(0x1234);
        expect(config.width).toBe(2);
        expect(reader.available).toBe(0);
    });

    test('reads the 289 opcode 77 layout', () => {
        const { config, reader } = decode([77, 0, 5, 1, 0, 42, 0, 43, 14, 2, 0], 289);

        expect(config.width).toBe(2);
        expect(reader.available).toBe(0);
    });

    test('reads the 377 opcode 77 varbit and varp layout', () => {
        const { config, reader } = decode([77, 0, 5, 0, 7, 1, 0, 42, 0, 43, 14, 2, 0], 377);

        expect(config.width).toBe(2);
        expect(reader.available).toBe(0);
    });

    test('uses server overwrite semantics for repeated model lists', () => {
        const revision377 = decode([1, 1, 0, 10, 10, 1, 1, 0, 20, 0, 0], 377).config;
        revision377.postDecode();
        expect(Array.from(revision377.models ?? [])).toEqual([20]);
        expect(Array.from(revision377.shapes ?? [])).toEqual([0]);
        expect(revision377.active).toBe(0);

        const revision289 = decode([1, 1, 0, 10, 10, 1, 1, 0, 20, 0, 0], 289).config;
        revision289.postDecode();
        expect(Array.from(revision289.models ?? [])).toEqual([20]);
        expect(revision289.active).toBe(0);
    });

    test('overwrites zero-count opcode 5 model lists in both revisions', () => {
        for (const revision of [289, 377]) {
            const { config } = decode([1, 1, 0, 10, 10, 5, 0, 0], revision);
            expect(Array.from(config.models ?? [])).toEqual([]);
            expect(config.shapes).toBeNull();
            config.postDecode();
            expect(config.active).toBe(1);
        }
    });

    test('uses server active overwrites and keeps breakroutefinding out of collision', () => {
        const revision377 = decode([19, 2, 74, 0], 377).config;
        revision377.postDecode();
        expect(revision377.active).toBe(2);
        expect(revision377.blockwalk).toBe(true);
        expect(revision377.blockrange).toBe(true);

        const repeatedActive = decode([19, 1, 19, 2, 0], 377).config;
        repeatedActive.postDecode();
        expect(repeatedActive.active).toBe(2);

        const revision289 = decode([19, 2, 74, 0], 289).config;
        revision289.postDecode();
        expect(revision289.active).toBe(2);
        expect(revision289.blockwalk).toBe(true);
        expect(revision289.blockrange).toBe(true);
    });

    test('fails when opcode 77 is decoded with the other revision layout', () => {
        const revision377 = [77, 0, 9, 0x45, 0x67, 1, 0, 42, 0, 43, 0];
        const revision289 = [77, 0, 9, 1, 0, 42, 0, 43, 0];

        expect(() => decode(revision377, 289)).toThrow();
        expect(() => decode(revision289, 377)).toThrow();
    });

    test('still rejects unknown opcodes and unsupported revisions', () => {
        expect(() => decode([76, 0], 377)).toThrow('Unrecognized loc config code: 76');
        expect(() => decode([0], 468)).toThrow('Unsupported loc config revision: 468');
        expect(() => loadLocTypes('unused', 468)).toThrow('Unsupported loc config revision: 468');
    });
});

test.skipIf(!engineDir || (selectedRevision !== 289 && selectedRevision !== 377))('checks pack-only revision markers in both directions', () => {
    const packOnly = packOnlyEngine(engineDir!);
    try {
        const decoded = loadLocTypes(packOnly, selectedRevision);
        expect(decoded.configs.length).toBeGreaterThan(0);

        const wrongRevision = selectedRevision === 289 ? 377 : 289;
        expect(() => loadLocTypes(packOnly, wrongRevision)).toThrow(/Loc config revision mismatch/);
    } finally {
        rmSync(packOnly, { recursive: true, force: true });
    }
});

test.skipIf(!engineDir || selectedRevision !== 377)('uses server collision for every affected loc in the canon 377 pack', () => {
    const { configs, names } = loadLocTypes(engineDir!, 377);
    const collisionCases = [
        { id: 3550, name: 'inviswall_serverside', blockwalk: true, blockrange: false, active: 0 },
        { id: 6950, name: 'lost_tribe_collapsing_roof_location', blockwalk: true, blockrange: true, active: 1 },
        { id: 6951, name: 'lost_tribe_trap_ceiling', blockwalk: true, blockrange: true, active: 1 },
        { id: 6952, name: 'lost_tribe_trap_floor', blockwalk: true, blockrange: true, active: 1 },
        { id: 6953, name: 'lost_tribe_trap_pass', blockwalk: true, blockrange: true, active: 1 }
    ] as const;

    for (const expected of collisionCases) {
        expect(names.get(expected.name)).toBe(expected.id);
        expect(configs[expected.id]).toMatchObject({
            blockwalk: expected.blockwalk,
            blockrange: expected.blockrange,
            width: 1,
            length: 1,
            active: expected.active
        });
    }
    const unplacedActive = names.get('poh_chapelwindow_hotspot_lumbridge');
    expect(unplacedActive).toBe(13728);
    expect(configs[unplacedActive!].active).toBe(0);

    const inviswall = configs[3550]!;
    const collision = new CollisionEngine();
    const wallMask = CollisionFlag.WALL_NORTH_WEST | CollisionFlag.WALL_NORTH | CollisionFlag.WALL_NORTH_EAST
        | CollisionFlag.WALL_EAST | CollisionFlag.WALL_SOUTH_EAST | CollisionFlag.WALL_SOUTH
        | CollisionFlag.WALL_SOUTH_WEST | CollisionFlag.WALL_WEST;
    const projectileMask = CollisionFlag.WALL_NORTH_WEST_PROJ_BLOCKER | CollisionFlag.WALL_NORTH_PROJ_BLOCKER
        | CollisionFlag.WALL_NORTH_EAST_PROJ_BLOCKER | CollisionFlag.WALL_EAST_PROJ_BLOCKER
        | CollisionFlag.WALL_SOUTH_EAST_PROJ_BLOCKER | CollisionFlag.WALL_SOUTH_PROJ_BLOCKER
        | CollisionFlag.WALL_SOUTH_WEST_PROJ_BLOCKER | CollisionFlag.WALL_WEST_PROJ_BLOCKER;
    let inviswallPlacements = 0;
    for (const square of loadMapsquares(engineDir!)) {
        forEachLoc(new Reader(square.loc), loc => {
            if (loc.locId !== 3550) {
                return;
            }
            inviswallPlacements++;
            expect([LocShape.WALL_STRAIGHT, LocShape.WALL_L] as number[]).toContain(loc.shape);
            const x = (square.mx << 6) + loc.x;
            const z = (square.mz << 6) + loc.z;
            changeLocCollision(collision, loc.shape, loc.angle, inviswall.blockrange, inviswall.length, inviswall.width, inviswall.active, x, z, loc.level, true);
            const flags = collision.get(x, z, loc.level);
            expect(flags & wallMask).not.toBe(0);
            expect(flags & projectileMask).toBe(0);
        });
    }
    expect(inviswallPlacements).toBe(287);
});

test.skipIf(!engineDir || selectedRevision !== 289)('keeps the 289 collision bake byte-identical', () => {
    const projectRoot = resolve(import.meta.dir, '../..');
    const outputDir = mkdtempSync(join(tmpdir(), 'rs2b0t-289-collision-'));
    try {
        const output = join(outputDir, 'collision.lcnav');
        const run = Bun.spawnSync([
            process.execPath,
            join(projectRoot, 'tools/nav/build-collision.ts'),
            '--engine',
            engineDir!,
            '--out',
            output,
            '--no-verify'
        ], { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
        if (run.exitCode !== 0) {
            throw new Error(`${run.stdout.toString()}${run.stderr.toString()}`);
        }
        const raw = readFileSync(output);
        const gzip = readFileSync(`${output}.gz`);
        expect(raw.length).toBe(14_218_828);
        expect(sha256(raw)).toBe('292d9d7c8d5cc61aeb2c3d9d279cf8759dd49e776b4d4d3f20fa6ef15c4fb5bf');
        expect(gzip.length).toBe(859_802);
        expect(sha256(gzip)).toBe('04ef48054324935f7eca00efa76f9744b77d00a5824d43b7544f067ab4d7715a');
    } finally {
        rmSync(outputDir, { recursive: true, force: true });
    }
});
