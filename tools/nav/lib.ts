import fs from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';

import { bunzip2 } from '#/client/io/BZip2.js';
import { CLIENT_VERSION } from '#/client/io/ClientProt.js';

type ClientRevision = 289 | 377;

interface DecodeMarkers {
    opcode77Count: number;
}

function resolveRevision(revision?: number): ClientRevision {
    const selected = revision ?? (process.env.REVISION === undefined ? CLIENT_VERSION : Number(process.env.REVISION));
    if (selected !== 289 && selected !== 377) {
        throw new Error(`Unsupported loc config revision: ${selected}`);
    }
    return selected;
}

export class Reader {
    readonly data: Uint8Array;
    readonly view: DataView;
    pos = 0;

    constructor(data: Uint8Array) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    get available(): number {
        return this.view.byteLength - this.pos;
    }

    g1(): number {
        return this.view.getUint8(this.pos++);
    }

    g1b(): number {
        return this.view.getInt8(this.pos++);
    }

    g2(): number {
        const result: number = this.view.getUint16(this.pos);
        this.pos += 2;
        return result;
    }

    g2s(): number {
        const result: number = this.view.getInt16(this.pos);
        this.pos += 2;
        return result;
    }

    g3(): number {
        this.pos += 3;
        return (this.data[this.pos - 3] << 16) + (this.data[this.pos - 2] << 8) + this.data[this.pos - 1];
    }

    g4s(): number {
        const result: number = this.view.getInt32(this.pos);
        this.pos += 4;
        return result;
    }

    gbool(): boolean {
        return this.g1() === 1;
    }

    gjstr(terminator: number = 10): string {
        const length: number = this.view.byteLength;
        let str: string = '';
        let b: number;
        while ((b = this.view.getUint8(this.pos++)) !== terminator && this.pos < length) {
            str += String.fromCharCode(b);
        }
        return str;
    }

    gsmarts(): number {
        return this.view.getUint8(this.pos) < 0x80 ? this.g1() : this.g2() - 0x8000;
    }
}

class JagArchive {
    private readonly data: Uint8Array;
    private readonly compressWhole: boolean;
    private readonly fileHash: number[] = [];
    private readonly filePackedSize: number[] = [];
    private readonly filePos: number[] = [];

    constructor(src: Uint8Array) {
        let reader = new Reader(src);
        const unpackedSize: number = reader.g3();
        const packedSize: number = reader.g3();

        if (unpackedSize === packedSize) {
            this.data = src;
            this.compressWhole = false;
        } else {
            this.data = bunzip2(src.subarray(6));
            reader = new Reader(this.data);
            this.compressWhole = true;
        }

        const fileCount: number = reader.g2();
        let pos: number = reader.pos + fileCount * 10;
        for (let i: number = 0; i < fileCount; i++) {
            this.fileHash[i] = reader.g4s();
            reader.g3();
            this.filePackedSize[i] = reader.g3();
            this.filePos[i] = pos;
            pos += this.filePackedSize[i];
        }
    }

    static genHash(name: string): number {
        let hash: number = 0;
        name = name.toUpperCase();
        for (let i: number = 0; i < name.length; i++) {
            hash = (hash * 61 + name.charCodeAt(i) - 32) | 0;
        }
        return hash;
    }

    read(name: string): Uint8Array | null {
        const hash: number = JagArchive.genHash(name);
        const index: number = this.fileHash.indexOf(hash);
        if (index === -1) {
            return null;
        }
        const src: Uint8Array = this.data.subarray(this.filePos[index], this.filePos[index] + this.filePackedSize[index]);
        return this.compressWhole ? src : bunzip2(src);
    }
}

export class LocDef {
    models: Uint16Array | null = null;
    shapes: Uint8Array | null = null;
    name: string | null = null;
    width = 1;
    length = 1;
    blockwalk = true;
    blockrange = true;
    forceapproach = 0;
    active = -1;
    op: (string | null)[] | null = null;
    debugname: string | null = null;
    category: number | null = null;

    decodeType(dat: Reader, revision?: number, markers?: DecodeMarkers): void {
        const selectedRevision = resolveRevision(revision);
        while (dat.available > 0) {
            const code: number = dat.g1();
            if (code === 0) {
                return;
            }
            this.decode(code, dat, selectedRevision, markers);
        }
        throw new Error('Loc config record is missing its terminator');
    }

    // Collision fields mirror engine/src/cache/config/LocType.ts:112-143.
    // The server consumes them in engine/src/engine/GameMap.ts:338-348,412-424.
    private decode(code: number, dat: Reader, revision: ClientRevision, markers?: DecodeMarkers): void {
        if (code === 1) {
            const count = dat.g1();
            // Model and shape lists use server overwrites; names and actions remain available for nav reports.
            this.models = new Uint16Array(count);
            this.shapes = new Uint8Array(count);
            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
                this.shapes[i] = dat.g1();
            }
        } else if (code === 2) {
            this.name = dat.gjstr();
        } else if (code === 3) {
            dat.gjstr();
        } else if (code === 5) {
            const count = dat.g1();
            this.models = new Uint16Array(count);
            this.shapes = null;
            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
            }
        } else if (code === 14) {
            this.width = dat.g1();
        } else if (code === 15) {
            this.length = dat.g1();
        } else if (code === 17) {
            this.blockwalk = false;
        } else if (code === 18) {
            this.blockrange = false;
        } else if (code === 19) {
            this.active = dat.g1();
        } else if (code === 21 || code === 22 || code === 23 || code === 25 || code === 62 || code === 64 || code === 73) {
            // Payload-less opcodes: recognised so the cursor stays aligned, nothing to read.
        } else if (code === 74) {
            // The server stores breakroutefinding separately (engine/src/cache/config/LocType.ts:205-206); it does not change collision.
        } else if (code === 61) {
            this.category = dat.g2();
        } else if (code === 24 || code === 60 || code === 65 || code === 66 || code === 67 || code === 68) {
            dat.g2();
        } else if (code === 28 || code === 75) {
            dat.g1();
        } else if (code === 69) {
            this.forceapproach = dat.g1();
        } else if (code === 29 || code === 39) {
            dat.g1b();
        } else if (code >= 30 && code < 35) {
            if (!this.op) {
                this.op = new Array(5).fill(null);
            }
            this.op[code - 30] = dat.gjstr();
        } else if (code === 40) {
            const count = dat.g1();
            for (let i = 0; i < count; i++) {
                dat.g2();
                dat.g2();
            }
        } else if (code === 70 || code === 71 || code === 72) {
            dat.g2s();
        } else if (code === 77) {
            if (markers) {
                markers.opcode77Count++;
            }
            dat.g2();
            if (revision === 377) {
                dat.g2();
            }
            const count = dat.g1();
            for (let i = 0; i <= count; i++) {
                dat.g2();
            }
        } else if (code === 249) {
            const count = dat.g1();
            for (let i = 0; i < count; i++) {
                dat.g3();
                if (dat.gbool()) {
                    dat.gjstr();
                } else {
                    dat.g4s();
                }
            }
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized loc config code: ${code} (packed data out of sync?)`);
        }
    }

    // Match engine/src/cache/config/LocType.ts:237-249 for the active default derived after decode.
    postDecode(): void {
        if (this.active === -1) {
            this.active = 0;
            if (this.models && (!this.shapes || (this.shapes && this.shapes[0] === 10))) {
                this.active = 1;
            }
            if (this.op !== null) {
                this.active = 1;
            }
        }
    }
}

function sourceRevision(engineDir: string): number | undefined {
    const environmentPath = path.join(engineDir, 'src/util/Environment.ts');
    if (fs.existsSync(environmentPath)) {
        const source = fs.readFileSync(environmentPath, 'utf8');
        const revision = /\bENGINE_REVISION:\s*tryParseInt\(process\.env\.ENGINE_REVISION,\s*(\d+)\s*\)/.exec(source);
        if (revision) {
            return Number(revision[1]);
        }
    }

    const worldConfigPath = path.join(engineDir, 'src/util/WorldConfig.ts');
    if (fs.existsSync(worldConfigPath)) {
        const source = fs.readFileSync(worldConfigPath, 'utf8');
        const revision = /\bengine:\s*\{\s*revision:\s*(\d+)\s*\}/.exec(source);
        if (revision) {
            return Number(revision[1]);
        }
    }
    return undefined;
}

export function loadLocTypes(engineDir: string, revision?: number): { configs: LocDef[]; names: Map<string, number> } {
    const selectedRevision = resolveRevision(revision);
    const engineRevision = sourceRevision(engineDir);
    if (engineRevision !== undefined && engineRevision !== selectedRevision) {
        throw new Error(`Loc config revision mismatch: requested ${selectedRevision}, engine declares ${engineRevision}`);
    }
    // Pack-only copies lack engine source; revision 377 has opcode 77 records while this 289 pack does not.
    const revisionMarkers = engineRevision === undefined ? { opcode77Count: 0 } : undefined;
    const server = new Reader(new Uint8Array(fs.readFileSync(path.join(engineDir, 'data/pack/server/loc.dat'))));
    const jag = new JagArchive(new Uint8Array(fs.readFileSync(path.join(engineDir, 'data/pack/client/config'))));
    const clientDat = jag.read('loc.dat');
    if (!clientDat) {
        throw new Error('loc.dat missing from client config archive');
    }
    const client = new Reader(clientDat);

    const count = server.g2();
    const clientCount = client.g2();
    if (clientCount !== count) {
        throw new Error(`Loc config count mismatch: server has ${count}, client has ${clientCount}`);
    }

    const configs: LocDef[] = [];
    const names = new Map<string, number>();
    try {
        for (let id = 0; id < count; id++) {
            const config = new LocDef();
            config.decodeType(server, selectedRevision, revisionMarkers);
            config.decodeType(client, selectedRevision, revisionMarkers);
            config.postDecode();
            configs[id] = config;
            if (config.debugname) {
                names.set(config.debugname, id);
            }
        }
    } catch (error) {
        if (revisionMarkers?.opcode77Count && selectedRevision === 289) {
            throw new Error('Loc config revision mismatch: requested 289, pack declares 377 (revision-377 opcode 77 records)');
        }
        throw error;
    }
    if (revisionMarkers) {
        const packRevision: ClientRevision = revisionMarkers.opcode77Count > 0 ? 377 : 289;
        if (packRevision !== selectedRevision) {
            throw new Error(`Loc config revision mismatch: requested ${selectedRevision}, pack declares ${packRevision} (revision-377 opcode 77 records ${revisionMarkers.opcode77Count === 0 ? 'absent' : 'present'})`);
        }
    }
    if (server.available !== 0) {
        throw new Error(`Trailing bytes in server loc config: ${server.available}`);
    }
    if (client.available !== 0) {
        throw new Error(`Trailing bytes in client loc config: ${client.available}`);
    }
    return { configs, names };
}

export const OPEN = 0x0;
export const BLOCK_MAP_SQUARE = 0x1;
const LINK_BELOW = 0x2;
export const REMOVE_ROOFS = 0x4;

export const LEVELS = 4;
export const MAP_X = 64;
export const MAP_Z = 64;
const MAPSQUARE = MAP_X * LEVELS * MAP_Z;

export function zoneIndex(x: number, z: number, level: number): number {
    return ((x >> 3) & 0x7ff) | (((z >> 3) & 0x7ff) << 11) | ((level & 0x3) << 22);
}

export function packCoord(x: number, z: number, level: number): number {
    return (z & 0x3f) | ((x & 0x3f) << 6) | ((level & 0x3) << 12);
}

function unpackCoord(packed: number): { x: number; z: number; level: number } {
    const z: number = packed & 0x3f;
    const x: number = (packed >> 6) & 0x3f;
    const level: number = (packed >> 12) & 0x3;
    return { x, z, level };
}

export interface MapsquareData {
    mx: number;
    mz: number;
    land: Uint8Array;
    loc: Uint8Array;
}

export function loadMapsquares(engineDir: string): MapsquareData[] {
    const squares: MapsquareData[] = [];
    const zipPath = path.join(engineDir, 'data/pack/.cache/maps-server.zip');
    const dirPath = path.join(engineDir, 'data/pack/server/maps');

    if (fs.existsSync(zipPath)) {
        const mapEntries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
        for (const name of Object.keys(mapEntries).filter(entry => entry[0] === 'm')) {
            const [mx, mz] = name.substring(1).split('_').map(Number);
            squares.push({ mx, mz, land: mapEntries[`m${mx}_${mz}`], loc: mapEntries[`l${mx}_${mz}`] });
        }
    } else if (fs.existsSync(dirPath)) {
        for (const name of fs.readdirSync(dirPath).filter(entry => entry[0] === 'm')) {
            const [mx, mz] = name.substring(1).split('_').map(Number);
            squares.push({
                mx,
                mz,
                land: new Uint8Array(fs.readFileSync(path.join(dirPath, `m${mx}_${mz}`))),
                loc: new Uint8Array(fs.readFileSync(path.join(dirPath, `l${mx}_${mz}`)))
            });
        }
    } else {
        throw new Error(`no maps found (looked at ${zipPath} and ${dirPath})`);
    }

    squares.sort((a, b) => a.mx - b.mx || a.mz - b.mz);
    return squares;
}

export function parseLands(packet: Reader, ground?: Uint8Array): Int8Array {
    const lands = new Int8Array(MAPSQUARE);
    for (let level: number = 0; level < LEVELS; level++) {
        for (let x: number = 0; x < MAP_X; x++) {
            for (let z: number = 0; z < MAP_Z; z++) {
                while (true) {
                    const opcode: number = packet.g1();
                    if (opcode === 0) {
                        break;
                    } else if (opcode === 1) {
                        packet.pos++;
                        break;
                    }

                    if (opcode <= 49) {
                        packet.pos++;
                        if (ground) {
                            ground[packCoord(x, z, level)] = 1;
                        }
                    } else if (opcode <= 81) {
                        lands[packCoord(x, z, level)] = opcode - 49;
                    } else if (ground) {
                        ground[packCoord(x, z, level)] = 1;
                    }
                }
            }
        }
    }
    return lands;
}

export interface LocInstance {
    locId: number;
    x: number;
    z: number;
    level: number;
    coord: number;
    shape: number;
    angle: number;
}

export function forEachLoc(packet: Reader, cb: (loc: LocInstance) => void): void {
    let locId: number = -1;
    let locIdOffset: number = packet.gsmarts();
    while (locIdOffset !== 0) {
        locId += locIdOffset;

        let coord: number = 0;
        let coordOffset: number = packet.gsmarts();

        while (coordOffset !== 0) {
            const { x, z, level } = unpackCoord((coord += coordOffset - 1));

            const info: number = packet.g1();
            coordOffset = packet.gsmarts();

            cb({ locId, x, z, level, coord, shape: info >> 2, angle: info & 0x3 });
        }
        locIdOffset = packet.gsmarts();
    }
}

export function bridgedLevel(lands: Int8Array, coord: number, x: number, z: number, level: number): number {
    const bridged: boolean = (level === 1 ? lands[coord] & LINK_BELOW : lands[packCoord(x, z, 1)] & LINK_BELOW) === LINK_BELOW;
    return bridged ? level - 1 : level;
}
