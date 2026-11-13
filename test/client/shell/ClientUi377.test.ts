import { afterEach, expect, mock, test } from 'bun:test';

import IfType, { ComponentType } from '#/client/config/IfType.js';
import ObjType from '#/client/config/ObjType.js';
import JString from '#/client/datastruct/JString.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import Packet from '#/client/io/Packet.js';
import { getClient377State } from '#/client/shell/Client377State.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { Colour } from '#/client/graphics/Colour.js';
import Pix2D from '#/client/graphics/Pix2D.js';
import PixFont from '#/client/graphics/PixFont.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));

const { Client } = await import('#/client/shell/Client.js');
type ClientInstance = InstanceType<typeof Client>;

const originalInterfaces = IfType.list;
afterEach(() => {
    IfType.list = originalInterfaces;
});

function clientFixture(fields: Record<string, unknown> = {}): ClientInstance {
    const client = Object.assign(Object.create(Client.prototype), {
        out: new Packet(new Uint8Array(128)),
        in: new Packet(new Uint8Array(128)),
        redrawChat: false,
        redrawFrame: false,
        mainModalId: -1,
        chatModalId: -1,
        tutComId: -1,
        reportAbuseComId: -2,
        reportAbuseInput: '',
        socialInputOpen: false,
        dialogInputOpen: false,
        dialogInput: '',
        chatInput: '',
        staffmodlevel: 0,
        ...fields
    }) as ClientInstance;
    getClient377State(client);
    return client;
}

function typeKeys(client: ClientInstance, text: string, ...tail: number[]): void {
    const keys = [...[...text].map(ch => ch.charCodeAt(0)), ...tail];
    client['pollKey'] = (): number => keys.shift() ?? -1;
}

function sent(client: ClientInstance): number[] {
    return [...client['out'].data.subarray(0, client['out'].pos)];
}

test('P_NAMEDIALOG typing sends the base37 name on Enter and closes the dialog', async () => {
    const client = clientFixture();
    getClient377State(client).chatbackInputOpen = 2;
    typeKeys(client, 'Alice', 13);
    await client['handleInputKey']();

    const name = new Packet(new Uint8Array(8));
    name.p8(JString.toUserhash('Alice'));
    expect(sent(client)).toEqual([ClientProt.RESUME_P_NAMEDIALOG, ...name.data]);
    expect(getClient377State(client).chatbackInputOpen).toBe(0);
    expect(client['redrawChat']).toBe(true);
});

test('P_NAMEDIALOG holds twelve characters and Backspace edits them', async () => {
    const client = clientFixture();
    getClient377State(client).chatbackInputOpen = 2;
    typeKeys(client, 'abcdefghijklmn', 8);
    await client['handleInputKey']();
    expect(client['dialogInput']).toBe('abcdefghijk');
    expect(sent(client)).toEqual([]);
    expect(getClient377State(client).chatbackInputOpen).toBe(2);
});

test('P_COUNTDIALOG Enter closes both the count flag and chatbackInputOpen', async () => {
    const client = clientFixture({ dialogInputOpen: true });
    getClient377State(client).chatbackInputOpen = 1;
    typeKeys(client, '42', 13);
    await client['handleInputKey']();
    expect(sent(client)).toEqual([ClientProt.RESUME_P_COUNTDIALOG, 0, 0, 0, 42]);
    expect(client['dialogInputOpen']).toBe(false);
    expect(getClient377State(client).chatbackInputOpen).toBe(0);
});

test('free chat typing stays off while a fullscreen layer is open (Client.java:4935)', async () => {
    const client = clientFixture();
    typeKeys(client, 'hi');
    await client['handleInputKey']();
    expect(client['chatInput']).toBe('hi');

    const open = clientFixture();
    getClient377State(open).fullscreenInterfaceId0 = 9;
    typeKeys(open, 'hi');
    await open['handleInputKey']();
    expect(open['chatInput']).toBe('');
});

test('a fullscreen layer takes all menu input and skips chat and viewport options', () => {
    const layer = Object.assign(new IfType(), { id: 9 });
    IfType.list = [];
    IfType.list[9] = layer;
    const options: unknown[][] = [];
    const client = clientFixture({
        objDragArea: 0,
        menuOption: [],
        menuAction: new Int32Array(8),
        menuNumEntries: 0,
        mouseX: 100,
        mouseY: 120,
        lastOverComId: 5,
        overMainComId: 0,
        addPrivateChatOptions: () => { throw new Error('private chat options are not read under a fullscreen layer'); },
        addWorldOptions: () => { throw new Error('viewport options are not read under a fullscreen layer'); },
        addComponentOptions: (...args: unknown[]) => { options.push(args); client['lastOverComId'] = 77; }
    });
    getClient377State(client).fullscreenInterfaceId0 = 9;
    client['buildMinimenu']();

    expect(options).toEqual([[layer, 100, 120, 0, 0, 0]]);
    expect(client['menuOption'][0]).toBe('Cancel');
    expect(client['menuAction'][0]).toBe(MiniMenuAction.CANCEL);
    expect(client['menuNumEntries']).toBe(1);
    expect(client['overMainComId']).toBe(77);
});

test('the chat area mouse options are off while a chatback input is open (Client.java:3940)', () => {
    const chatOptions: number[][] = [];
    const base = {
        objDragArea: 0,
        menuOption: [],
        menuAction: new Int32Array(8),
        menuNumEntries: 0,
        mouseX: 100,
        mouseY: 400,
        lastOverComId: 0,
        overMainComId: 0,
        overSideComId: 0,
        overChatComId: 0,
        sideModalId: -1,
        sideIcon: new Array(14).fill(-1),
        activeIcon: 0,
        addPrivateChatOptions: () => {},
        addChatOptions: (x: number, y: number) => { chatOptions.push([x, y]); }
    };
    const closed = clientFixture(base);
    closed['buildMinimenu']();
    expect(chatOptions).toEqual([[83, 43]]);

    chatOptions.length = 0;
    const open = clientFixture(base);
    getClient377State(open).chatbackInputOpen = 2;
    open['buildMinimenu']();
    expect(chatOptions).toEqual([]);
});

test('any menu option but Cancel closes an open chatback input (Client.java:9679)', () => {
    const pick = (action: number): ClientInstance => {
        const client = clientFixture({
            menuOption: [],
            menuAction: Int32Array.from([action]),
            menuParamA: new Int32Array(1),
            menuParamB: new Int32Array(1),
            menuParamC: new Int32Array(1),
            dialogInputOpen: true
        });
        getClient377State(client).chatbackInputOpen = 1;
        try {
            client['doAction'](0);
        } catch {
            // The action body needs a live scene; only the dialog reset runs before it.
        }
        return client;
    };

    const cancel = pick(MiniMenuAction.CANCEL);
    expect(getClient377State(cancel).chatbackInputOpen).toBe(1);
    expect(cancel['dialogInputOpen']).toBe(true);

    const other = pick(MiniMenuAction.USEHELD_START);
    expect(getClient377State(other).chatbackInputOpen).toBe(0);
    expect(other['dialogInputOpen']).toBe(false);
    expect(other['redrawChat']).toBe(true);
});

test('gameDraw draws both fullscreen layers on the 765x503 surface and nothing else', () => {
    const drawn: IfType[] = [];
    const surface = { setPixels: mock(() => {}), draw: mock(() => {}) };
    const layers = [9, 10].map(id => Object.assign(new IfType(), { id, width: 512, height: 334, type: 0 }));
    IfType.list = [];
    layers.forEach(layer => { IfType.list[layer.id] = layer; });
    const animated: number[] = [];
    const client = clientFixture({
        players: [],
        sceneState: 2,
        drawArea: surface,
        worldUpdateNum: 4,
        isMenuOpen: false,
        animateInterface: (id: number) => { animated.push(id); return false; },
        prepareFullGame: () => {},
        drawInterface: (layer: IfType) => { drawn.push(layer); },
        buildMinimenu: () => {},
        drawFeedback: () => {},
        drawMinimenu: () => { throw new Error('no menu is open'); },
        gameDrawMain: () => { throw new Error('the scene is not drawn under a fullscreen layer'); },
        areaBackleft1: { draw: () => { throw new Error('the frame chrome is not drawn under a fullscreen layer'); } }
    });
    Object.assign(getClient377State(client), { fullscreenInterfaceId0: 9, fullscreenInterfaceId1: 10 });
    client['gameDraw']();

    expect(animated).toEqual([9, 10]);
    expect(client['worldUpdateNum']).toBe(0);
    expect(drawn).toEqual(layers);
    expect(layers.map(layer => [layer.width, layer.height])).toEqual([[765, 503], [765, 503]]);
    expect(surface.draw).toHaveBeenCalledWith(0, 0);
    expect(client['redrawFrame']).toBe(true);
});

interface Sprite {
    plotSprite: (x: number, y: number) => void;
}

function spriteLog(name: string, log: string[]): Sprite {
    return { plotSprite: (x, y) => { log.push(`${name}@${x},${y}`); } };
}

function overlayClient(fields: Record<string, unknown>): ClientInstance {
    const client = clientFixture({
        chatCount: 0,
        playerCount: 0,
        npcCount: 0,
        playerIds: new Int32Array(8),
        npcIds: new Int32Array(8),
        npc: [],
        var: new Int32Array(32),
        hintType: 0,
        hintNpc: -1,
        hintPlayer: -1,
        chatPublicMode: 0,
        ...fields
    });
    client['getOverlayPosEntity'] = (): void => {
        client['projectX'] = 100;
        client['projectY'] = 200;
    };
    return client;
}

test('player head icons plot from the pk, prayer and hint sprite sets in Java order (Client.java:6363-6381)', () => {
    const log: string[] = [];
    const localPlayer = { isReady: () => true, height: 50, headiconPk: 1, headiconPrayer: 2, chatMessage: null, combatCycle: 0, damageCycles: new Int32Array(4) };
    const client = overlayClient({
        localPlayer,
        hintType: 10,
        hintPlayer: 0,
        headiconsPk: [null, spriteLog('pk1', log)],
        headiconsPrayer: [null, null, spriteLog('prayer2', log)],
        headiconsHint: [spriteLog('hint0', log), spriteLog('hint1', log)]
    });
    client['playerIds'][0] = 0;
    client['playerCount'] = 0;
    client['entityOverlays']();
    // The local player is index -1, so the player hint (index >= 0) does not draw for it; the stack rises 25 per icon.
    expect(log).toEqual(['pk1@88,170', 'prayer2@88,145']);
});

test('npc head icons come from the prayer set and the hint arrow from hint 0', () => {
    const log: string[] = [];
    const npc = {
        isReady: () => true,
        height: 40,
        chatMessage: null,
        combatCycle: 0,
        damageCycles: new Int32Array(4),
        type: { headicon: 3, multinpc: [] as number[] }
    };
    const client = overlayClient({
        localPlayer: null,
        playerCount: 0,
        npcCount: 1,
        npcIds: Int32Array.from([5]),
        npc: Object.assign([], { 5: npc }),
        hintType: 1,
        hintNpc: 5,
        headiconsPrayer: [null, null, null, spriteLog('prayer3', log)],
        headiconsHint: [spriteLog('hint0', log)]
    });
    Client.loopCycle = 0;
    client['entityOverlays']();
    expect(log).toEqual(['prayer3@88,170', 'hint0@88,172']);
});

test('an npc whose multinpc form resolves to nothing draws no overlay at all (Client.java:6336-6341)', () => {
    const log: string[] = [];
    const hidden = {
        isReady: () => true,
        height: 40,
        chatMessage: null,
        type: { headicon: 3, multinpc: [-1, -1], multivar: 7, multivarbit: -1 }
    };
    const client = overlayClient({
        localPlayer: null,
        npcCount: 1,
        npcIds: Int32Array.from([5]),
        npc: Object.assign([], { 5: hidden }),
        hintType: 1,
        hintNpc: 5,
        headiconsPrayer: [null, null, null, spriteLog('prayer3', log)],
        headiconsHint: [spriteLog('hint0', log)]
    });
    Client.loopCycle = 0;
    client['entityOverlays']();
    expect(log).toEqual([]);
});
test('HP bars follow the Java combat-cycle gate (Client.java:6408-6416)', () => {
    const originalLoopCycle = Client.loopCycle;
    const originalFillRect = Pix2D.fillRect;
    const fills: [number, number, number, number, number][] = [];
    const localPlayer = {
        isReady: () => true,
        height: 50,
        headiconPk: -1,
        headiconPrayer: -1,
        chatMessage: null,
        combatCycle: 100,
        health: 5,
        totalHealth: 10,
        damageCycles: new Int32Array(4)
    };
    const client = overlayClient({ localPlayer });
    Pix2D.fillRect = (x, y, width, height, colour): void => {
        fills.push([x, y, width, height, colour]);
    };

    try {
        Client.loopCycle = 100;
        client['entityOverlays']();
        expect(fills).toEqual([]);

        localPlayer.combatCycle = 101;
        client['entityOverlays']();
        expect(fills).toEqual([
            [85, 197, 15, 5, Colour.GREEN],
            [100, 197, 15, 5, Colour.RED]
        ]);
    } finally {
        Client.loopCycle = originalLoopCycle;
        Pix2D.fillRect = originalFillRect;
    }
});

test('chat effect 4 uses Java integer division for its scroll offset (Client.java:6520-6525)', () => {
    const draws: [number, number, number][] = [];
    const font = {
        stringWid: () => 21,
        height: 12,
        drawString: (_message: string | null, x: number, y: number, colour: number): void => {
            draws.push([x, y, colour]);
        }
    };
    const npc = {
        isReady: () => true,
        height: 40,
        chatMessage: 'abc',
        chatColour: 0,
        chatEffect: 4,
        chatTimer: 100,
        combatCycle: 0,
        damageCycles: new Int32Array(4),
        type: null
    };
    const client = overlayClient({
        localPlayer: null,
        npcCount: 1,
        npcIds: Int32Array.from([5]),
        npc: Object.assign([], { 5: npc }),
        chatEffects: 0,
        chatWidth: new Int32Array(50),
        chatHeight: new Int32Array(50),
        chatX: new Int32Array(50),
        chatY: new Int32Array(50),
        chatColour: new Int32Array(50),
        chatEffect: new Int32Array(50),
        chatTimer: new Int32Array(50),
        chats: new Array<string>(50),
        b12: font
    });

    client['entityOverlays']();

    expect(draws).toEqual([
        [110, 201, Colour.BLACK],
        [110, 200, Colour.YELLOW]
    ]);
});

test('CS1 opcode 4 accepts the highest valid raw object ID (Client.java:11200-11209)', () => {
    const original = {
        numDefinitions: ObjType.numDefinitions,
        idx: ObjType.idx,
        dat: ObjType.dat,
        recent: ObjType.recent,
        recentPos: ObjType.recentPos,
        datEnd: ObjType.datEnd,
        memServer: ObjType.memServer
    };

    try {
        ObjType.numDefinitions = 2;
        ObjType.idx = new Int32Array(2);
        ObjType.dat = new Packet(new Uint8Array(0));
        ObjType.recent = Array.from({ length: 10 }, () => new ObjType());
        ObjType.recent[0]!.id = 1;
        ObjType.recentPos = 0;
        ObjType.memServer = true;

        const inventory = new IfType();
        inventory.id = 0;
        inventory.linkObjType = Int32Array.from([2]);
        inventory.linkObjNumber = Int32Array.from([17]);
        const scriptOwner = new IfType();
        scriptOwner.scripts = [Uint16Array.from([4, 0, 1, 0])];
        IfType.list = [inventory, scriptOwner];

        const client = clientFixture();
        expect(client['getIfVar'](scriptOwner, 0)).toBe(17);
    } finally {
        ObjType.numDefinitions = original.numDefinitions;
        ObjType.idx = original.idx;
        ObjType.dat = original.dat;
        ObjType.recent = original.recent;
        ObjType.recentPos = original.recentPos;
        ObjType.datEnd = original.datEnd;
        ObjType.memServer = original.memServer;
    }
});

test('type-8 tooltips use Java hover gates, tagged text widths and clipping (Client.java:10996-11046)', () => {
    const original = {
        pixels: Pix2D.pixels,
        width: Pix2D.width,
        height: Pix2D.height,
        clipMinX: Pix2D.clipMinX,
        clipMaxX: Pix2D.clipMaxX,
        clipMinY: Pix2D.clipMinY,
        clipMaxY: Pix2D.clipMaxY,
        sizeX: Pix2D.sizeX,
        maxX: Pix2D.maxX,
        maxY: Pix2D.maxY
    };
    const pixels = new Int32Array(765 * 503);
    const textDraws: [string, number, number, number, boolean][] = [];
    const font = Object.assign(Object.create(PixFont.prototype), {
        height: 10,
        charAdvance: new Int32Array(128).fill(5),
        drawStringTag: (text: string, x: number, y: number, colour: number, shadowed: boolean): void => {
            textDraws.push([text, x, y, colour, shadowed]);
        }
    }) as PixFont;

    try {
        Pix2D.setPixels(pixels, 765, 503);

        const root = new IfType();
        root.id = 0;
        root.type = ComponentType.TYPE_LAYER;
        root.width = 140;
        root.height = 60;
        root.children = [1];
        root.childX = [50];
        root.childY = [20];

        const tooltip = new IfType();
        tooltip.id = 1;
        tooltip.type = ComponentType.TYPE_TEXT_STATIC;
        tooltip.width = 100;
        tooltip.height = 10;
        tooltip.text = '@red@Wide\\nshort';
        IfType.list = [root, tooltip];

        const client = clientFixture({
            p12: font,
            overMainComId: 1,
            overSideComId: 0,
            overChatComId: 0,
            tooltipTimer: 100
        });
        const tooltipPainted = (main: number, side: number, chat: number, timer: number): boolean => {
            pixels.fill(0);
            client['overMainComId'] = main;
            client['overSideComId'] = side;
            client['overChatComId'] = chat;
            client['tooltipTimer'] = timer;
            client['drawInterface'](root, 20, 30, 0);
            return pixels[62 * Pix2D.width + 130] === 0xffffa0;
        };

        expect(tooltipPainted(1, 0, 0, 100)).toBe(true);
        expect(tooltipPainted(0, 1, 0, 100)).toBe(true);
        expect(tooltipPainted(0, 0, 1, 100)).toBe(true);
        expect(tooltipPainted(0, 0, 0, 100)).toBe(false);
        expect(tooltipPainted(2, 0, 0, 100)).toBe(false);
        expect(tooltipPainted(1, 0, 0, 99)).toBe(false);

        pixels.fill(0);
        textDraws.length = 0;
        client['overMainComId'] = 1;
        client['overSideComId'] = 0;
        client['overChatComId'] = 0;
        client['tooltipTimer'] = 100;
        client['drawInterface'](root, 20, 30, 0);
        expect(textDraws).toEqual([
            ['@red@Wide', 132, 73, Colour.BLACK, false],
            ['short', 132, 84, Colour.BLACK, false]
        ]);
        expect(pixels[62 * Pix2D.width + 130]).toBe(0xffffa0);
        expect(pixels[61 * Pix2D.width + 129]).toBe(Colour.BLACK);
        expect(pixels[89 * Pix2D.width + 159]).toBe(Colour.BLACK);
        expect(Pix2D.clipMinX).toBe(0);
        expect(Pix2D.clipMinY).toBe(0);
        expect(Pix2D.clipMaxX).toBe(765);
        expect(Pix2D.clipMaxY).toBe(503);

        tooltip.text = '';
        pixels.fill(0);
        textDraws.length = 0;
        client['drawInterface'](root, 20, 30, 0);
        expect(textDraws).toEqual([]);
        expect(pixels[66 * Pix2D.width + 155]).toBe(0xffffa0);

        root.width = 20;
        root.height = 50;
        root.childX = [0];
        root.childY = [0];
        tooltip.width = 10;
        tooltip.height = 10;
        tooltip.text = 'abcde';
        pixels.fill(0);
        client['drawInterface'](root, 20, 30, 0);
        expect(pixels[46 * Pix2D.width + 19]).toBe(0);
        expect(pixels[46 * Pix2D.width + 20]).toBe(0xffffa0);
        expect(pixels[46 * Pix2D.width + 39]).toBe(Colour.BLACK);
        expect(pixels[46 * Pix2D.width + 40]).toBe(0);
    } finally {
        Object.assign(Pix2D, original);
    }
});

test('type-8 tooltip timer holds 100 hovered cycles and decays without hover (Client.java:3306-3322)', () => {
    const client = clientFixture({
        overMainComId: 0,
        overSideComId: 7,
        overChatComId: 8,
        tooltipTimer: 99,
        redrawChat: false,
        redrawSide: false
    });

    client['updateTooltipTimer']();
    expect(client['tooltipTimer']).toBe(100);
    expect(client['redrawChat']).toBe(true);
    expect(client['redrawSide']).toBe(true);

    client['overSideComId'] = 0;
    client['overChatComId'] = 0;
    client['tooltipTimer'] = 1;
    client['updateTooltipTimer']();
    expect(client['tooltipTimer']).toBe(0);
});
