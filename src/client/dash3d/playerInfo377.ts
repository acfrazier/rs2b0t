import { PlayerUpdate } from '#/client/dash3d/ClientPlayer.js';
import Packet from '#/client/io/Packet.js';

/** Java getPlayerNewVis stop index (11-bit). */
export const PLAYER_NEW_INDEX_SENTINEL_377 = 2047;

export function signed5(value: number): number {
    return value > 15 ? value - 32 : value;
}

/** MSB-first bit writer matching Rust `BitWriter377` / Packet.gBit. */
export class BitWriter377 {
    private bytes: number[] = [];
    private bitPosition = 0;

    write(width: number, value: number): void {
        for (let bit = width - 1; bit >= 0; bit--) {
            const byte = (this.bitPosition / 8) | 0;
            if (byte === this.bytes.length) {
                this.bytes.push(0);
            }
            const shift = 7 - (this.bitPosition % 8);
            this.bytes[byte] |= ((value >>> bit) & 1) << shift;
            this.bitPosition++;
        }
    }

    align(): void {
        if (this.bitPosition % 8 !== 0) {
            this.bitPosition = ((this.bitPosition + 7) / 8) | 0;
            this.bitPosition *= 8;
            while (this.bytes.length < this.bitPosition / 8) {
                this.bytes.push(0);
            }
        }
    }

    finish(): Uint8Array {
        return Uint8Array.from(this.bytes);
    }
}

export type PlayerMovement377 = { kind: 'step'; firstDirection: number; secondDirection: number | null } | { kind: 'teleport'; plane: number; x: number; z: number; jump: boolean } | { kind: 'offset'; dx: number; dz: number; jump: boolean };

export type PlayerActorRef377 = { kind: 'local' } | { kind: 'old'; ordinal: number } | { kind: 'new'; index: number };

export type PlayerUpdateBlock377 =
    | { kind: 'anim'; seqId: number; delay: number }
    | { kind: 'say'; text: string }
    | { kind: 'exactMove'; startX: number; startZ: number; endX: number; endZ: number; startDelay: number; endDelay: number; direction: number }
    | { kind: 'faceEntity'; wireValue: number }
    | { kind: 'faceCoordinate'; x: number; z: number }
    | { kind: 'spotanim'; id: number; height: number; delay: number }
    | { kind: 'appearance'; appearance: PlayerAppearance377 }
    | { kind: 'damage'; amount: number; type: number; health: number; totalHealth: number }
    | { kind: 'chat'; colour: number; effect: number; rights: number; packed: Uint8Array }
    | { kind: 'damage2'; amount: number; type: number; health: number; totalHealth: number };

export interface PlayerAppearance377 {
    gender: number;
    headiconPk: number;
    headiconPrayer: number;
    equipment: (number | undefined)[];
    npcTransform: number | null;
    colours: number[];
    sequences: number[];
    usernameBase37: bigint;
    combatLevel: number;
    skillLevel: number;
}

export interface OldVisiblePlayer377 {
    movement: PlayerMovement377 | null;
    removed: boolean;
}

export interface PlayerAddition377 {
    index: number;
    movement: Extract<PlayerMovement377, { kind: 'offset' }>;
}

export interface PlayerInfo377 {
    localMovement: PlayerMovement377 | null;
    oldVisibleCount: number;
    oldVisible: OldVisiblePlayer377[];
    additions: PlayerAddition377[];
    updates: { actor: PlayerActorRef377; blocks: PlayerUpdateBlock377[] }[];
}

export function optionalId(id: number): number {
    return id === 65535 ? -1 : id;
}

export function readPlayerMask(buf: Packet): number {
    let mask = buf.g1();
    if ((mask & PlayerUpdate.BIG_UPDATE) !== 0) {
        mask += buf.g1() << 8;
    }
    return mask;
}

export function parsePlayerAppearance377(data: Uint8Array): PlayerAppearance377 {
    const buf = new Packet(data);
    const gender = buf.g1();
    const headiconPk = buf.g1b();
    const headiconPrayer = buf.g1b();
    const equipment: (number | undefined)[] = new Array(12);
    let npcTransform: number | null = null;
    for (let part = 0; part < 12; part++) {
        const msb = buf.g1();
        if (msb === 0) {
            equipment[part] = 0;
        } else {
            equipment[part] = (msb << 8) + buf.g1();
            if (part === 0 && equipment[0] === 65535) {
                npcTransform = buf.g2();
                break;
            }
        }
    }
    const colours: number[] = [];
    for (let i = 0; i < 5; i++) {
        colours.push(buf.g1());
    }
    const sequences: number[] = [];
    for (let i = 0; i < 7; i++) {
        sequences.push(optionalId(buf.g2()));
    }
    const usernameBase37 = buf.g8();
    const combatLevel = buf.g1();
    const skillLevel = buf.g2();
    if (buf.pos !== data.length) {
        throw new Error('appearance_block_trailing_bytes');
    }
    return {
        gender,
        headiconPk,
        headiconPrayer,
        equipment,
        npcTransform,
        colours,
        sequences,
        usernameBase37,
        combatLevel,
        skillLevel
    };
}

export function readPlayerExtendedBlocks(buf: Packet, mask: number): PlayerUpdateBlock377[] {
    const blocks: PlayerUpdateBlock377[] = [];

    if ((mask & PlayerUpdate.ANIM) !== 0) {
        blocks.push({ kind: 'anim', seqId: optionalId(buf.g2()), delay: buf.g1_alt3() });
    }
    if ((mask & PlayerUpdate.SAY) !== 0) {
        blocks.push({ kind: 'say', text: buf.gjstr() });
    }
    if ((mask & PlayerUpdate.EXACTMOVE) !== 0) {
        blocks.push({
            kind: 'exactMove',
            startX: buf.g1_alt1(),
            startZ: buf.g1_alt2(),
            endX: buf.g1_alt3(),
            endZ: buf.g1(),
            startDelay: buf.g2(),
            endDelay: buf.g2_alt2(),
            direction: buf.g1()
        });
    }
    if ((mask & PlayerUpdate.FACEENTITY) !== 0) {
        blocks.push({ kind: 'faceEntity', wireValue: buf.g2_alt2() });
    }
    if ((mask & PlayerUpdate.FACESQUARE) !== 0) {
        blocks.push({ kind: 'faceCoordinate', x: buf.g2(), z: buf.g2() });
    }
    if ((mask & PlayerUpdate.SPOTANIM) !== 0) {
        const id = optionalId(buf.g2_alt2());
        const packed = buf.g4_alt2();
        blocks.push({ kind: 'spotanim', id, height: packed >> 16, delay: packed & 0xffff });
    }
    if ((mask & PlayerUpdate.APPEARANCE) !== 0) {
        const length = buf.g1();
        const data = new Uint8Array(length);
        buf.gdata_alt1(data, 0, length);
        blocks.push({ kind: 'appearance', appearance: parsePlayerAppearance377(data) });
    }
    if ((mask & PlayerUpdate.HITMARK) !== 0) {
        blocks.push({
            kind: 'damage',
            amount: buf.g1_alt1(),
            type: buf.g1_alt3(),
            health: buf.g1_alt2(),
            totalHealth: buf.g1()
        });
    }
    if ((mask & PlayerUpdate.CHAT) !== 0) {
        const colourEffect = buf.g2();
        const rights = buf.g1_alt2();
        const length = buf.g1_alt1();
        const packed = new Uint8Array(length);
        buf.gdata_alt2(packed, 0, length);
        blocks.push({
            kind: 'chat',
            colour: colourEffect >> 8,
            effect: colourEffect & 0xff,
            rights,
            packed
        });
    }
    if ((mask & PlayerUpdate.HITMARK2) !== 0) {
        blocks.push({
            kind: 'damage2',
            amount: buf.g1_alt3(),
            type: buf.g1_alt2(),
            health: buf.g1_alt3(),
            totalHealth: buf.g1()
        });
    }

    return blocks;
}

/**
 * Decode one 377 PLAYER_INFO body (no opcode/length prefix).
 * Bit order and mask blocks match Client-Java getPlayerPos / getPlayerExtended.
 */
export function decodePlayerInfo377(buf: Packet, size: number = buf.length): PlayerInfo377 {
    const updates: { actor: PlayerActorRef377; blocks: PlayerUpdateBlock377[] }[] = [];
    let localMovement: PlayerMovement377 | null = null;

    buf.gBitStart();

    if (buf.gBit(1) !== 0) {
        const op = buf.gBit(2);
        if (op === 0) {
            updates.push({ actor: { kind: 'local' }, blocks: [] });
        } else if (op === 1) {
            const firstDirection = buf.gBit(3);
            localMovement = { kind: 'step', firstDirection, secondDirection: null };
            if (buf.gBit(1) === 1) {
                updates.push({ actor: { kind: 'local' }, blocks: [] });
            }
        } else if (op === 2) {
            const firstDirection = buf.gBit(3);
            const secondDirection = buf.gBit(3);
            localMovement = { kind: 'step', firstDirection, secondDirection };
            if (buf.gBit(1) === 1) {
                updates.push({ actor: { kind: 'local' }, blocks: [] });
            }
        } else if (op === 3) {
            const jump = buf.gBit(1) === 1;
            const plane = buf.gBit(2);
            const z = buf.gBit(7);
            const x = buf.gBit(7);
            localMovement = { kind: 'teleport', plane, x, z, jump };
            if (buf.gBit(1) === 1) {
                updates.push({ actor: { kind: 'local' }, blocks: [] });
            }
        }
    }

    const oldVisibleCount = buf.gBit(8);
    const oldVisible: OldVisiblePlayer377[] = [];
    for (let ordinal = 0; ordinal < oldVisibleCount; ordinal++) {
        if (buf.gBit(1) === 0) {
            oldVisible.push({ movement: null, removed: false });
            continue;
        }
        const op = buf.gBit(2);
        if (op === 0) {
            oldVisible.push({ movement: null, removed: false });
            updates.push({ actor: { kind: 'old', ordinal }, blocks: [] });
        } else if (op === 1) {
            const firstDirection = buf.gBit(3);
            const update = buf.gBit(1) === 1;
            oldVisible.push({ movement: { kind: 'step', firstDirection, secondDirection: null }, removed: false });
            if (update) {
                updates.push({ actor: { kind: 'old', ordinal }, blocks: [] });
            }
        } else if (op === 2) {
            const firstDirection = buf.gBit(3);
            const secondDirection = buf.gBit(3);
            const update = buf.gBit(1) === 1;
            oldVisible.push({ movement: { kind: 'step', firstDirection, secondDirection }, removed: false });
            if (update) {
                updates.push({ actor: { kind: 'old', ordinal }, blocks: [] });
            }
        } else {
            oldVisible.push({ movement: null, removed: true });
        }
    }

    const additions: PlayerAddition377[] = [];
    while (buf.bitPos + 10 < size * 8) {
        const index = buf.gBit(11);
        if (index === PLAYER_NEW_INDEX_SENTINEL_377) {
            break;
        }
        const dx = signed5(buf.gBit(5));
        const update = buf.gBit(1) === 1;
        const jump = buf.gBit(1) === 1;
        const dz = signed5(buf.gBit(5));
        additions.push({ index, movement: { kind: 'offset', dx, dz, jump } });
        if (update) {
            updates.push({ actor: { kind: 'new', index }, blocks: [] });
        }
    }

    buf.gBitEnd();

    for (const update of updates) {
        const mask = readPlayerMask(buf);
        update.blocks = readPlayerExtendedBlocks(buf, mask);
    }

    if (buf.pos !== size) {
        throw new Error(`player-info trailing or truncated bytes pos=${buf.pos} size=${size}`);
    }

    return { localMovement, oldVisibleCount, oldVisible, additions, updates };
}
