import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import IfType from '#/client/config/IfType.js';
import ClientNpc from '#/client/dash3d/ClientNpc.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import {
    OUTBOUND_CENSUS,
    writeAnticheatCycleLogic1,
    writeAnticheatCycleLogic2,
    writeAnticheatCycleLogic3,
    writeAnticheatCycleLogic4,
    writeAnticheatCycleLogic5,
    writeAnticheatCycleLogic6,
    writeAnticheatOpLogic1,
    writeAnticheatOpLogic2,
    writeAnticheatOpLogic3,
    writeAnticheatOpLogic4,
    writeAnticheatOpLogic5,
    writeChatSetMode,
    writeClientCheat,
    writeCloseModal,
    writeEventAppletFocus,
    writeEventCameraPosition,
    writeEventMouseClick,
    writeEventMouseMove,
    writeEventSynthError,
    writeFriendListAdd,
    writeFriendListDel,
    writeHeldOp,
    writeHeldT,
    writeHeldU,
    writeIdkSaveDesign,
    writeIdleTimer,
    writeIfButton,
    writeIgnoreListAdd,
    writeIgnoreListDel,
    writeInvButton,
    writeInvButtonD,
    writeLocOp,
    writeLocT,
    writeLocU,
    writeMapBuildComplete,
    writeMessagePrivate,
    writeMessagePublic,
    writeMinimapClickExtra,
    writeMoveClick,
    writeNoTimeout,
    writeNpcOp,
    writeNpcT,
    writeNpcU,
    writeObjOp,
    writeObjT,
    writeObjU,
    writePlayerOp,
    writePlayerT,
    writePlayerU,
    writeResumePCountDialog,
    writeResumePNameDialog,
    writeResumePauseButton,
    writeSendSnapshot,
    writeTutClickSide
} from '#/client/io/gameOutbound.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import Packet from '#/client/io/Packet.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { installCanvasMock } from './replay/runtime.js';

// Why: independent Java byte vectors for 79 of the 80 outbound descriptors (EVENT_HAS_WINDOW is not sent, Client.java:3655); the writers and the production doAction must reproduce each frame.

const BASE = 3200;
const A = 0x3456;
const B = 18;
const C = 52;
const X = BASE + B;
const Z = BASE + C;
const SLOT = 3931;
const PLACED = 1519;
const LOC_TYPECODE = (PLACED << 14) | 0x0111;
const TARGET = 0x4567;
const USESLOT = 0x1357;
const USEOBJ = 0x2468;
const USECOM = 0x3579;
const STEPS = [
    { dx: 2, dz: 0 },
    { dx: 2, dz: 1 }
];

interface Vector {
    name: string;
    javaLine: number;
    hex: string;
    write: (out: Packet) => void;
    act?: { action: number; a: number };
}

const VECTORS: Vector[] = [
    { name: 'OPOBJ1', javaLine: 10042, hex: '4d0c120cb4d634', write: out => writeObjOp(out, ClientProt.OPOBJ1, 1, X, Z, A), act: { action: MiniMenuAction.OP_OBJ1, a: A } },
    { name: 'OPOBJ2', javaLine: 10350, hex: '640c920c34d634', write: out => writeObjOp(out, ClientProt.OPOBJ2, 2, X, Z, A), act: { action: MiniMenuAction.OP_OBJ2, a: A } },
    { name: 'OPOBJ3', javaLine: 10066, hex: '47d634120c0c34', write: out => writeObjOp(out, ClientProt.OPOBJ3, 3, X, Z, A), act: { action: MiniMenuAction.OP_OBJ3, a: A } },
    { name: 'OPOBJ4', javaLine: 9852, hex: '3634d6b40c0c92', write: out => writeObjOp(out, ClientProt.OPOBJ4, 4, X, Z, A), act: { action: MiniMenuAction.OP_OBJ4, a: A } },
    { name: 'OPOBJ5', javaLine: 10276, hex: 'e656340c120cb4', write: out => writeObjOp(out, ClientProt.OPOBJ5, 5, X, Z, A), act: { action: MiniMenuAction.OP_OBJ5, a: A } },
    { name: 'OPOBJT', javaLine: 10471, hex: '5356340cb46745120c', write: out => writeObjT(out, ClientProt.OPOBJT, A, Z, TARGET, X), act: { action: MiniMenuAction.TGT_OBJ, a: A } },
    { name: 'OPOBJU', javaLine: 10307, hex: 'd3d71324e8340c120c79355634', write: out => writeObjU(out, ClientProt.OPOBJU, USESLOT, USEOBJ, Z, X, USECOM, A), act: { action: MiniMenuAction.USEHELD_ONOBJ, a: A } },
    { name: 'OPNPC1', javaLine: 10457, hex: '705b0f', write: out => writeNpcOp(out, ClientProt.OPNPC1, 1, SLOT), act: { action: MiniMenuAction.OP_NPC1, a: SLOT } },
    { name: 'OPNPC2', javaLine: 9742, hex: '430fdb', write: out => writeNpcOp(out, ClientProt.OPNPC2, 2, SLOT), act: { action: MiniMenuAction.OP_NPC2, a: SLOT } },
    { name: 'OPNPC3', javaLine: 9976, hex: '0ddb0f', write: out => writeNpcOp(out, ClientProt.OPNPC3, 3, SLOT), act: { action: MiniMenuAction.OP_NPC3, a: SLOT } },
    { name: 'OPNPC4', javaLine: 9806, hex: '2a5b0f', write: out => writeNpcOp(out, ClientProt.OPNPC4, 4, SLOT), act: { action: MiniMenuAction.OP_NPC4, a: SLOT } },
    { name: 'OPNPC5', javaLine: 9997, hex: '085b0f', write: out => writeNpcOp(out, ClientProt.OPNPC5, 5, SLOT), act: { action: MiniMenuAction.OP_NPC5, a: SLOT } },
    { name: 'OPNPCT', javaLine: 10027, hex: '6845e75b0f', write: out => writeNpcT(out, ClientProt.OPNPCT, TARGET, SLOT), act: { action: MiniMenuAction.TGT_NPC, a: SLOT } },
    { name: 'OPNPCU', javaLine: 9883, hex: '390f5b6824f9351357', write: out => writeNpcU(out, ClientProt.OPNPCU, SLOT, USEOBJ, USECOM, USESLOT), act: { action: MiniMenuAction.USEHELD_ONNPC, a: SLOT } },
    { name: 'OPLOC1', javaLine: 10186, hex: 'b50c12b40cef05', write: out => writeLocOp(out, ClientProt.OPLOC1, 1, X, Z, PLACED), act: { action: MiniMenuAction.OP_LOC1, a: LOC_TYPECODE } },
    { name: 'OPLOC2', javaLine: 10389, hex: 'f105ef0c920c34', write: out => writeLocOp(out, ClientProt.OPLOC2, 2, X, Z, PLACED), act: { action: MiniMenuAction.OP_LOC2, a: LOC_TYPECODE } },
    { name: 'OPLOC3', javaLine: 10194, hex: '320c34ef05120c', write: out => writeLocOp(out, ClientProt.OPLOC3, 3, X, Z, PLACED), act: { action: MiniMenuAction.OP_LOC3, a: LOC_TYPECODE } },
    { name: 'OPLOC4', javaLine: 10261, hex: '880c92b40c05ef', write: out => writeLocOp(out, ClientProt.OPLOC4, 4, X, Z, PLACED), act: { action: MiniMenuAction.OP_LOC4, a: LOC_TYPECODE } },
    { name: 'OPLOC5', javaLine: 10178, hex: '37ef05b40c0c92', write: out => writeLocOp(out, ClientProt.OPLOC5, 5, X, Z, PLACED), act: { action: MiniMenuAction.OP_LOC5, a: LOC_TYPECODE } },
    { name: 'OPLOCT', javaLine: 9982, hex: 'd24567ef050c12b40c', write: out => writeLocT(out, ClientProt.OPLOCT, TARGET, PLACED, X, Z), act: { action: MiniMenuAction.TGT_LOC, a: LOC_TYPECODE } },
    { name: 'OPLOCU', javaLine: 9772, hex: '98ef0579356824b40c1357120c', write: out => writeLocU(out, ClientProt.OPLOCU, PLACED, USECOM, USEOBJ, Z, USESLOT, X), act: { action: MiniMenuAction.USEHELD_ONLOC, a: LOC_TYPECODE } },
    { name: 'OPPLAYER1', javaLine: 9692, hex: 'f5db0f', write: out => writePlayerOp(out, ClientProt.OPPLAYER1, 1, SLOT), act: { action: MiniMenuAction.OP_PLAYER1, a: SLOT } },
    { name: 'OPPLAYER2', javaLine: 9911, hex: 'e90fdb', write: out => writePlayerOp(out, ClientProt.OPPLAYER2, 2, SLOT), act: { action: MiniMenuAction.OP_PLAYER2, a: SLOT } },
    { name: 'OPPLAYER3', javaLine: 10511, hex: 'c25b0f', write: out => writePlayerOp(out, ClientProt.OPPLAYER3, 3, SLOT), act: { action: MiniMenuAction.OP_PLAYER3, a: SLOT } },
    { name: 'OPPLAYER4', javaLine: 9819, hex: '745b0f', write: out => writePlayerOp(out, ClientProt.OPPLAYER4, 4, SLOT), act: { action: MiniMenuAction.OP_PLAYER4, a: SLOT } },
    { name: 'OPPLAYER5', javaLine: 9729, hex: '2d0fdb', write: out => writePlayerOp(out, ClientProt.OPPLAYER5, 5, SLOT), act: { action: MiniMenuAction.OP_PLAYER5, a: SLOT } },
    { name: 'OPPLAYERT', javaLine: 10013, hex: '1f0f5b6745', write: out => writePlayerT(out, ClientProt.OPPLAYERT, SLOT, TARGET), act: { action: MiniMenuAction.TGT_PLAYER, a: SLOT } },
    { name: 'OPPLAYERU', javaLine: 10290, hex: '8f6824d71335790fdb', write: out => writePlayerU(out, ClientProt.OPPLAYERU, USEOBJ, USESLOT, USECOM, SLOT), act: { action: MiniMenuAction.USEHELD_ONPLAYER, a: SLOT } },
    { name: 'OPHELD1', javaLine: 9755, hex: 'cb00b412005634', write: out => writeHeldOp(out, ClientProt.OPHELD1, 1, A, B, C), act: { action: MiniMenuAction.OP_HELD1, a: A } },
    { name: 'OPHELD2', javaLine: 9859, hex: '18340056340092', write: out => writeHeldOp(out, ClientProt.OPHELD2, 2, A, B, C), act: { action: MiniMenuAction.OP_HELD2, a: A } },
    { name: 'OPHELD3', javaLine: 10201, hex: 'a19200d6343400', write: out => writeHeldOp(out, ClientProt.OPHELD3, 3, A, B, C), act: { action: MiniMenuAction.OP_HELD3, a: A } },
    { name: 'OPHELD4', javaLine: 9705, hex: 'e4120034d60034', write: out => writeHeldOp(out, ClientProt.OPHELD4, 4, A, B, C), act: { action: MiniMenuAction.OP_HELD4, a: A } },
    { name: 'OPHELD5', javaLine: 10143, hex: '041200d634b400', write: out => writeHeldOp(out, ClientProt.OPHELD5, 5, A, B, C), act: { action: MiniMenuAction.OP_HELD5, a: A } },
    { name: 'OPHELDT', javaLine: 9944, hex: '24456700b4009234d6', write: out => writeHeldT(out, ClientProt.OPHELDT, TARGET, C, B, A), act: { action: MiniMenuAction.TGT_HELD, a: A } },
    { name: 'OPHELDU', javaLine: 9924, hex: '01345657136824f935009200b4', write: out => writeHeldU(out, ClientProt.OPHELDU, A, USESLOT, USEOBJ, USECOM, B, C), act: { action: MiniMenuAction.USEHELD_ONHELD, a: A } },
    { name: 'INV_BUTTON1', javaLine: 9782, hex: '0334d600340012', write: out => writeInvButton(out, ClientProt.INV_BUTTON1, 1, A, B, C), act: { action: MiniMenuAction.INV_BUTTON1, a: A } },
    { name: 'INV_BUTTON2', javaLine: 10103, hex: 'b1009256343400', write: out => writeInvButton(out, ClientProt.INV_BUTTON2, 2, A, B, C), act: { action: MiniMenuAction.INV_BUTTON2, a: A } },
    { name: 'INV_BUTTON3', javaLine: 10357, hex: '5b563492000034', write: out => writeInvButton(out, ClientProt.INV_BUTTON3, 3, A, B, C), act: { action: MiniMenuAction.INV_BUTTON3, a: A } },
    { name: 'INV_BUTTON4', javaLine: 10396, hex: 'e7b40012003456', write: out => writeInvButton(out, ClientProt.INV_BUTTON4, 4, A, B, C), act: { action: MiniMenuAction.INV_BUTTON4, a: A } },
    { name: 'INV_BUTTON5', javaLine: 10160, hex: '9e9200d6343400', write: out => writeInvButton(out, ClientProt.INV_BUTTON5, 5, A, B, C), act: { action: MiniMenuAction.INV_BUTTON5, a: A } },
    { name: 'NO_TIMEOUT', javaLine: 3409, hex: '28', write: out => writeNoTimeout(out, ClientProt.NO_TIMEOUT) },
    { name: 'IDLE_TIMER', javaLine: 3344, hex: 'ca', write: out => writeIdleTimer(out, ClientProt.IDLE_TIMER) },
    { name: 'MAP_BUILD_COMPLETE', javaLine: 3500, hex: '06', write: out => writeMapBuildComplete(out, ClientProt.MAP_BUILD_COMPLETE) },
    { name: 'CLOSE_MODAL', javaLine: 4569, hex: '6e', write: out => writeCloseModal(out, ClientProt.CLOSE_MODAL) },
    { name: 'ANTICHEAT_CYCLELOGIC2', javaLine: 5746, hex: 'a8', write: out => writeAnticheatCycleLogic2(out, ClientProt.ANTICHEAT_CYCLELOGIC2) },
    { name: 'ANTICHEAT_CYCLELOGIC5', javaLine: 6170, hex: 'f8', write: out => writeAnticheatCycleLogic5(out, ClientProt.ANTICHEAT_CYCLELOGIC5) },
    { name: 'ANTICHEAT_OPLOGIC1', javaLine: 10345, hex: '5f00000000', write: out => writeAnticheatOpLogic1(out, ClientProt.ANTICHEAT_OPLOGIC1) },
    { name: 'ANTICHEAT_OPLOGIC2', javaLine: 9700, hex: 'a5ce', write: out => writeAnticheatOpLogic2(out, ClientProt.ANTICHEAT_OPLOGIC2) },
    { name: 'ANTICHEAT_OPLOGIC3', javaLine: 9971, hex: '9d00000000', write: out => writeAnticheatOpLogic3(out, ClientProt.ANTICHEAT_OPLOGIC3) },
    { name: 'ANTICHEAT_OPLOGIC4', javaLine: 10061, hex: 'deabc842', write: out => writeAnticheatOpLogic4(out, ClientProt.ANTICHEAT_OPLOGIC4) },
    { name: 'ANTICHEAT_OPLOGIC5', javaLine: 9750, hex: '7e7d', write: out => writeAnticheatOpLogic5(out, ClientProt.ANTICHEAT_OPLOGIC5) },
    { name: 'ANTICHEAT_CYCLELOGIC3', javaLine: 6696, hex: 'c500000000', write: out => writeAnticheatCycleLogic3(out, ClientProt.ANTICHEAT_CYCLELOGIC3) },
    { name: 'ANTICHEAT_CYCLELOGIC4', javaLine: 3748, hex: 'ad288b80', write: out => writeAnticheatCycleLogic4(out, ClientProt.ANTICHEAT_CYCLELOGIC4) },
    { name: 'ANTICHEAT_CYCLELOGIC6', javaLine: 4561, hex: '1695a0', write: out => writeAnticheatCycleLogic6(out, ClientProt.ANTICHEAT_CYCLELOGIC6) },
    { name: 'EVENT_MOUSE_CLICK', javaLine: 3123, hex: '131f2e3d4c', write: out => writeEventMouseClick(out, ClientProt.EVENT_MOUSE_CLICK, 0x1f2e3d4c) },
    { name: 'EVENT_APPLET_FOCUS (focus)', javaLine: 3149, hex: 'bb01', write: out => writeEventAppletFocus(out, ClientProt.EVENT_APPLET_FOCUS, 1) },
    { name: 'EVENT_APPLET_FOCUS (blur)', javaLine: 3157, hex: 'bb00', write: out => writeEventAppletFocus(out, ClientProt.EVENT_APPLET_FOCUS, 0) },
    { name: 'EVENT_CAMERA_POSITION', javaLine: 3140, hex: '8c23015604', write: out => writeEventCameraPosition(out, ClientProt.EVENT_CAMERA_POSITION, 0x0123, 0x0456) },
    { name: 'EVENT_SYNTH_ERROR', javaLine: 3844, hex: '501234', write: out => writeEventSynthError(out, ClientProt.EVENT_SYNTH_ERROR, 0x1234) },
    { name: 'EVENT_MOUSE_MOVE', javaLine: 3040, hex: 'ab021234', write: out => writeEventMouseMove(out, ClientProt.EVENT_MOUSE_MOVE, samples => samples.p2(0x1234)) },
    { name: 'ANTICHEAT_CYCLELOGIC1 (extra word)', javaLine: 6232, hex: 'f40fdb93713daaec123456c7e33dc06178', write: out => writeAnticheatCycleLogic1(out, ClientProt.ANTICHEAT_CYCLELOGIC1, { word: 0x1234, byte1: 0x56, extra: true, byte2: 0x78 }) },
    { name: 'ANTICHEAT_CYCLELOGIC1 (no extra word)', javaLine: 6232, hex: 'f40ddb93713daaec123456c7e36178', write: out => writeAnticheatCycleLogic1(out, ClientProt.ANTICHEAT_CYCLELOGIC1, { word: 0x1234, byte1: 0x56, extra: false, byte2: 0x78 }) },
    { name: 'MOVE_GAMECLICK', javaLine: 7184, hex: '1c09120c01340c0280027f', write: out => writeMoveClick(out, ClientProt.MOVE_GAMECLICK, X, 1, Z, STEPS) },
    { name: 'MOVE_OPCLICK', javaLine: 7194, hex: 'f709120c01340c0280027f', write: out => writeMoveClick(out, ClientProt.MOVE_OPCLICK, X, 1, Z, STEPS) },
    { name: 'MOVE_MINIMAPCLICK', javaLine: 7189, hex: 'd517120c01340c0280027f31320123394455590a0b0c0d663f', write: out => {
        writeMoveClick(out, ClientProt.MOVE_MINIMAPCLICK, X, 1, Z, STEPS, 14);
        writeMinimapClickExtra(out, 0x31, 0x32, 0x0123, 0x44, 0x55, 0x0A0B, 0x0C0D, 0x66);
    } },
    { name: 'MESSAGE_PRIVATE', javaLine: 4841, hex: 'e30a01020304050607087172', write: out => writeMessagePrivate(out, ClientProt.MESSAGE_PRIVATE, 0x0102030405060708n, packed => { packed.p1(0x71); packed.p1(0x72); }) },
    { name: 'MESSAGE_PUBLIC', javaLine: 5037, hex: '3104f9837172', write: out => writeMessagePublic(out, ClientProt.MESSAGE_PUBLIC, 7, 3, packed => { packed.p1(0x71); packed.p1(0x72); }) },
    { name: 'CLIENT_CHEAT', javaLine: 4972, hex: '380968692074686572650a', write: out => writeClientCheat(out, ClientProt.CLIENT_CHEAT, '::hi there') },
    { name: 'IF_BUTTON', javaLine: 9892, hex: '4f4c5d', write: out => writeIfButton(out, ClientProt.IF_BUTTON, 0x4c5d) },
    { name: 'RESUME_PAUSEBUTTON', javaLine: 10254, hex: 'e24c5d', write: out => writeResumePauseButton(out, ClientProt.RESUME_PAUSEBUTTON, 0x4c5d) },
    { name: 'RESUME_P_COUNTDIALOG', javaLine: 4896, hex: '4b01020304', write: out => writeResumePCountDialog(out, ClientProt.RESUME_P_COUNTDIALOG, 0x01020304) },
    { name: 'RESUME_P_NAMEDIALOG', javaLine: 4917, hex: 'ce0102030405060708', write: out => writeResumePNameDialog(out, ClientProt.RESUME_P_NAMEDIALOG, 0x0102030405060708n) },
    { name: 'TUT_CLICKSIDE', javaLine: 5841, hex: '7709', write: out => writeTutClickSide(out, ClientProt.TUT_CLICKSIDE, 9) },
    { name: 'SEND_SNAPSHOT', javaLine: 12049, hex: 'b801020304050607080501', write: out => writeSendSnapshot(out, ClientProt.SEND_SNAPSHOT, 0x0102030405060708n, 5, 1) },
    { name: 'IGNORELIST_ADD', javaLine: 12514, hex: 'd90102030405060708', write: out => writeIgnoreListAdd(out, ClientProt.IGNORELIST_ADD, 0x0102030405060708n) },
    { name: 'IGNORELIST_DEL', javaLine: 12531, hex: 'a00102030405060708', write: out => writeIgnoreListDel(out, ClientProt.IGNORELIST_DEL, 0x0102030405060708n) },
    { name: 'FRIENDLIST_ADD', javaLine: 12461, hex: '780102030405060708', write: out => writeFriendListAdd(out, ClientProt.FRIENDLIST_ADD, 0x0102030405060708n) },
    { name: 'FRIENDLIST_DEL', javaLine: 12482, hex: '8d0102030405060708', write: out => writeFriendListDel(out, ClientProt.FRIENDLIST_DEL, 0x0102030405060708n) },
    { name: 'IDK_SAVEDESIGN (male)', javaLine: 12032, hex: 'a3000102030405060708090a0b0c', write: out => writeIdkSaveDesign(out, ClientProt.IDK_SAVEDESIGN, true, [1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12]) },
    { name: 'IDK_SAVEDESIGN (female)', javaLine: 12032, hex: 'a3010102030405060708090a0b0c', write: out => writeIdkSaveDesign(out, ClientProt.IDK_SAVEDESIGN, false, [1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12]) },
    { name: 'CHAT_SETMODE', javaLine: 4522, hex: 'b0010203', write: out => writeChatSetMode(out, ClientProt.CHAT_SETMODE, 1, 2, 3) },
    { name: 'INV_BUTTOND', javaLine: 3257, hex: '7b9b0a814cdd5713', write: out => writeInvButtonD(out, ClientProt.INV_BUTTOND, 0x0a1b, 1, 0x4c5d, 0x1357) }
];

const fixture = JSON.parse(readFileSync('test/io/fixtures/prot377/engine-prot.json', 'utf8')) as {
    client: { name: string; id: number; length: number }[];
};

function frame(write: (out: Packet) => void): string {
    const out = new Packet(new Uint8Array(256));
    write(out);
    return Buffer.from(out.data.subarray(0, out.pos)).toString('hex');
}

describe('outbound byte vectors: every emitted descriptor', () => {
    test('the vector table covers every census descriptor but the platform-absent one', () => {
        const covered = new Set(VECTORS.map(row => row.name.split(' ')[0]));
        for (const spec of OUTBOUND_CENSUS) {
            expect(covered.has(spec.name)).toBe(spec.disposition === 'emitted');
        }
        expect(covered.size).toBe(79);
    });

    test('each frame starts with the engine opcode of its descriptor', () => {
        const ids = new Map(fixture.client.map(row => [row.name, row.id]));
        for (const row of VECTORS) {
            expect(Number.parseInt(row.hex.slice(0, 2), 16)).toBe(ids.get(row.name.split(' ')[0]!)!);
        }
    });

    test.each(VECTORS.map(row => [row.name, row] as const))('%s writer reproduces the Java frame', (_name, row) => {
        expect(frame(row.write)).toBe(row.hex);
    });
});

interface Probe {
    out: Packet;
    collision: (CollisionMap | null)[];
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    keyHeld: number[];
    localPlayer: ClientPlayer | null;
    npc: (ClientNpc | null)[];
    players: (ClientPlayer | null)[];
    menuAction: Int32Array;
    menuParamA: Int32Array;
    menuParamB: Int32Array;
    menuParamC: Int32Array;
    objSelectedSlot: number;
    objComId: number;
    objSelectedComId: number;
    targetComId: number;
    world: { typeCode2(level: number, x: number, z: number, typecode: number): number } | null;
    doAction(optionId: number): void;
}

describe('outbound byte vectors: menu actions through the production doAction', () => {
    const acted = VECTORS.filter(row => row.act !== undefined);

    test('the menu rows cover every OP, target and use writer', () => {
        expect(acted.map(row => row.name)).toHaveLength(40);
    });

    test.each(acted.map(row => [row.name, row] as const))('%s', async (_name, row) => {
        const restoreCanvas = await installCanvasMock();
        const { Client } = await import('#/client/shell/Client.js');
        const savedList = IfType.list;
        try {
            const probe = new Client(undefined as never, undefined as never, undefined as never) as unknown as Probe;
            probe.collision[0] = new CollisionMap();
            probe.collision[0]!.flags.fill(0);
            probe.mapBuildBaseX = BASE;
            probe.mapBuildBaseZ = BASE;
            probe.keyHeld[5] = 1;
            probe.out.pos = 0;
            probe.localPlayer = new ClientPlayer();
            probe.localPlayer.routeX[0] = 200;
            probe.localPlayer.routeZ[0] = 200;
            const npc = new ClientNpc();
            npc.routeX[0] = 200;
            npc.routeZ[0] = 200;
            probe.npc[SLOT] = npc;
            const player = new ClientPlayer();
            player.routeX[0] = 200;
            player.routeZ[0] = 200;
            probe.players[SLOT] = player;
            const com = new IfType();
            com.layerId = -1;
            IfType.list = [];
            IfType.list[C] = com;
            probe.objSelectedSlot = USESLOT;
            probe.objComId = USEOBJ;
            probe.objSelectedComId = USECOM;
            probe.targetComId = TARGET;
            // interactWithLoc needs a scene location; a wall placement (shape 0) is enough to take the walk-and-send path.
            probe.world = { typeCode2: (): number => 0 };

            probe.menuAction[0] = row.act!.action;
            probe.menuParamA[0] = row.act!.a;
            probe.menuParamB[0] = B;
            probe.menuParamC[0] = C;
            probe.doAction(0);

            const sentHex = Buffer.from(probe.out.data.subarray(0, probe.out.pos)).toString('hex');
            // Anticheat frames may precede the action frame; the action frame is the tail.
            expect(sentHex.endsWith(row.hex)).toBe(true);
        } finally {
            IfType.list = savedList;
            restoreCanvas();
        }
    });
});
