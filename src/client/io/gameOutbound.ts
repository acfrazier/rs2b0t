import Packet from '#/client/io/Packet.js';

/**
 * Revision 377 outbound layouts. Java `Client.java` is the oracle (line cites
 * below). The opcode is an argument so a caller passes the generated `ClientProt`
 * value. Engine decoders are the independent check; where they disagree with
 * Java the writer still follows Java and the census records it. The dropped 289
 * names `ANTICHEAT_OPLOGIC6..9` and `ANTICHEAT_CYCLELOGIC7` are never written.
 */

export interface WaypointStep {
    dx: number;
    dz: number;
}

/** Placed loc id from a scene typecode. Morph resolution must not replace this. Java `var6 >> 14 & 0x7FFF`. */
export function placedLocId(typecode: number): number {
    return (typecode >> 14) & 0x7fff;
}

export interface OutboundSpec {
    name: string;
    id: number;
    length: number;
    javaLine: number;
    /** emitted: a call site writes it. platform-absent: Java's condition is false in the browser. */
    disposition: 'emitted' | 'platform-absent';
    note: string;
}

export const OUTBOUND_CENSUS: readonly OutboundSpec[] = [
    { name: 'NO_TIMEOUT', id: 40, length: 0, javaLine: 3409, disposition: 'emitted', note: 'opcode only' },
    { name: 'IDLE_TIMER', id: 202, length: 0, javaLine: 3344, disposition: 'emitted', note: 'opcode only' },
    { name: 'EVENT_MOUSE_CLICK', id: 19, length: 4, javaLine: 3123, disposition: 'emitted', note: 'p4 packed click; layout unchanged from 289' },
    { name: 'EVENT_MOUSE_MOVE', id: 171, length: -1, javaLine: 3040, disposition: 'emitted', note: 'variable body; layout matches Java' },
    { name: 'EVENT_APPLET_FOCUS', id: 187, length: 1, javaLine: 3149, disposition: 'emitted', note: 'p1 focus' },
    { name: 'EVENT_CAMERA_POSITION', id: 140, length: 4, javaLine: 3140, disposition: 'emitted', note: 'Java p2_alt1/p2_alt1 (Client.java:3141-3142). Engine and Client-TS plain g2 are fixed separately (JAVA-OUTBOUND-1107)' },
    { name: 'EVENT_HAS_WINDOW', id: 78, length: 4, javaLine: 3655, disposition: 'platform-absent', note: 'Java sends p4(1057001181) only when frame != null (Client.java:3655); browser has no Frame, so the writer is not exported' },
    { name: 'EVENT_SYNTH_ERROR', id: 80, length: 2, javaLine: 3844, disposition: 'emitted', note: 'p2(waveIds[wave] & 0x7fff). Client.java:3842-3845; signlink.reporterror is true (signlink.java:49) so p2(-1) is unreachable. Guard is Client.java:3826' },
    { name: 'ANTICHEAT_OPLOGIC1', id: 95, length: 4, javaLine: 10345, disposition: 'emitted', note: 'OPOBJ2, oplogic1 >= 120, p4(0)' },
    { name: 'ANTICHEAT_OPLOGIC2', id: 165, length: 1, javaLine: 9700, disposition: 'emitted', note: 'OPHELD4, oplogic2 >= 62, p1(206)' },
    { name: 'ANTICHEAT_OPLOGIC3', id: 157, length: 4, javaLine: 9971, disposition: 'emitted', note: 'OPNPC3, oplogic3 >= 143, p4(0)' },
    { name: 'ANTICHEAT_OPLOGIC4', id: 222, length: 3, javaLine: 10061, disposition: 'emitted', note: 'OPOBJ3 when (obj & 3) == 0, oplogic4 >= 84, p3(11257922)' },
    { name: 'ANTICHEAT_OPLOGIC5', id: 126, length: 1, javaLine: 9750, disposition: 'emitted', note: 'OPHELD1, oplogic5 >= 115, p1(125)' },
    { name: 'ANTICHEAT_CYCLELOGIC1', id: 244, length: -1, javaLine: 6232, disposition: 'emitted', note: 'getTopLevel/roofCheck, cyclelogic1 > 1457' },
    { name: 'ANTICHEAT_CYCLELOGIC2', id: 168, length: 0, javaLine: 5746, disposition: 'emitted', note: 'redrawFrame, cyclelogic2 > 85, empty payload' },
    { name: 'ANTICHEAT_CYCLELOGIC3', id: 197, length: 4, javaLine: 6696, disposition: 'emitted', note: 'reboot-timer overlay, cyclelogic3 > 112, p4(0)' },
    { name: 'ANTICHEAT_CYCLELOGIC4', id: 173, length: 3, javaLine: 3748, disposition: 'emitted', note: 'minimap build, cyclelogic4 > 177, p3(2657152)' },
    { name: 'ANTICHEAT_CYCLELOGIC5', id: 248, length: 0, javaLine: 6170, disposition: 'emitted', note: 'pushProjectiles, cyclelogic5 > 51' },
    { name: 'ANTICHEAT_CYCLELOGIC6', id: 22, length: 2, javaLine: 4561, disposition: 'emitted', note: 'p2(38304) only after a chat-mode left click. Client.java:4513-4564' },
    { name: 'OPOBJ1', id: 77, length: 6, javaLine: 10042, disposition: 'emitted', note: 'p2_alt2 x, p2 z, p2_alt3 obj; no anticheat' },
    { name: 'OPOBJ2', id: 100, length: 6, javaLine: 10350, disposition: 'emitted', note: 'p2 x, p2_alt2 z, p2_alt3 obj' },
    { name: 'OPOBJ3', id: 71, length: 6, javaLine: 10066, disposition: 'emitted', note: 'p2_alt3 obj, p2_alt3 x, p2_alt2 z' },
    { name: 'OPOBJ4', id: 54, length: 6, javaLine: 9852, disposition: 'emitted', note: 'p2_alt2 obj, p2_alt1 z, p2 x' },
    { name: 'OPOBJ5', id: 230, length: 6, javaLine: 10276, disposition: 'emitted', note: 'p2_alt1 obj, p2_alt2 x, p2 z; no anticheat' },
    { name: 'OPOBJT', id: 83, length: 8, javaLine: 10471, disposition: 'emitted', note: 'p2_alt1 obj, p2 z, p2_alt1 spell, p2_alt3 x' },
    { name: 'OPOBJU', id: 211, length: 12, javaLine: 10307, disposition: 'emitted', note: 'useSlot p2_alt3, useObj p2_alt2, z p2_alt3, x p2_alt3, useCom p2_alt1, obj p2_alt1' },
    { name: 'OPNPC1', id: 112, length: 2, javaLine: 10457, disposition: 'emitted', note: 'p2_alt1 slot' },
    { name: 'OPNPC2', id: 67, length: 2, javaLine: 9742, disposition: 'emitted', note: 'p2_alt2 slot' },
    { name: 'OPNPC3', id: 13, length: 2, javaLine: 9976, disposition: 'emitted', note: 'p2_alt3 slot' },
    { name: 'OPNPC4', id: 42, length: 2, javaLine: 9806, disposition: 'emitted', note: 'p2_alt1 slot' },
    { name: 'OPNPC5', id: 8, length: 2, javaLine: 9997, disposition: 'emitted', note: 'p2_alt1 slot' },
    { name: 'OPNPCT', id: 104, length: 4, javaLine: 10027, disposition: 'emitted', note: 'p2_alt2 spell, p2_alt1 slot' },
    { name: 'OPNPCU', id: 57, length: 8, javaLine: 9883, disposition: 'emitted', note: 'p2 slot, p2_alt1 useObj, p2_alt3 useCom, p2 useSlot' },
    { name: 'OPLOC1', id: 181, length: 6, javaLine: 10186, disposition: 'emitted', note: 'placed id; p2_alt2 x, p2_alt1 z, p2_alt1 loc' },
    { name: 'OPLOC2', id: 241, length: 6, javaLine: 10389, disposition: 'emitted', note: 'placed id; p2 loc, p2 x, p2_alt2 z' },
    { name: 'OPLOC3', id: 50, length: 6, javaLine: 10194, disposition: 'emitted', note: 'placed id; p2_alt2 z, p2_alt1 loc, p2_alt3 x' },
    { name: 'OPLOC4', id: 136, length: 6, javaLine: 10261, disposition: 'emitted', note: 'placed id; p2 x, p2_alt1 z, p2 loc' },
    { name: 'OPLOC5', id: 55, length: 6, javaLine: 10178, disposition: 'emitted', note: 'placed id; p2_alt1 loc, p2_alt1 z, p2 x' },
    { name: 'OPLOCT', id: 210, length: 8, javaLine: 9982, disposition: 'emitted', note: 'only if interactWithLoc; p2 spell, p2_alt1 loc, p2_alt2 x, p2_alt1 z' },
    { name: 'OPLOCU', id: 152, length: 12, javaLine: 9772, disposition: 'emitted', note: 'only if interactWithLoc; loc, useCom, useObj, z, useSlot, x' },
    { name: 'OPPLAYER1', id: 245, length: 2, javaLine: 9692, disposition: 'emitted', note: 'p2_alt3 slot; no oplogic' },
    { name: 'OPPLAYER2', id: 233, length: 2, javaLine: 9911, disposition: 'emitted', note: 'p2_alt2 slot' },
    { name: 'OPPLAYER3', id: 194, length: 2, javaLine: 10511, disposition: 'emitted', note: 'p2_alt1 slot' },
    { name: 'OPPLAYER4', id: 116, length: 2, javaLine: 9819, disposition: 'emitted', note: 'p2_alt1 slot; trade accept uses the same layout' },
    { name: 'OPPLAYER5', id: 45, length: 2, javaLine: 9729, disposition: 'emitted', note: 'p2_alt2 slot' },
    { name: 'OPPLAYERT', id: 31, length: 4, javaLine: 10013, disposition: 'emitted', note: 'p2 slot, p2_alt1 spell' },
    { name: 'OPPLAYERU', id: 143, length: 8, javaLine: 10290, disposition: 'emitted', note: 'p2_alt1 useObj, p2_alt3 useSlot, p2 useCom, p2_alt2 slot' },
    { name: 'OPHELD1', id: 203, length: 6, javaLine: 9755, disposition: 'emitted', note: 'p2_alt2 com, p2_alt1 slot, p2_alt1 obj' },
    { name: 'OPHELD2', id: 24, length: 6, javaLine: 9859, disposition: 'emitted', note: 'p2_alt1 com, p2_alt1 obj, p2_alt2 slot' },
    { name: 'OPHELD3', id: 161, length: 6, javaLine: 10201, disposition: 'emitted', note: 'p2_alt3 slot, p2_alt3 obj, p2_alt1 com' },
    { name: 'OPHELD4', id: 228, length: 6, javaLine: 9705, disposition: 'emitted', note: 'p2_alt1 slot, p2_alt2 obj, p2 com' },
    { name: 'OPHELD5', id: 4, length: 6, javaLine: 10143, disposition: 'emitted', note: 'p2_alt1 slot, p2_alt3 obj, p2_alt3 com' },
    { name: 'OPHELDT', id: 36, length: 8, javaLine: 9944, disposition: 'emitted', note: 'p2 spell, p2_alt2 com, p2_alt2 slot, p2_alt2 obj' },
    { name: 'OPHELDU', id: 1, length: 12, javaLine: 9924, disposition: 'emitted', note: 'p2 obj, p2_alt1 useSlot, p2_alt1 useObj, p2_alt3 useCom, p2_alt2 slot, p2_alt2 com' },
    { name: 'INV_BUTTON1', id: 3, length: 6, javaLine: 9782, disposition: 'emitted', note: 'p2_alt2 obj, p2 com, p2 slot' },
    { name: 'INV_BUTTON2', id: 177, length: 6, javaLine: 10103, disposition: 'emitted', note: 'p2_alt2 slot, p2_alt1 obj, p2_alt1 com' },
    { name: 'INV_BUTTON3', id: 91, length: 6, javaLine: 10357, disposition: 'emitted', note: 'p2_alt1 obj, p2_alt3 slot, p2 com' },
    { name: 'INV_BUTTON4', id: 231, length: 6, javaLine: 10396, disposition: 'emitted', note: 'p2_alt3 com, p2_alt1 slot, p2 obj' },
    { name: 'INV_BUTTON5', id: 158, length: 6, javaLine: 10160, disposition: 'emitted', note: 'p2_alt3 slot, p2_alt3 obj, p2_alt1 com' },
    { name: 'IF_BUTTON', id: 79, length: 2, javaLine: 9892, disposition: 'emitted', note: 'p2 component' },
    { name: 'RESUME_PAUSEBUTTON', id: 226, length: 2, javaLine: 10254, disposition: 'emitted', note: 'p2 component; engine decoder ignores the payload' },
    { name: 'CLOSE_MODAL', id: 110, length: 0, javaLine: 4569, disposition: 'emitted', note: 'opcode only' },
    { name: 'RESUME_P_COUNTDIALOG', id: 75, length: 4, javaLine: 4896, disposition: 'emitted', note: 'p4; engine reads g4s' },
    { name: 'TUT_CLICKSIDE', id: 119, length: 1, javaLine: 5841, disposition: 'emitted', note: 'p1 tab' },
    { name: 'RESUME_P_NAMEDIALOG', id: 206, length: 8, javaLine: 4917, disposition: 'emitted', note: 'p8 userhash (Client.java:4917). chatbackInputOpen === 2 sends this and clears the field; === 1 is the count dialog on dialogInputOpen; === 3 is never set by Java 377 (no assignment in Client.java), so rs2b0t has no state 3' },
    { name: 'MAP_BUILD_COMPLETE', id: 6, length: 0, javaLine: 3500, disposition: 'emitted', note: 'opcode only' },
    { name: 'MOVE_OPCLICK', id: 247, length: -1, javaLine: 7194, disposition: 'emitted', note: 'p2_alt3 x, p1 ctrl, p2_alt3 z, then p1 dx p1_alt3 dz' },
    { name: 'SEND_SNAPSHOT', id: 184, length: 10, javaLine: 12049, disposition: 'emitted', note: 'p8 name, p1 reason, p1 mute' },
    { name: 'MOVE_MINIMAPCLICK', id: 213, length: -1, javaLine: 7189, disposition: 'emitted', note: 'same path as MOVE_OPCLICK plus 14 trailing bytes written by the minimap handler' },
    { name: 'INV_BUTTOND', id: 123, length: 7, javaLine: 3257, disposition: 'emitted', note: 'p2_alt3 to, p1_alt1 mode, p2_alt2 com, p2_alt1 from' },
    { name: 'IGNORELIST_DEL', id: 160, length: 8, javaLine: 12531, disposition: 'emitted', note: 'p8' },
    { name: 'IGNORELIST_ADD', id: 217, length: 8, javaLine: 12514, disposition: 'emitted', note: 'p8' },
    { name: 'IDK_SAVEDESIGN', id: 163, length: 13, javaLine: 12032, disposition: 'emitted', note: 'p1 gender, 7 kits, 5 colours' },
    { name: 'CHAT_SETMODE', id: 176, length: 3, javaLine: 4522, disposition: 'emitted', note: 'p1 public, private, trade' },
    { name: 'MESSAGE_PRIVATE', id: 227, length: -1, javaLine: 4841, disposition: 'emitted', note: 'p8 name + wordpack' },
    { name: 'FRIENDLIST_DEL', id: 141, length: 8, javaLine: 12482, disposition: 'emitted', note: 'p8' },
    { name: 'FRIENDLIST_ADD', id: 120, length: 8, javaLine: 12461, disposition: 'emitted', note: 'p8' },
    { name: 'CLIENT_CHEAT', id: 56, length: -1, javaLine: 4972, disposition: 'emitted', note: 'p1(length-1) pjstr(substring(2)) of the :: line' },
    { name: 'MESSAGE_PUBLIC', id: 49, length: -1, javaLine: 5037, disposition: 'emitted', note: 'Java p1_alt2 colour, p1_alt1 effect (Client.java:5041-5042). Recorded Client-TS 00 00 is a pre-fix capture, not ground truth; JAVA-OUTBOUND-1107 fixes the engine' },
    { name: 'MOVE_GAMECLICK', id: 28, length: -1, javaLine: 7184, disposition: 'emitted', note: 'p2_alt3 x, p1 ctrl, p2_alt3 z, then p1 dx p1_alt3 dz' }
];

function opcodeOnly(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
}

export function writeNoTimeout(out: Packet, opcode: number): void {
    opcodeOnly(out, opcode);
}

export function writeIdleTimer(out: Packet, opcode: number): void {
    opcodeOnly(out, opcode);
}

export function writeMapBuildComplete(out: Packet, opcode: number): void {
    opcodeOnly(out, opcode);
}

export function writeCloseModal(out: Packet, opcode: number): void {
    opcodeOnly(out, opcode);
}

export function writeAnticheatCycleLogic2(out: Packet, opcode: number): void {
    opcodeOnly(out, opcode);
}

export function writeAnticheatCycleLogic5(out: Packet, opcode: number): void {
    opcodeOnly(out, opcode);
}

export function writeEventMouseClick(out: Packet, opcode: number, packed: number): void {
    out.p1Enc(opcode);
    out.p4(packed);
}

export function writeEventAppletFocus(out: Packet, opcode: number, focused: number): void {
    out.p1Enc(opcode);
    out.p1(focused);
}

/** Java p2_alt1 pitch, p2_alt1 yaw (Client.java:3141-3142). Engine plain g2 is JAVA-OUTBOUND-1107. */
export function writeEventCameraPosition(out: Packet, opcode: number, pitch: number, yaw: number): void {
    out.p1Enc(opcode);
    out.p2_alt1(pitch);
    out.p2_alt1(yaw);
}

/** Java Client.java:3040. The callback writes samples; the length byte is filled after it returns. */
export function writeEventMouseMove(out: Packet, opcode: number, writeSamples: (out: Packet) => void): void {
    out.p1Enc(opcode);
    out.p1(0);
    const start = out.pos;
    writeSamples(out);
    out.psize1(out.pos - start);
}

export function writeEventSynthError(out: Packet, opcode: number, waveId: number): void {
    out.p1Enc(opcode);
    out.p2(waveId);
}

export function writeAnticheatOpLogic1(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p4(0);
}

export function writeAnticheatOpLogic2(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p1(206);
}

export function writeAnticheatOpLogic3(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p4(0);
}

export function writeAnticheatOpLogic4(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p3(11257922);
}

export function writeAnticheatOpLogic5(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p1(125);
}

export interface CycleLogic1Rolls {
    word: number;
    byte1: number;
    extra: boolean;
    byte2: number;
}

/** Java Client.java:6232. `rolls` replaces Math.random so tests are exact. */
export function writeAnticheatCycleLogic1(out: Packet, opcode: number, rolls: CycleLogic1Rolls): void {
    out.p1Enc(opcode);
    out.p1(0);
    const start = out.pos;
    out.p1(219);
    out.p2(37745);
    out.p1(61);
    out.p2(43756);
    out.p2(rolls.word);
    out.p1(rolls.byte1);
    out.p2(51171);
    if (rolls.extra) {
        out.p2(15808);
    }
    out.p1(97);
    out.p1(rolls.byte2);
    out.psize1(out.pos - start);
}

export function writeAnticheatCycleLogic3(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p4(0);
}

export function writeAnticheatCycleLogic4(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p3(2657152);
}

export function writeAnticheatCycleLogic6(out: Packet, opcode: number): void {
    out.p1Enc(opcode);
    out.p2(38304);
}

export function writeMoveClick(out: Packet, opcode: number, x: number, ctrl: number, z: number, steps: readonly WaypointStep[], lengthExtra = 0): void {
    out.p1Enc(opcode);
    out.p1(5 + steps.length * 2 + lengthExtra);
    out.p2_alt3(x);
    out.p1(ctrl);
    out.p2_alt3(z);
    for (const step of steps) {
        out.p1(step.dx);
        out.p1_alt3(step.dz);
    }
}

/** The 14 bytes MOVE_MINIMAPCLICK appends after the shared path. Java Client.java:4424. */
export function writeMinimapClickExtra(out: Packet, clickX: number, clickY: number, yaw: number, angle: number, zoom: number, playerX: number, playerZ: number, nearest: number): void {
    out.p1(clickX);
    out.p1(clickY);
    out.p2(yaw);
    out.p1(57);
    out.p1(angle);
    out.p1(zoom);
    out.p1(89);
    out.p2(playerX);
    out.p2(playerZ);
    out.p1(nearest);
    out.p1(63);
}

export function writeObjOp(out: Packet, opcode: number, op: 1 | 2 | 3 | 4 | 5, x: number, z: number, objId: number): void {
    out.p1Enc(opcode);
    if (op === 1) {
        out.p2_alt2(x);
        out.p2(z);
        out.p2_alt3(objId);
    } else if (op === 2) {
        out.p2(x);
        out.p2_alt2(z);
        out.p2_alt3(objId);
    } else if (op === 3) {
        out.p2_alt3(objId);
        out.p2_alt3(x);
        out.p2_alt2(z);
    } else if (op === 4) {
        out.p2_alt2(objId);
        out.p2_alt1(z);
        out.p2(x);
    } else {
        out.p2_alt1(objId);
        out.p2_alt2(x);
        out.p2(z);
    }
}

export function writeObjT(out: Packet, opcode: number, objId: number, z: number, spellCom: number, x: number): void {
    out.p1Enc(opcode);
    out.p2_alt1(objId);
    out.p2(z);
    out.p2_alt1(spellCom);
    out.p2_alt3(x);
}

export function writeObjU(out: Packet, opcode: number, useSlot: number, useObj: number, z: number, x: number, useCom: number, objId: number): void {
    out.p1Enc(opcode);
    out.p2_alt3(useSlot);
    out.p2_alt2(useObj);
    out.p2_alt3(z);
    out.p2_alt3(x);
    out.p2_alt1(useCom);
    out.p2_alt1(objId);
}

export function writeNpcOp(out: Packet, opcode: number, op: 1 | 2 | 3 | 4 | 5, slot: number): void {
    out.p1Enc(opcode);
    if (op === 2) {
        out.p2_alt2(slot);
    } else if (op === 3) {
        out.p2_alt3(slot);
    } else {
        out.p2_alt1(slot);
    }
}

export function writeNpcT(out: Packet, opcode: number, spellCom: number, slot: number): void {
    out.p1Enc(opcode);
    out.p2_alt2(spellCom);
    out.p2_alt1(slot);
}

export function writeNpcU(out: Packet, opcode: number, slot: number, useObj: number, useCom: number, useSlot: number): void {
    out.p1Enc(opcode);
    out.p2(slot);
    out.p2_alt1(useObj);
    out.p2_alt3(useCom);
    out.p2(useSlot);
}

export function writeLocOp(out: Packet, opcode: number, op: 1 | 2 | 3 | 4 | 5, x: number, z: number, locId: number): void {
    out.p1Enc(opcode);
    if (op === 1) {
        out.p2_alt2(x);
        out.p2_alt1(z);
        out.p2_alt1(locId);
    } else if (op === 2) {
        out.p2(locId);
        out.p2(x);
        out.p2_alt2(z);
    } else if (op === 3) {
        out.p2_alt2(z);
        out.p2_alt1(locId);
        out.p2_alt3(x);
    } else if (op === 4) {
        out.p2(x);
        out.p2_alt1(z);
        out.p2(locId);
    } else {
        out.p2_alt1(locId);
        out.p2_alt1(z);
        out.p2(x);
    }
}

export function writeLocT(out: Packet, opcode: number, spellCom: number, locId: number, x: number, z: number): void {
    out.p1Enc(opcode);
    out.p2(spellCom);
    out.p2_alt1(locId);
    out.p2_alt2(x);
    out.p2_alt1(z);
}

export function writeLocU(out: Packet, opcode: number, locId: number, useCom: number, useObj: number, z: number, useSlot: number, x: number): void {
    out.p1Enc(opcode);
    out.p2_alt1(locId);
    out.p2_alt1(useCom);
    out.p2_alt1(useObj);
    out.p2_alt1(z);
    out.p2(useSlot);
    out.p2_alt3(x);
}

export function writePlayerOp(out: Packet, opcode: number, op: 1 | 2 | 3 | 4 | 5, slot: number): void {
    out.p1Enc(opcode);
    if (op === 1) {
        out.p2_alt3(slot);
    } else if (op === 2 || op === 5) {
        out.p2_alt2(slot);
    } else {
        out.p2_alt1(slot);
    }
}

export function writePlayerT(out: Packet, opcode: number, slot: number, spellCom: number): void {
    out.p1Enc(opcode);
    out.p2(slot);
    out.p2_alt1(spellCom);
}

export function writePlayerU(out: Packet, opcode: number, useObj: number, useSlot: number, useCom: number, slot: number): void {
    out.p1Enc(opcode);
    out.p2_alt1(useObj);
    out.p2_alt3(useSlot);
    out.p2(useCom);
    out.p2_alt2(slot);
}

export function writeHeldOp(out: Packet, opcode: number, op: 1 | 2 | 3 | 4 | 5, objId: number, slot: number, com: number): void {
    out.p1Enc(opcode);
    if (op === 1) {
        out.p2_alt2(com);
        out.p2_alt1(slot);
        out.p2_alt1(objId);
    } else if (op === 2) {
        out.p2_alt1(com);
        out.p2_alt1(objId);
        out.p2_alt2(slot);
    } else if (op === 3) {
        out.p2_alt3(slot);
        out.p2_alt3(objId);
        out.p2_alt1(com);
    } else if (op === 4) {
        out.p2_alt1(slot);
        out.p2_alt2(objId);
        out.p2(com);
    } else {
        out.p2_alt1(slot);
        out.p2_alt3(objId);
        out.p2_alt3(com);
    }
}

export function writeHeldT(out: Packet, opcode: number, spellCom: number, com: number, slot: number, objId: number): void {
    out.p1Enc(opcode);
    out.p2(spellCom);
    out.p2_alt2(com);
    out.p2_alt2(slot);
    out.p2_alt2(objId);
}

export function writeHeldU(out: Packet, opcode: number, objId: number, useSlot: number, useObj: number, useCom: number, slot: number, com: number): void {
    out.p1Enc(opcode);
    out.p2(objId);
    out.p2_alt1(useSlot);
    out.p2_alt1(useObj);
    out.p2_alt3(useCom);
    out.p2_alt2(slot);
    out.p2_alt2(com);
}

export function writeInvButton(out: Packet, opcode: number, op: 1 | 2 | 3 | 4 | 5, objId: number, slot: number, com: number): void {
    out.p1Enc(opcode);
    if (op === 1) {
        out.p2_alt2(objId);
        out.p2(com);
        out.p2(slot);
    } else if (op === 2) {
        out.p2_alt2(slot);
        out.p2_alt1(objId);
        out.p2_alt1(com);
    } else if (op === 3) {
        out.p2_alt1(objId);
        out.p2_alt3(slot);
        out.p2(com);
    } else if (op === 4) {
        out.p2_alt3(com);
        out.p2_alt1(slot);
        out.p2(objId);
    } else {
        out.p2_alt3(slot);
        out.p2_alt3(objId);
        out.p2_alt1(com);
    }
}

/** Java Client.java:3257. `to` is the hovered slot, `from` the drag source. */
export function writeInvButtonD(out: Packet, opcode: number, to: number, mode: number, com: number, from: number): void {
    out.p1Enc(opcode);
    out.p2_alt3(to);
    out.p1_alt1(mode);
    out.p2_alt2(com);
    out.p2_alt1(from);
}

export function writeIfButton(out: Packet, opcode: number, com: number): void {
    out.p1Enc(opcode);
    out.p2(com);
}

export function writeResumePauseButton(out: Packet, opcode: number, com: number): void {
    out.p1Enc(opcode);
    out.p2(com);
}

export function writeResumePCountDialog(out: Packet, opcode: number, value: number): void {
    out.p1Enc(opcode);
    out.p4(value);
}

/** Java `RESUME_P_NAMEDIALOG` (Client.java:4917): p8 base37 userhash. */
export function writeResumePNameDialog(out: Packet, opcode: number, userhash: bigint): void {
    out.p1Enc(opcode);
    out.p8(userhash);
}

export function writeTutClickSide(out: Packet, opcode: number, tab: number): void {
    out.p1Enc(opcode);
    out.p1(tab);
}

export function writeSendSnapshot(out: Packet, opcode: number, userhash: bigint, reason: number, mute: number): void {
    out.p1Enc(opcode);
    out.p8(userhash);
    out.p1(reason);
    out.p1(mute);
}

export function writeIgnoreListAdd(out: Packet, opcode: number, userhash: bigint): void {
    out.p1Enc(opcode);
    out.p8(userhash);
}

export function writeIgnoreListDel(out: Packet, opcode: number, userhash: bigint): void {
    out.p1Enc(opcode);
    out.p8(userhash);
}

export function writeFriendListAdd(out: Packet, opcode: number, userhash: bigint): void {
    out.p1Enc(opcode);
    out.p8(userhash);
}

export function writeFriendListDel(out: Packet, opcode: number, userhash: bigint): void {
    out.p1Enc(opcode);
    out.p8(userhash);
}

export function writeIdkSaveDesign(out: Packet, opcode: number, genderMale: boolean, kits: ArrayLike<number>, colours: ArrayLike<number>): void {
    out.p1Enc(opcode);
    out.p1(genderMale ? 0 : 1);
    for (let i = 0; i < 7; i++) {
        out.p1(kits[i] ?? 0);
    }
    for (let i = 0; i < 5; i++) {
        out.p1(colours[i] ?? 0);
    }
}

export function writeChatSetMode(out: Packet, opcode: number, publicMode: number, privateMode: number, tradeMode: number): void {
    out.p1Enc(opcode);
    out.p1(publicMode);
    out.p1(privateMode);
    out.p1(tradeMode);
}

export function writeMessagePrivate(out: Packet, opcode: number, userhash: bigint, pack: (out: Packet) => void): void {
    out.p1Enc(opcode);
    out.p1(0);
    const start = out.pos;
    out.p8(userhash);
    pack(out);
    out.psize1(out.pos - start);
}

/** `typed` includes the leading `::`. Java Client.java:4972. */
export function writeClientCheat(out: Packet, opcode: number, typed: string): void {
    out.p1Enc(opcode);
    out.p1(typed.length - 1);
    out.pjstr(typed.substring(2));
}

/**
 * Java colour/effect bytes are p1_alt2 / p1_alt1 (Client.java:5041-5042).
 * `pack` writes the wordpack into `out` (equivalent to Java's side buffer + pdata).
 */
export function writeMessagePublic(out: Packet, opcode: number, colour: number, effect: number, pack: (out: Packet) => void): void {
    out.p1Enc(opcode);
    out.p1(0);
    const start = out.pos;
    out.p1_alt2(colour);
    out.p1_alt1(effect);
    pack(out);
    out.psize1(out.pos - start);
}

/**
 * Java Client.java:4976-5034. Case-insensitive else-if. `wave2:` is checked before `wave:`
 * so the longer prefix is not shadowed. Remainder case is preserved (substring of the original).
 */
export function parsePublicChat(text: string): { colour: number; effect: number; rest: string } {
    const colourLower = text.toLowerCase();
    let colour = 0;
    let rest = text;
    if (colourLower.startsWith('yellow:')) {
        colour = 0;
        rest = text.substring(7);
    } else if (colourLower.startsWith('red:')) {
        colour = 1;
        rest = text.substring(4);
    } else if (colourLower.startsWith('green:')) {
        colour = 2;
        rest = text.substring(6);
    } else if (colourLower.startsWith('cyan:')) {
        colour = 3;
        rest = text.substring(5);
    } else if (colourLower.startsWith('purple:')) {
        colour = 4;
        rest = text.substring(7);
    } else if (colourLower.startsWith('white:')) {
        colour = 5;
        rest = text.substring(6);
    } else if (colourLower.startsWith('flash1:')) {
        colour = 6;
        rest = text.substring(7);
    } else if (colourLower.startsWith('flash2:')) {
        colour = 7;
        rest = text.substring(7);
    } else if (colourLower.startsWith('flash3:')) {
        colour = 8;
        rest = text.substring(7);
    } else if (colourLower.startsWith('glow1:')) {
        colour = 9;
        rest = text.substring(6);
    } else if (colourLower.startsWith('glow2:')) {
        colour = 10;
        rest = text.substring(6);
    } else if (colourLower.startsWith('glow3:')) {
        colour = 11;
        rest = text.substring(6);
    }

    const effectLower = rest.toLowerCase();
    let effect = 0;
    if (effectLower.startsWith('wave2:')) {
        effect = 2;
        rest = rest.substring(6);
    } else if (effectLower.startsWith('wave:')) {
        effect = 1;
        rest = rest.substring(5);
    } else if (effectLower.startsWith('shake:')) {
        effect = 3;
        rest = rest.substring(6);
    } else if (effectLower.startsWith('scroll:')) {
        effect = 4;
        rest = rest.substring(7);
    } else if (effectLower.startsWith('slide:')) {
        effect = 5;
        rest = rest.substring(6);
    }
    return { colour, effect, rest };
}
