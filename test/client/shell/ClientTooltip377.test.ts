import { afterEach, expect, mock, test } from 'bun:test';

import IfType, { ComponentType } from '#/client/config/IfType.js';
import Pix2D from '#/client/graphics/Pix2D.js';
import PixFont from '#/client/graphics/PixFont.js';
import { getClient377State } from '#/client/shell/Client377State.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));

// Load after the audio mock: the browser audio module cannot initialize in this test runner.
const { Client } = await import('#/client/shell/Client.js');
type ClientInstance = InstanceType<typeof Client>;

const originalInterfaces = IfType.list;
const originalRaster = {
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
afterEach(() => {
    IfType.list = originalInterfaces;
    Object.assign(Pix2D, originalRaster);
});

const areas = [
    { name: 'viewport', x: 4, y: 4, tooltip: 'tooltipMainComId', highlight: 'overMainComId', redraw: null },
    { name: 'side', x: 553, y: 205, tooltip: 'tooltipSideComId', highlight: 'overSideComId', redraw: 'redrawSide' },
    { name: 'chat', x: 17, y: 357, tooltip: 'tooltipChatComId', highlight: 'overChatComId', redraw: 'redrawChat' },
    { name: 'fullscreen', x: 0, y: 0, tooltip: 'tooltipMainComId', highlight: 'overMainComId', redraw: null }
] as const;

function fixture(area: (typeof areas)[number], type: ComponentType): { client: ClientInstance; root: IfType; draws: string[] } {
    const root = Object.assign(new IfType(), {
        id: 1,
        type: ComponentType.TYPE_LAYER,
        width: 180,
        height: 90,
        children: [2, 3],
        childX: [10, 90],
        childY: [10, 10]
    });
    const child = Object.assign(new IfType(), {
        id: 2,
        type,
        width: 70,
        height: 20,
        colourOver: type === ComponentType.TYPE_TEXT ? 0xff0000 : 0,
        text: 'first tooltip'
    });
    const next = Object.assign(new IfType(), { ...child, id: 3, text: 'second tooltip' });
    IfType.list = [];
    IfType.list[1] = root;
    IfType.list[2] = child;
    IfType.list[3] = next;
    const draws: string[] = [];
    const font = Object.assign(Object.create(PixFont.prototype), {
        height: 10,
        charAdvance: new Int32Array(128).fill(5),
        drawStringTag: (text: string): void => { draws.push(text); }
    }) as PixFont;
    const client = Object.assign(Object.create(Client.prototype), {
        objDragArea: 0,
        menuOption: [],
        menuAction: new Int32Array(8),
        menuNumEntries: 0,
        mouseX: -1,
        mouseY: -1,
        splitPrivateChat: 0,
        mainModalId: area.name === 'viewport' ? 1 : -1,
        sideModalId: area.name === 'side' ? 1 : -1,
        chatModalId: area.name === 'chat' ? 1 : -1,
        tutComId: -1,
        sideIcon: new Array(14).fill(-1),
        activeIcon: 0,
        lastOverComId: 0,
        overMainComId: 0,
        overSideComId: 0,
        overChatComId: 0,
        lastTooltipComId: 0,
        tooltipMainComId: 0,
        tooltipSideComId: 0,
        tooltipChatComId: 0,
        tooltipTimer: 0,
        redrawSide: false,
        redrawChat: false,
        p12: font
    }) as ClientInstance;
    getClient377State(client).fullscreenInterfaceId0 = area.name === 'fullscreen' ? 1 : -1;
    Pix2D.setPixels(new Int32Array(765 * 503), 765, 503);
    return { client, root, draws };
}

function tooltipIds(client: ClientInstance): number[] {
    return [client['tooltipMainComId'], client['tooltipSideComId'], client['tooltipChatComId']];
}

function clearRedraw(client: ClientInstance): void {
    client['redrawSide'] = false;
    client['redrawChat'] = false;
}

for (const area of areas) {
    test(`${area.name}: real type-8 hover paints at cycle 100, changes ids, clears and decays (Java:3889-3951,11323-11325)`, () => {
        const { client, root, draws } = fixture(area, ComponentType.TYPE_TEXT_STATIC);
        client['buildMinimenu']();
        client['updateTooltipTimer']();
        expect(tooltipIds(client)).toEqual([0, 0, 0]);
        expect(client['tooltipTimer']).toBe(0);
        expect([client['redrawSide'], client['redrawChat']]).toEqual([false, false]);

        client.mouseX = area.x + 11;
        client.mouseY = area.y + 11;
        client['buildMinimenu']();
        for (let cycle = 0; cycle < 99; cycle++) client['updateTooltipTimer']();
        expect(client['tooltipTimer']).toBe(99);
        expect(client[area.tooltip]).toBe(2);
        expect([client['overMainComId'], client['overSideComId'], client['overChatComId']]).toEqual([0, 0, 0]);
        expect(client['redrawSide']).toBe(area.redraw === 'redrawSide');
        expect(client['redrawChat']).toBe(area.redraw === 'redrawChat');
        client['drawInterface'](root, area.x, area.y, 0);
        expect(draws).toEqual([]);

        clearRedraw(client);
        client['updateTooltipTimer']();
        expect(client['tooltipTimer']).toBe(100);
        expect(client['redrawSide']).toBe(area.redraw === 'redrawSide');
        expect(client['redrawChat']).toBe(area.redraw === 'redrawChat');
        client['drawInterface'](root, area.x, area.y, 0);
        expect(draws).toEqual(['first tooltip']);
        clearRedraw(client);
        client['updateTooltipTimer']();
        client['buildMinimenu']();
        expect(client['tooltipTimer']).toBe(100);
        expect([client['redrawSide'], client['redrawChat']]).toEqual([false, false]);

        client.mouseX = area.x + 91;
        client['buildMinimenu']();
        expect(client[area.tooltip]).toBe(3);
        expect(client['tooltipTimer']).toBe(100);
        expect(client['redrawSide']).toBe(area.redraw === 'redrawSide');
        expect(client['redrawChat']).toBe(area.redraw === 'redrawChat');
        draws.length = 0;
        client['drawInterface'](root, area.x, area.y, 0);
        expect(draws).toEqual(['second tooltip']);

        clearRedraw(client);
        client.mouseX = -1;
        client.mouseY = -1;
        client['buildMinimenu']();
        expect(tooltipIds(client)).toEqual([0, 0, 0]);
        expect(client['redrawSide']).toBe(area.redraw === 'redrawSide');
        expect(client['redrawChat']).toBe(area.redraw === 'redrawChat');
        draws.length = 0;
        client['drawInterface'](root, area.x, area.y, 0);
        expect(draws).toEqual([]);
        client['updateTooltipTimer']();
        expect(client['tooltipTimer']).toBe(99);
        for (let cycle = 0; cycle < 100; cycle++) client['updateTooltipTimer']();
        expect(client['tooltipTimer']).toBe(0);
        clearRedraw(client);
        client['buildMinimenu']();
        expect([client['redrawSide'], client['redrawChat']]).toEqual([false, false]);

        // Java's child bounds include the left/top edges and exclude the right/bottom edges.
        for (const [dx, dy, id] of [[10, 10, 2], [80, 10, 0], [10, 30, 0]]) {
            client.mouseX = area.x + dx;
            client.mouseY = area.y + dy;
            client['buildMinimenu']();
            expect(client[area.tooltip]).toBe(id);
        }
    });

    test(`${area.name}: an overcolour highlight never starts the tooltip timer or requests an extra repaint (Java:3306-3322)`, () => {
        const { client } = fixture(area, ComponentType.TYPE_TEXT);
        client.mouseX = area.x + 11;
        client.mouseY = area.y + 11;
        client['buildMinimenu']();
        expect(client[area.highlight]).toBe(2);
        expect(client['redrawSide']).toBe(area.redraw === 'redrawSide');
        expect(client['redrawChat']).toBe(area.redraw === 'redrawChat');
        clearRedraw(client);
        for (let cycle = 0; cycle < 100; cycle++) {
            client['buildMinimenu']();
            client['updateTooltipTimer']();
        }
        expect(client['tooltipTimer']).toBe(0);
        expect(tooltipIds(client)).toEqual([0, 0, 0]);
        expect([client['redrawSide'], client['redrawChat']]).toEqual([false, false]);

        client.mouseX = -1;
        client.mouseY = -1;
        client['buildMinimenu']();
        client['updateTooltipTimer']();
        expect(client[area.highlight]).toBe(0);
        expect(tooltipIds(client)).toEqual([0, 0, 0]);
        expect(client['tooltipTimer']).toBe(0);
        expect(client['redrawSide']).toBe(area.redraw === 'redrawSide');
        expect(client['redrawChat']).toBe(area.redraw === 'redrawChat');
    });
}
