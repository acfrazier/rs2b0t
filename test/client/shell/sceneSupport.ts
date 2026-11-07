import { readFileSync } from 'node:fs';

import * as ServerProtModule from '#/client/io/ServerProt.js';

export interface LandOverlay {
    id: number;
    shape: number;
    rotation: number;
}

export interface LandTile {
    /** Height byte (2..255); the tile's height is minus 8 times it, plus the level below's. Omitted: the perlin default. */
    height?: number;
    /** Map flags 1..32 (1 = Block, 2 = LinkBelow, 8 = VisBelow, 16 = ForceHighDetail). */
    flags?: number;
    underlay?: number;
    overlay?: LandOverlay;
}

/** Encodes a land file as Java's `World.method22` reads it: 4 levels of 64x64 tiles in level, x, z order. */
export function encodeLand(tile: (level: number, x: number, z: number) => LandTile): Uint8Array {
    const out: number[] = [];
    for (let level = 0; level < 4; level++) {
        for (let x = 0; x < 64; x++) {
            for (let z = 0; z < 64; z++) {
                const t = tile(level, x, z);
                if (t.overlay) {
                    out.push(2 + t.overlay.shape * 4 + t.overlay.rotation, t.overlay.id);
                }
                if (t.flags) {
                    out.push(49 + t.flags);
                }
                if (t.underlay) {
                    out.push(81 + t.underlay);
                }
                if (t.height === undefined) {
                    out.push(0);
                } else {
                    out.push(1, t.height);
                }
            }
        }
    }
    return Uint8Array.from(out);
}

function gsmartBytes(value: number): number[] {
    return value < 128 ? [value] : [(value + 0x8000) >> 8, (value + 0x8000) & 0xff];
}

export interface LocPlacement {
    id: number;
    plane: number;
    x: number;
    z: number;
    shape: number;
    angle: number;
}

/** Encodes a loc file: ids ascending, positions ascending within an id, each list closed by a zero. */
export function encodeLocs(placements: LocPlacement[]): Uint8Array {
    const position = (p: LocPlacement): number => (p.plane << 12) | (p.x << 6) | p.z;
    const sorted = [...placements].sort((a, b) => a.id - b.id || position(a) - position(b));
    const out: number[] = [];
    let previousId = -1;
    let index = 0;
    while (index < sorted.length) {
        const id = sorted[index].id;
        out.push(...gsmartBytes(id - previousId));
        previousId = id;
        let previousPosition = 0;
        while (index < sorted.length && sorted[index].id === id) {
            const p = sorted[index++];
            out.push(...gsmartBytes(position(p) - previousPosition + 1));
            previousPosition = position(p);
            out.push((p.shape << 2) | p.angle);
        }
        out.push(0);
    }
    out.push(0);
    return Uint8Array.from(out);
}

/** Packs a REBUILD_REGION template the way the engine's `RebuildRegionEncoder` does. */
export function packTemplate(level: number, zoneX: number, zoneZ: number, rotation: number): number {
    return ((level & 0x3) << 24) | ((zoneX & 0x3ff) << 14) | ((zoneZ & 0x7ff) << 3) | ((rotation & 0x3) << 1);
}

/** REBUILD_REGION body: g2_alt2 zone x, 4x13x13 presence bits with 26-bit templates, g2_alt2 zone z. */
export function regionPayload(zoneX: number, zoneZ: number, templates: Map<number, number>): Uint8Array {
    const bits: number[] = [];
    const push = (value: number, width: number): void => {
        for (let bit = width - 1; bit >= 0; bit--) {
            bits.push((value >> bit) & 1);
        }
    };
    for (let slot = 0; slot < 4 * 13 * 13; slot++) {
        const template = templates.get(slot);
        if (template === undefined) {
            push(0, 1);
        } else {
            push(1, 1);
            push(template, 26);
        }
    }

    const packed = new Array<number>(Math.ceil(bits.length / 8)).fill(0);
    bits.forEach((bit, index) => {
        packed[index >> 3] |= bit << (7 - (index & 7));
    });

    return Uint8Array.from([(zoneX >> 8) & 0xff, ((zoneX & 0xff) + 128) & 0xff, ...packed, (zoneZ >> 8) & 0xff, ((zoneZ & 0xff) + 128) & 0xff]);
}

export function regionSlot(level: number, zoneX: number, zoneZ: number): number {
    return level * 169 + zoneX * 13 + zoneZ;
}

export interface Rust377Case {
    name: string;
    opcode: number;
    declaredLength: number | null;
    payloadHex: string;
    reads: string[];
    javaValues: unknown[];
    fields: Record<string, unknown> | null;
    origin: string;
    operationFields: unknown[];
    children?: number[];
}

/** Scene and zone cases lifted from the Rust 377 packet fixture (engine encoder bytes, Java read order). */
export function rust377Cases(): Map<number, Rust377Case> {
    const file = JSON.parse(readFileSync(new URL('./fixtures/scene377.vectors.json', import.meta.url), 'utf8')) as { cases: Rust377Case[] };
    return new Map(file.cases.map(c => [c.opcode, c]));
}

/** The opcode the built ServerProt table gives a name; undefined where this build lacks it (SOUND_AREA before the cutover). */
export function builtOpcode(name: string): number | undefined {
    // Why: ServerProt is a const enum, which TypeScript refuses as a value though Bun emits it as an object.
    const runtime = ServerProtModule as unknown as { ServerProt: Record<string, number | undefined> };
    return runtime.ServerProt[name];
}

export function hex(text: string): Uint8Array {
    return Uint8Array.from(text.match(/../g)?.map(byte => parseInt(byte, 16)) ?? []);
}
