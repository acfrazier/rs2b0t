import { NpcUpdate } from '#/client/dash3d/ClientNpc.js';
import { optionalId, signed5, type PlayerMovement377 } from '#/client/dash3d/playerInfo377.js';
import Packet from '#/client/io/Packet.js';

/** Java getNpcPosNewVis stop index (14-bit). */
export const NPC_NEW_INDEX_SENTINEL_377 = 16383;

export type NpcActorRef377 = { kind: 'old'; ordinal: number } | { kind: 'new'; index: number };

export type NpcUpdateBlock377 =
    | { kind: 'changeType'; typeId: number }
    | { kind: 'faceEntity'; wireValue: number }
    | { kind: 'damage'; amount: number; type: number; health: number; totalHealth: number }
    | { kind: 'spotanim'; id: number; height: number; delay: number }
    | { kind: 'say'; text: string }
    | { kind: 'faceCoordinate'; x: number; z: number }
    | { kind: 'anim'; seqId: number; delay: number }
    | { kind: 'damage2'; amount: number; type: number; health: number; totalHealth: number };

export interface OldVisibleNpc377 {
    movement: PlayerMovement377 | null;
    removed: boolean;
}

export interface NpcAddition377 {
    index: number;
    typeId: number;
    movement: Extract<PlayerMovement377, { kind: 'offset' }>;
}

export interface NpcInfo377 {
    oldVisibleCount: number;
    oldVisible: OldVisibleNpc377[];
    additions: NpcAddition377[];
    updates: { actor: NpcActorRef377; blocks: NpcUpdateBlock377[] }[];
}

export function readNpcExtendedBlocks(buf: Packet, mask: number): NpcUpdateBlock377[] {
    const blocks: NpcUpdateBlock377[] = [];

    if ((mask & NpcUpdate.CHANGETYPE) !== 0) {
        blocks.push({ kind: 'changeType', typeId: buf.g2_alt2() });
    }
    if ((mask & NpcUpdate.FACEENTITY) !== 0) {
        blocks.push({ kind: 'faceEntity', wireValue: buf.g2_alt1() });
    }
    if ((mask & NpcUpdate.HITMARK) !== 0) {
        blocks.push({
            kind: 'damage',
            amount: buf.g1_alt1(),
            type: buf.g1_alt1(),
            health: buf.g1(),
            totalHealth: buf.g1_alt3()
        });
    }
    if ((mask & NpcUpdate.SPOTANIM) !== 0) {
        const id = optionalId(buf.g2());
        const packed = buf.g4_alt2();
        blocks.push({ kind: 'spotanim', id, height: packed >> 16, delay: packed & 0xffff });
    }
    if ((mask & NpcUpdate.SAY) !== 0) {
        blocks.push({ kind: 'say', text: buf.gjstr() });
    }
    if ((mask & NpcUpdate.FACESQUARE) !== 0) {
        blocks.push({ kind: 'faceCoordinate', x: buf.g2_alt3(), z: buf.g2_alt1() });
    }
    if ((mask & NpcUpdate.ANIM) !== 0) {
        blocks.push({ kind: 'anim', seqId: optionalId(buf.g2()), delay: buf.g1_alt3() });
    }
    if ((mask & NpcUpdate.HITMARK2) !== 0) {
        blocks.push({
            kind: 'damage2',
            amount: buf.g1_alt3(),
            type: buf.g1_alt3(),
            health: buf.g1(),
            totalHealth: buf.g1_alt2()
        });
    }

    return blocks;
}

/**
 * Decode one 377 NPC_INFO body (no opcode/length prefix).
 * Bit order and mask blocks match Client-Java getNpcPos / getNpcPosExtended.
 */
export function decodeNpcInfo377(buf: Packet, size: number = buf.length): NpcInfo377 {
    const updates: { actor: NpcActorRef377; blocks: NpcUpdateBlock377[] }[] = [];

    buf.gBitStart();

    const oldVisibleCount = buf.gBit(8);
    const oldVisible: OldVisibleNpc377[] = [];
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

    const additions: NpcAddition377[] = [];
    while (buf.bitPos + 21 < size * 8) {
        const index = buf.gBit(14);
        if (index === NPC_NEW_INDEX_SENTINEL_377) {
            break;
        }
        const update = buf.gBit(1) === 1;
        const dz = signed5(buf.gBit(5));
        const dx = signed5(buf.gBit(5));
        const jump = buf.gBit(1) === 1;
        const typeId = buf.gBit(13);
        additions.push({ index, typeId, movement: { kind: 'offset', dx, dz, jump } });
        if (update) {
            updates.push({ actor: { kind: 'new', index }, blocks: [] });
        }
    }

    buf.gBitEnd();

    for (const update of updates) {
        const mask = buf.g1();
        update.blocks = readNpcExtendedBlocks(buf, mask);
    }

    if (buf.pos !== size) {
        throw new Error(`npc-info trailing or truncated bytes pos=${buf.pos} size=${size}`);
    }

    return { oldVisibleCount, oldVisible, additions, updates };
}
