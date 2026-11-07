import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import { actions, attach, detach } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import ClientNpc from '#/client/dash3d/ClientNpc.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import Packet from '#/client/io/Packet.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import { OUTBOUND_CENSUS } from '#/client/io/gameOutbound.js';
import { ClientCode } from '#/client/shell/ClientCode.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import WordPack from '#/client/wordfilter/WordPack.js';
import { installCanvasMock } from './replay/runtime.js';

const fixture = JSON.parse(readFileSync('test/io/fixtures/prot377/engine-prot.json', 'utf8')) as {
    client: { name: string; id: number; length: number }[];
};

/** Methods the production client calls. Private is erased at runtime. */
interface Reach {
    tryMove(srcX: number, srcZ: number, dx: number, dz: number, tryNearest: boolean, locWidth: number, locLength: number, locAngle: number, locShape: number, forceapproach: number, type: number): boolean;
    doAction(optionId: number): void;
    chatModeLoop(): void;
    handleInputKey(): Promise<void>;
    soundsDoQueue(): Promise<void>;
    gameLoop(): Promise<void>;
    checkScene(): number;
    roofCheck(): number;
    addProjectiles(): void;
    requestLogout(): void;
    clientButton(com: IfType): boolean;
    addFriend(userhash: bigint): void;
    delFriend(userhash: bigint): void;
    addIgnore(userhash: bigint): void;
    delIgnore(userhash: bigint): void;
    out: Packet;
    collision: (CollisionMap | null)[];
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    keyHeld: number[];
    menuAction: Int32Array;
    menuParamA: Int32Array;
    menuParamB: Int32Array;
    menuParamC: Int32Array;
    npc: (ClientNpc | null)[];
    localPlayer: ClientPlayer | null;
    ingame: boolean;
    mouseClickButton: number;
    mouseClickX: number;
    mouseClickY: number;
    mouseClickTime: number;
    prevMouseClickTime: number;
    mouseTracked: boolean;
    mouseTrackedX: number;
    mouseTrackedY: number;
    mouseTracking: { length: number; x: number[]; y: number[] };
    chatInput: string;
    chatModalId: number;
    dialogInputOpen: boolean;
    dialogInput: string;
    socialInputOpen: boolean;
    keyQueue: number[];
    keyQueueReadPos: number;
    keyQueueWritePos: number;
    idleTimer: number;
    noTimeoutTimer: number;
    timeoutTimer: number;
    cyclelogic1: number;
    camPitch: number;
    waveCount: number;
    waveIds: Int32Array;
    waveLoops: Int32Array;
    waveDelay: Int32Array;
    lastWaveId: number;
    lastWaveLoops: number;
    tryMoveNearest: number;
    idkDesignGender: boolean;
    idkDesignPart: Int32Array;
    idkDesignColour: Int32Array;
    reportAbuseInput: string;
    reportAbuseMuteOption: boolean;
    friendCount: number;
    ignoreCount: number;
    awaitingPlayerInfo: boolean;
    mapBuildIndex: Int32Array | null;
    mapBuildGroundData: (Uint8Array | null)[] | null;
    mapBuildLocationData: (Uint8Array | null)[] | null;
    mapl: Uint8Array[][] | null;
    groundh: Int32Array[][] | null;
    resumedPauseButton: boolean;
    chatPublicMode: number;
    chatPrivateMode: number;
    chatTradeMode: number;
}

async function client(): Promise<{ probe: Reach; restore: () => void }> {
    const restore = await installCanvasMock();
    // Canvas.js binds at import time, so Client cannot be a static import: the mock has to land first.
    const { Client } = await import('#/client/shell/Client.js');
    const created = new Client(undefined as never, undefined as never, undefined as never) as unknown as Reach;
    created.collision[0] = new CollisionMap();
    // A fresh 377 map marks every interior tile UNLOADED (Java 377 CollisionMap.reset); these cases need loaded, open tiles.
    created.collision[0]!.flags.fill(0);
    created.mapBuildBaseX = 3200;
    created.mapBuildBaseZ = 3200;
    created.keyHeld[5] = 1;
    created.out.pos = 0;
    created.localPlayer = new ClientPlayer();
    created.localPlayer.name = 'Elliott';
    return { probe: created, restore };
}

function sent(out: Packet): number[] {
    return [...out.data.subarray(0, out.pos)];
}

function payload(out: Packet): number[] {
    return sent(out).slice(1);
}

function frames(): { name: string; raw: number[] }[] {
    const byId = new Map(fixture.client.map(row => [row.id, row.name]));
    const rows: { name: string; raw: number[] }[] = [];
    for (const file of ['tutorial', 'instance', 'mainland']) {
        for (const line of readFileSync(`test/io/recordings/377/${file}.jsonl`, 'utf8').split('\n')) {
            if (!line) continue;
            const record = JSON.parse(line) as { type?: string; direction?: string; bytes?: string };
            if (record.type !== 'frame' || record.direction !== 'out' || !record.bytes) continue;
            const raw = [...Buffer.from(record.bytes, 'hex')];
            rows.push({ name: byId.get(raw[0]) ?? `UNK_${raw[0]}`, raw });
        }
    }
    return rows;
}

function recorded(name: string): number[] {
    const frame = frames().find(row => row.name === name);
    expect(frame).toBeDefined();
    return frame!.raw;
}

/** Java layout, independent of the production writers. */
function javaBytes(write: (out: Packet) => void): number[] {
    const out = new Packet(new Uint8Array(128));
    write(out);
    return sent(out);
}

function pushEnter(probe: Reach): void {
    probe.keyQueue[probe.keyQueueWritePos] = 13;
    probe.keyQueueWritePos = (probe.keyQueueWritePos + 1) & 0x7f;
}

describe('377 outbound census', () => {
    test('accounts for every engine client descriptor', () => {
        expect(OUTBOUND_CENSUS).toHaveLength(80);
        expect(fixture.client).toHaveLength(80);
        const byName = new Map(fixture.client.map(row => [row.name, row]));
        for (const row of OUTBOUND_CENSUS) {
            expect(byName.get(row.name)).toEqual({ name: row.name, id: row.id, length: row.length });
        }
    });

    test('does not send the dropped 289 anticheat opcodes', () => {
        const source = readFileSync('src/client/shell/Client.ts', 'utf8');
        for (const name of ['ANTICHEAT_OPLOGIC6', 'ANTICHEAT_OPLOGIC7', 'ANTICHEAT_OPLOGIC8', 'ANTICHEAT_OPLOGIC9', 'ANTICHEAT_CYCLELOGIC7']) {
            expect(source.includes(`ClientProt.${name}`)).toBe(false);
        }
    });

    test('does not export writers the browser never calls', () => {
        const source = readFileSync('src/client/io/gameOutbound.ts', 'utf8');
        expect(source.includes('export function writeEventHasWindow')).toBe(false);
        expect(source.includes('export function writeResumePNameDialog')).toBe(true);
        expect(source.includes('chatbackInputOpen')).toBe(true);
    });
});

describe('production tryMove', () => {
    test('writes p2_alt3 x, ctrl, p2_alt3 z', async () => {
        const { probe, restore } = await client();
        try {
            expect(probe.tryMove(10, 10, 12, 10, false, 0, 0, 0, 0, 0, 0)).toBe(true);
            const raw = sent(probe.out);
            expect(payload(probe.out)).toEqual(javaBytes(out => {
                out.p1(5);
                out.p2_alt3(3212);
                out.p1(1);
                out.p2_alt3(3210);
            }));
            expect(raw[2]).toBe((3212 + 128) & 0xff);
            expect(raw[3]).toBe(3212 >> 8);
            expect(raw[0]).toBe(ClientProt.MOVE_GAMECLICK & 0xff);
            expect(recorded('MOVE_GAMECLICK').length).toBeGreaterThan(5);

            probe.out.pos = 0;
            expect(probe.tryMove(10, 10, 12, 10, false, 0, 0, 0, 0, 0, 2)).toBe(true);
            expect(sent(probe.out)[0]).toBe(ClientProt.MOVE_OPCLICK & 0xff);
            expect(recorded('MOVE_OPCLICK').length).toBeGreaterThan(5);
        } finally {
            restore();
        }
    });

    test('writes p1_alt3 waypoint dz after a forced corner', async () => {
        const { probe, restore } = await client();
        try {
            probe.keyHeld[5] = 0;
            probe.collision[0]!.flags[CollisionMap.index(21, 20)] = CollisionFlag.SQ_BLOCKED;
            expect(probe.tryMove(20, 20, 22, 20, false, 0, 0, 0, 0, 0, 0)).toBe(true);
            // Locked from the production path: length 9, x=3220, ctrl 0, z=3219, steps (2,0) and (2,1).
            // p1_alt3(0) is 0x80 and p1_alt3(1) is 0x7f. p1 would write 0 and 1.
            expect(payload(probe.out)).toEqual([0x09, 0x14, 0x0c, 0x00, 0x13, 0x0c, 0x02, 0x80, 0x02, 0x7f]);
            expect(payload(probe.out)).toEqual(javaBytes(out => {
                out.p1(9);
                out.p2_alt3(3220);
                out.p1(0);
                out.p2_alt3(3219);
                out.p1(2);
                out.p1_alt3(0);
                out.p1(2);
                out.p1_alt3(1);
            }));
        } finally {
            restore();
        }
    });

    test('nearest search picks an open tile and refuses a source-only result', async () => {
        const { probe, restore } = await client();
        try {
            probe.keyHeld[5] = 0;
            // Block the dest and every approach bit so testLoc cannot arrive. The 1x1 box then uses the 10-tile search.
            probe.collision[0]!.flags[CollisionMap.index(22, 20)] = CollisionFlag.SQ_BLOCKED;
            expect(probe.tryMove(20, 20, 22, 20, true, 1, 1, 0, 0, 0xffff, 0)).toBe(true);
            expect(probe.tryMoveNearest).toBe(1);
            const body = new Packet(Uint8Array.from(payload(probe.out).slice(1)));
            expect(body.g2_alt3()).toBe(3221);
            expect(body.g1()).toBe(0);
            expect(body.g2_alt3()).toBe(3220);

            probe.out.pos = 0;
            const blocked = probe.collision[0]!;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    blocked.flags[CollisionMap.index(30 + dx, 30 + dz)] = CollisionFlag.SQ_BLOCKED;
                }
            }
            expect(probe.tryMove(30, 30, 31, 30, true, 0, 0, 0, 0, 0, 0)).toBe(false);
            expect(probe.out.pos).toBe(0);
        } finally {
            restore();
        }
    });
});

describe('production menu writers', () => {
    test('OPLOC1 uses Java field order and the placed id', async () => {
        const frame = recorded('OPLOC1');
        // Java p2_alt2 / p2_alt1, not plain g2. 0c11930cef05 is x=3217 z=3219 loc=1519.
        const expected = javaBytes(out => {
            out.p2_alt2(3217);
            out.p2_alt1(3219);
            out.p2_alt1(1519);
        });
        expect(frame.slice(1)).toEqual(expected);

        const { probe, restore } = await client();
        try {
            probe.mapBuildBaseX = 0;
            probe.mapBuildBaseZ = 0;
            probe.menuAction[0] = MiniMenuAction.OP_LOC1;
            probe.menuParamA[0] = (1519 << 14) | 0x11;
            probe.menuParamB[0] = 3217;
            probe.menuParamC[0] = 3219;
            probe.doAction(0);
            expect(payload(probe.out)).toEqual(expected);
            expect(payload(probe.out)).not.toEqual(javaBytes(out => {
                out.p2_alt2(3217);
                out.p2_alt1(3219);
                out.p2_alt1(1520);
            }));
        } finally {
            restore();
        }
    });

    test('OPNPC1, OPNPC4 and OPNPC5 write p2_alt1 through doAction', async () => {
        const { probe, restore } = await client();
        const { Client } = await import('#/client/shell/Client.js');
        const previous = Client.oplogic3;
        try {
            const npc = new ClientNpc();
            npc.routeX[0] = 200;
            npc.routeZ[0] = 200;
            probe.localPlayer!.routeX[0] = 200;
            probe.localPlayer!.routeZ[0] = 200;
            const cases: { action: number; op: 1 | 4 | 5; slot: number; recorded?: string }[] = [
                { action: MiniMenuAction.OP_NPC1, op: 1, slot: 4998, recorded: 'OPNPC1' },
                { action: MiniMenuAction.OP_NPC4, op: 4, slot: 3705 },
                { action: MiniMenuAction.OP_NPC5, op: 5, slot: 3263 }
            ];
            for (const row of cases) {
                probe.npc[row.slot] = npc;
                probe.out.pos = 0;
                probe.menuAction[0] = row.action;
                probe.menuParamA[0] = row.slot;
                probe.doAction(0);
                const expected = javaBytes(out => out.p2_alt1(row.slot));
                expect(sent(probe.out).slice(-2)).toEqual(expected);
                expect(expected).not.toEqual(javaBytes(out => out.p2(row.slot)));
            }
            expect(recorded('OPNPC1').slice(1)).toEqual(javaBytes(out => out.p2_alt1(4998)));
        } finally {
            Client.oplogic3 = previous;
            restore();
        }
    });

    test('OPNPC3 and OPLOGIC3 go through doAction', async () => {
        const { probe, restore } = await client();
        const { Client } = await import('#/client/shell/Client.js');
        const previous = Client.oplogic3;
        try {
            const slot = 5050;
            const npc = new ClientNpc();
            npc.routeX[0] = 200;
            npc.routeZ[0] = 200;
            probe.npc[slot] = npc;
            probe.localPlayer!.routeX[0] = 200;
            probe.localPlayer!.routeZ[0] = 200;
            Client.oplogic3 = 143;
            probe.menuAction[0] = MiniMenuAction.OP_NPC3;
            probe.menuParamA[0] = slot;
            probe.doAction(0);
            const bytes = sent(probe.out);
            const logic = javaBytes(out => out.p4(0));
            const npcBytes = javaBytes(out => out.p2_alt3(slot));
            expect(bytes.slice(-7, -3)).toEqual(logic);
            expect(bytes.slice(-2)).toEqual(npcBytes);
            expect(recorded('ANTICHEAT_OPLOGIC3').slice(1)).toEqual(logic);
            expect(recorded('OPNPC3').slice(1)).toEqual(npcBytes);
        } finally {
            Client.oplogic3 = previous;
            restore();
        }
    });

    test('OPHELD2 writes p2_alt1 com through doAction', async () => {
        const { probe, restore } = await client();
        const previous = IfType.list;
        try {
            const com = new IfType();
            com.layerId = -1;
            IfType.list = [];
            IfType.list[5382] = com;
            probe.menuAction[0] = MiniMenuAction.OP_HELD2;
            probe.menuParamA[0] = 995;
            probe.menuParamB[0] = 3;
            probe.menuParamC[0] = 5382;
            probe.doAction(0);
            expect(payload(probe.out)).toEqual(javaBytes(out => {
                out.p2_alt1(5382);
                out.p2_alt1(995);
                out.p2_alt2(3);
            }));
        } finally {
            IfType.list = previous;
            restore();
        }
    });

    test('INV_BUTTON5 matches the recorded Java payload', async () => {
        const { probe, restore } = await client();
        const previous = IfType.list;
        try {
            const com = new IfType();
            com.layerId = -1;
            IfType.list = [];
            IfType.list[5382] = com;
            probe.menuAction[0] = MiniMenuAction.INV_BUTTON5;
            probe.menuParamA[0] = 995;
            probe.menuParamB[0] = 1;
            probe.menuParamC[0] = 5382;
            probe.doAction(0);
            const expected = javaBytes(out => {
                out.p2_alt3(1);
                out.p2_alt3(995);
                out.p2_alt1(5382);
            });
            expect(payload(probe.out)).toEqual(expected);
            expect(recorded('INV_BUTTON5').slice(1)).toEqual(expected);
        } finally {
            IfType.list = previous;
            restore();
        }
    });

    test('IF_BUTTON, RESUME_PAUSEBUTTON and CLOSE_MODAL go through doAction', async () => {
        const { probe, restore } = await client();
        const previous = IfType.list;
        try {
            IfType.list = [];
            const button = new IfType();
            button.layerId = -1;
            button.clientCode = 0;
            IfType.list[3651] = button;
            probe.menuAction[0] = MiniMenuAction.IF_BUTTON;
            probe.menuParamC[0] = 3651;
            probe.doAction(0);
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p2(3651)));
            expect(recorded('IF_BUTTON').slice(1)).toEqual(javaBytes(out => out.p2(3651)));

            probe.out.pos = 0;
            probe.resumedPauseButton = false;
            probe.menuAction[0] = MiniMenuAction.PAUSE_BUTTON;
            probe.menuParamC[0] = 978;
            probe.doAction(0);
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p2(978)));
            expect(recorded('RESUME_PAUSEBUTTON').slice(1)).toEqual(javaBytes(out => out.p2(978)));

            probe.out.pos = 0;
            probe.menuAction[0] = MiniMenuAction.CLOSE_BUTTON;
            probe.doAction(0);
            expect(sent(probe.out)).toEqual([ClientProt.CLOSE_MODAL & 0xff]);
            expect(recorded('CLOSE_MODAL')).toHaveLength(1);
        } finally {
            IfType.list = previous;
            restore();
        }
    });
});

describe('production chat and dialogue', () => {
    test('handleInputKey parses colour and effect with Java else-if and writes Java bytes', async () => {
        const { probe, restore } = await client();
        try {
            probe.chatModalId = -1;
            probe.chatInput = 'RED:wave2:Hi';
            pushEnter(probe);
            await probe.handleInputKey();
            const body = payload(probe.out);
            expect(body[1]).toBe((-1) & 0xff);
            expect(body[2]).toBe((2 + 128) & 0xff);
            expect(probe.localPlayer!.chatColour).toBe(1);
            expect(probe.localPlayer!.chatEffect).toBe(2);
        } finally {
            restore();
        }
    });

    test('wave2 is not consumed as wave, and a second colour prefix is left in the text', async () => {
        const { probe, restore } = await client();
        try {
            probe.chatModalId = -1;
            probe.chatInput = 'green:WAVE2:Hi';
            pushEnter(probe);
            await probe.handleInputKey();
            const body = payload(probe.out);
            expect(body[1]).toBe((-2) & 0xff);
            expect(body[2]).toBe((2 + 128) & 0xff);

            probe.out.pos = 0;
            probe.keyQueueReadPos = 0;
            probe.keyQueueWritePos = 0;
            probe.chatInput = 'red:green:stay';
            pushEnter(probe);
            await probe.handleInputKey();
            expect(probe.localPlayer!.chatColour).toBe(1);
            expect(probe.localPlayer!.chatMessage?.toLowerCase().startsWith('green:')).toBe(true);
        } finally {
            restore();
        }
    });

    test('public chat pins Java layout and treats the recording as a pre-fix capture', async () => {
        const frame = recorded('MESSAGE_PUBLIC');
        expect(frame.slice(2, 4)).toEqual([0, 0]);
        const { probe, restore } = await client();
        try {
            probe.chatModalId = -1;
            probe.chatInput = 'Tap fixture';
            pushEnter(probe);
            await probe.handleInputKey();
            const java = javaBytes(out => {
                out.p1(0);
                const start = out.pos;
                out.p1_alt2(0);
                out.p1_alt1(0);
                WordPack.pack(out, 'Tap fixture');
                out.psize1(out.pos - start);
            });
            expect(payload(probe.out)).toEqual(java);
            expect(java[2]).toBe(128);
            expect(frame.slice(1)).not.toEqual(java);
            expect(frame.slice(4)).toEqual(java.slice(3));
        } finally {
            restore();
        }
    });

    test('CLIENT_CHEAT matches the recorded Java payload', async () => {
        const { probe, restore } = await client();
        try {
            probe.chatModalId = -1;
            probe.chatInput = '::getvar tutorial';
            pushEnter(probe);
            await probe.handleInputKey();
            expect(payload(probe.out)).toEqual(javaBytes(out => {
                out.p1('::getvar tutorial'.length - 1);
                out.pjstr('getvar tutorial');
            }));
            expect(recorded('CLIENT_CHEAT').slice(1)).toEqual(payload(probe.out));
        } finally {
            restore();
        }
    });

    test('count dialog matches the recorded p4', async () => {
        const { probe, restore } = await client();
        try {
            probe.dialogInputOpen = true;
            probe.dialogInput = '7';
            pushEnter(probe);
            await probe.handleInputKey();
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p4(7)));
            expect(recorded('RESUME_P_COUNTDIALOG').slice(1)).toEqual(payload(probe.out));
        } finally {
            restore();
        }
    });
});

describe('production telemetry', () => {
    test('CYCLELOGIC6 increments only on a chat-mode left click', async () => {
        const { probe, restore } = await client();
        const { Client } = await import('#/client/shell/Client.js');
        const previous = Client.cyclelogic6;
        try {
            Client.cyclelogic6 = 161;
            probe.mouseClickButton = 0;
            probe.chatModeLoop();
            expect(probe.out.pos).toBe(0);
            expect(Client.cyclelogic6).toBe(161);

            probe.mouseClickButton = 1;
            probe.mouseClickX = 0;
            probe.mouseClickY = 0;
            probe.chatModeLoop();
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p2(38304)));
            expect(Client.cyclelogic6).toBe(0);
        } finally {
            Client.cyclelogic6 = previous;
            restore();
        }
    });

    test('CYCLELOGIC1 and CYCLELOGIC5 go through the production methods', async () => {
        const { probe, restore } = await client();
        const { Client } = await import('#/client/shell/Client.js');
        const previous1 = Client.cyclelogic1;
        const previous5 = Client.cyclelogic5;
        try {
            Client.cyclelogic1 = 1458;
            probe.camPitch = 0;
            probe.roofCheck();
            const body = payload(probe.out);
            expect(body[1]).toBe(219);
            expect(body[2]).toBe(0x93);
            expect(body[3]).toBe(0x71);
            expect(body[4]).toBe(61);
            expect([body[5], body[6]]).toEqual([0xaa, 0xec]);
            expect(recorded('ANTICHEAT_CYCLELOGIC1')[2]).toBe(219);

            probe.out.pos = 0;
            Client.cyclelogic5 = 52;
            probe.addProjectiles();
            expect(sent(probe.out)).toEqual([ClientProt.ANTICHEAT_CYCLELOGIC5 & 0xff]);
            expect(recorded('ANTICHEAT_CYCLELOGIC5')).toHaveLength(1);
        } finally {
            Client.cyclelogic1 = previous1;
            Client.cyclelogic5 = previous5;
            restore();
        }
    });

    test('mouse click, mouse move and no-timeout go through gameLoop', async () => {
        const { probe, restore } = await client();
        try {
            const now = performance.now();
            probe.ingame = true;
            probe.idleTimer = now;
            probe.timeoutTimer = now;
            probe.noTimeoutTimer = now - 5_000;
            probe.mouseClickButton = 1;
            probe.mouseClickX = 10;
            probe.mouseClickY = 20;
            probe.mouseClickTime = 1000;
            probe.prevMouseClickTime = 0;
            probe.mouseTracked = true;
            probe.mouseTrackedX = 0;
            probe.mouseTrackedY = 0;
            probe.mouseTracking.x[0] = 10;
            probe.mouseTracking.y[0] = 20;
            probe.mouseTracking.length = 1;
            await probe.gameLoop();
            const bytes = sent(probe.out);
            const click = javaBytes(out => out.p4((20 << 20) + (20 * 765 + 10)));
            expect(bytes.join(',')).toContain(click.join(','));
            expect(bytes).toContain(ClientProt.NO_TIMEOUT & 0xff);
            expect(bytes).toContain(ClientProt.EVENT_MOUSE_MOVE & 0xff);
            expect(recorded('EVENT_MOUSE_CLICK')).toHaveLength(5);
            expect(recorded('EVENT_MOUSE_MOVE')[0]).toBe(171);
            expect(recorded('NO_TIMEOUT')).toHaveLength(1);
        } finally {
            restore();
        }
    });

    test('EVENT_SYNTH_ERROR sends waveIds[wave] & 0x7fff and skips a repeated wave', async () => {
        const { probe, restore } = await client();
        try {
            probe.waveCount = 1;
            probe.waveIds[0] = 0x8001;
            probe.waveLoops[0] = 1;
            probe.waveDelay[0] = 0;
            probe.lastWaveId = -1;
            probe.lastWaveLoops = -1;
            await probe.soundsDoQueue();
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p2(0x8001 & 0x7fff)));

            probe.out.pos = 0;
            probe.waveCount = 1;
            probe.waveIds[0] = 7;
            probe.waveLoops[0] = 2;
            probe.waveDelay[0] = 0;
            probe.lastWaveId = 7;
            probe.lastWaveLoops = 2;
            await probe.soundsDoQueue();
            expect(probe.out.pos).toBe(0);
        } finally {
            restore();
        }
    });
});

describe('production identity and scene packets', () => {
    test('IDK_SAVEDESIGN matches the recorded Java payload', async () => {
        const { probe, restore } = await client();
        try {
            probe.idkDesignGender = true;
            probe.idkDesignPart.set([0, 10, 18, 26, 33, 36, 42]);
            probe.idkDesignColour.set([0, 0, 0, 0, 0]);
            const com = new IfType();
            com.clientCode = ClientCode.CC_ACCEPT_DESIGN;
            expect(probe.clientButton(com)).toBe(true);
            const expected = javaBytes(out => {
                out.p1(0);
                for (const kit of [0, 10, 18, 26, 33, 36, 42]) out.p1(kit);
                for (const colour of [0, 0, 0, 0, 0]) out.p1(colour);
            });
            expect(payload(probe.out)).toEqual(expected);
            expect(recorded('IDK_SAVEDESIGN').slice(1)).toEqual(expected);
        } finally {
            restore();
        }
    });

    test('MAP_BUILD_COMPLETE is written by checkScene', async () => {
        const { probe, restore } = await client();
        try {
            probe.awaitingPlayerInfo = false;
            probe.mapl = Array.from({ length: 4 }, () => Array.from({ length: 104 }, () => new Uint8Array(104)));
            probe.groundh = Array.from({ length: 4 }, () => Array.from({ length: 105 }, () => new Int32Array(105)));
            probe.mapBuildIndex = new Int32Array(0);
            probe.mapBuildGroundData = [];
            probe.mapBuildLocationData = [];
            expect(probe.checkScene()).toBe(0);
            expect(sent(probe.out).at(-1)).toBe(ClientProt.MAP_BUILD_COMPLETE & 0xff);
            expect(recorded('MAP_BUILD_COMPLETE')).toHaveLength(1);
        } finally {
            restore();
        }
    });

    test('requestLogout writes the recorded IF_BUTTON 2458', async () => {
        const { probe, restore } = await client();
        try {
            probe.ingame = true;
            probe.requestLogout();
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p2(2458)));
            expect(frames().some(frame => frame.name === 'IF_BUTTON' && frame.raw[1] === 0x09 && frame.raw[2] === 0x9a)).toBe(true);
        } finally {
            restore();
        }
    });

    test('friend and ignore writers are the production path', async () => {
        const { probe, restore } = await client();
        try {
            const hash = 0x0102030405060708n;
            probe.addFriend(hash);
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p8(hash)));
            probe.out.pos = 0;
            probe.delFriend(hash);
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p8(hash)));
            probe.out.pos = 0;
            probe.addIgnore(hash);
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p8(hash)));
            probe.out.pos = 0;
            probe.delIgnore(hash);
            expect(payload(probe.out)).toEqual(javaBytes(out => out.p8(hash)));
        } finally {
            restore();
        }
    });
});

describe('adapter direct writers', () => {
    test('dragInvSlot matches the recorded non-zero from and mode', () => {
        const framesFor = frames().filter(frame => frame.name === 'INV_BUTTOND');
        const recordedDrag = framesFor[1];
        expect(recordedDrag.raw.slice(1)).toEqual(javaBytes(out => {
            out.p2_alt3(1);
            out.p1_alt1(1);
            out.p2_alt2(5382);
            out.p2_alt1(4);
        }));
        const com = new IfType();
        com.id = 5382;
        com.type = ComponentType.TYPE_INV;
        com.linkObjType = new Int32Array(8);
        com.linkObjNumber = new Int32Array(8);
        com.linkObjType[4] = 11;
        const previous = IfType.list;
        IfType.list = [];
        IfType.list[5382] = com;
        const raw = { out: new Packet(new Uint8Array(64)), statSessionGeneration: 0 };
        attach(raw as never);
        expect(actions.dragInvSlot(5382, 4, 1, 1)).toBe(true);
        expect(sent(raw.out).slice(1)).toEqual(recordedDrag.raw.slice(1));
        expect(sent(raw.out).slice(6, 8)).toEqual([4, 0]);
        IfType.list = previous;
        detach();
    });

    test('answerCountDialog matches the recorded count packet payload', () => {
        const frame = recorded('RESUME_P_COUNTDIALOG');
        const value = new Packet(Uint8Array.from(frame.slice(1))).g4();
        const raw = { out: new Packet(new Uint8Array(16)), ingame: true, dialogInputOpen: true, statSessionGeneration: 0 };
        attach(raw as never);
        expect(actions.answerCountDialog(value)).toBe(true);
        expect(sent(raw.out).slice(1)).toEqual(frame.slice(1));
        detach();
    });

    test('sayPublic uses Java effect bytes; the recording is a pre-fix capture', () => {
        const frame = recorded('MESSAGE_PUBLIC');
        expect(frame[3]).toBe(0);
        const raw = {
            out: new Packet(new Uint8Array(64)),
            localPlayer: { name: 'Elliott', chatMessage: '', chatColour: 0, chatEffect: 0, chatTimer: 0 },
            addChat() {},
            statSessionGeneration: 0
        };
        attach(raw as never);
        expect(actions.sayPublic('hello')).toBe(true);
        expect(sent(raw.out)[3]).toBe(128);
        detach();
    });
});

describe('recorded outbound opcodes', () => {
    test('every recorded opcode is named in this file', () => {
        const source = readFileSync('test/io/outbound377.test.ts', 'utf8');
        const names = [...new Set(frames().map(frame => frame.name))];
        expect(names.length).toBe(21);
        for (const name of names) {
            expect(source.includes(`'${name}'`)).toBe(true);
        }
    });
});
