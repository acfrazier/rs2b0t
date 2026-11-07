import { afterAll, afterEach, expect, mock, test } from 'bun:test';
import IfType from '#/client/config/IfType.js';
import JString from '#/client/datastruct/JString.js';
import Packet from '#/client/io/Packet.js';
import { ClientCode } from '#/client/shell/ClientCode.js';
import JagFX from '#/client/sound/JagFX.js';
import ObjType from '#/client/config/ObjType.js';
import VarpType from '#/client/config/VarpType.js';
import WordPack from '#/client/wordfilter/WordPack.js';
import { getClient377State } from '#/client/shell/Client377State.js';
import * as webDns from '#/client/util/WebDns.js';

const dnsLookupRequests: string[] = [];
// Copied before the mock replaces the module's exports, so afterAll can put the original lookup back for later files.
const originalWebDns = { ...webDns };
// Mock before loading Client: WebDns is captured when the module evaluates.
mock.module('#/client/util/WebDns.js', () => ({
    reverseDnsLookup: async (ip: string): Promise<(string | null)[]> => {
        dnsLookupRequests.push(ip);
        return [];
    }
}));
afterAll(() => {
    mock.module('#/client/util/WebDns.js', () => originalWebDns);
});
const { Client } = await import('#/client/shell/Client.js');
type ClientInstance = InstanceType<typeof Client>;


const originalInterfaces = IfType.list;
const originalMembersWorld = Client.memServer;
const originalLowMem = Client.lowMem;
const originalVarps = VarpType.list;
afterEach(() => {
    IfType.list = originalInterfaces;
    Client.memServer = originalMembersWorld;
    Client.lowMem = originalLowMem;
    dnsLookupRequests.length = 0;
    VarpType.list = originalVarps;
});

type Client377Fixture = ClientInstance;
function clientFixture(fields: Record<string, unknown> = {}): Client377Fixture {
    const client = Object.assign(Object.create(Client.prototype), {
        in: new Packet(new Uint8Array(128)),
        out: new Packet(new Uint8Array(128)),
        ptype: 0,
        psize: 0,
        redrawSide: false,
        redrawChat: false,
        redrawIcons: false,
        redrawFrame: false,
        redrawChatMode: false,
        activeIcon: 0,
        sideIcon: new Array(14).fill(-1),
        mainModalId: -1,
        sideModalId: -1,
        chatModalId: -1,
        mainOverlayId: -1,
        var: new Int32Array(256),
        varServ: new Int32Array(4),
        tutComId: -1,
        statBaseLevel: new Int32Array(21),
        statEffectiveLevel: new Int32Array(21),
        statXP: new Int32Array(21),
        statSeenGeneration: new Int32Array(21),
        statSessionGeneration: 7,
        ignoreCount: 0,
        ignoreUserhash: [],
        friendCount: 0,
        friendUsername: new Array(200).fill(null),
        friendUserhash: new BigInt64Array(200),
        friendNodeId: new Int32Array(200),
        privateMessageIds: new Int32Array(100),
        privateMessageCount: 0,
        waveCount: 0,
        waveIds: new Int32Array(50),
        waveLoops: new Int32Array(50),
        waveDelay: new Int32Array(50),
        waveEnabled: false,
        camShake: new Array(5).fill(false),
        camShakeAxis: new Int32Array(5),
        camShakeRan: new Int32Array(5),
        camShakeAmp: new Int32Array(5),
        camShakeCycle: new Int32Array(5),
        midiActive: false,
        chatWidth: new Int32Array(50),
        chatHeight: new Int32Array(50),
        chatX: new Int32Array(50),
        chatY: new Int32Array(50),
        chatColour: new Int32Array(50),
        chatEffect: new Int32Array(50),
        chatTimer: new Int32Array(50),
        chats: new Array(50).fill(null),
        playerOp: new Array(5).fill(null),
        playerOpPriority: new Array(5).fill(false),
        invUpdateState: new Map(),
        ...fields
    }) as Client377Fixture;
    getClient377State(client);
    return client;
}

function installInput(client: ClientInstance, packet: Packet): void {
    const size = packet.pos;
    packet.pos = 0;
    client['in'] = packet;
    client['psize'] = size;
}

function packet(): Packet {
    return new Packet(new Uint8Array(128));
}
function installComponent(id: number, fields: Partial<IfType> = {}): IfType {
    const component = Object.assign(new IfType(), fields);
    component.id = id;
    IfType.list[id] = component;
    return component;
}

function expectConsumed(client: ClientInstance): void {
    expect(client['in'].pos).toBe(client['psize']);
}

function writeG3Alt3(packet: Packet, value: number): void {
    packet.data[packet.pos++] = (value >>> 8) & 0xff;
    packet.data[packet.pos++] = (value >>> 16) & 0xff;
    packet.data[packet.pos++] = value & 0xff;
}

function writeG4Alt3(packet: Packet, value: number): void {
    const unsigned = value >>> 0;
    packet.data[packet.pos++] = (unsigned >>> 16) & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 24) & 0xff;
    packet.data[packet.pos++] = unsigned & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 8) & 0xff;
}
function writeG4Alt1(packet: Packet, value: number): void {
    const unsigned = value >>> 0;
    packet.data[packet.pos++] = unsigned & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 8) & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 16) & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 24) & 0xff;
}

test('IF handlers apply transformed text, colour and packed rotation values', () => {
    IfType.list = [];
    const component = IfType.list[100] = new IfType();
    const client = clientFixture();
    component.layerId = 0x1234;
    client['tutComId'] = 0x1234;

    const text = packet();
    text.p2_alt3(100);
    text.pjstr('Welcome');
    installInput(client, text);
    expect(client['handleIfSetText']()).toBe(true);
    expectConsumed(client);
    expect(component.text).toBe('Welcome');
    expect(client['redrawChat']).toBe(true);

    const colour = packet();
    colour.p2(100);
    colour.p2_alt2(0x15e3);
    installInput(client, colour);
    expect(client['handleIfSetColour']()).toBe(true);
    expectConsumed(client);
    expect(component.colour).toBe(0x287818);

    const rotation = packet();
    rotation.p2(0x1234);
    rotation.p2_alt2(100);
    rotation.p2_alt1(0x5678);
    installInput(client, rotation);
    expect(client['handleIfSetRotation']()).toBe(true);
    expectConsumed(client);
    expect(getClient377State(client).modelRotateByComponentId.get(100)).toBe(0x12345678);
});
test('IF_CLOSE handler resets modal input state and advances its generation', () => {
    const close = clientFixture({
        modalCloseGeneration: 0,
        mainModalId: 100,
        sideModalId: 101,
        chatModalId: 102,
        dialogInputOpen: true,
        resumedPauseButton: true
    });
    Object.assign(getClient377State(close), {
        fullscreenInterfaceId0: 103,
        fullscreenInterfaceId1: 104,
        chatbackInputOpen: 1
    });
    installInput(close, packet());
    expect(close['handleIfClose']()).toBe(true);
    expectConsumed(close);
    expect(close['modalCloseGeneration']).toBe(1);
    expect([close['mainModalId'], close['sideModalId'], close['chatModalId']]).toEqual([-1, -1, -1]);
    expect([getClient377State(close).fullscreenInterfaceId0, getClient377State(close).fullscreenInterfaceId1]).toEqual([-1, -1]);
    expect(getClient377State(close).chatbackInputOpen).toBe(0);
});

test('inventory full, partial and stop-transmit handlers update their live components', () => {
    IfType.list = [];
    const inventory = IfType.list[6963] = new IfType();
    inventory.linkObjType = new Int32Array(3);
    inventory.linkObjNumber = new Int32Array(3);
    const client = clientFixture();

    const full = packet();
    full.p2(6963);
    full.p2(2);
    full.p2_alt3(146);
    full.p1_alt2(3);
    full.p2_alt3(158);
    full.p1_alt2(7);
    installInput(client, full);
    expect(client['handleUpdateInvFull']()).toBe(true);
    expectConsumed(client);
    expect(Array.from(inventory.linkObjType)).toEqual([146, 158, 0]);
    expect(Array.from(inventory.linkObjNumber)).toEqual([3, 7, 0]);

    const partial = packet();
    partial.p2(6963);
    partial.p1(1);
    partial.p2(181);
    partial.p1(4);
    installInput(client, partial);
    expect(client['handleUpdateInvPartial']()).toBe(true);
    expectConsumed(client);
    expect(Array.from(inventory.linkObjType)).toEqual([146, 181, 0]);
    expect(Array.from(inventory.linkObjNumber)).toEqual([3, 4, 0]);

    const stop = packet();
    stop.p2_alt1(6963);
    installInput(client, stop);
    expect(client['handleUpdateInvStopTransmit']()).toBe(true);
    expectConsumed(client);
    expect(Array.from(inventory.linkObjType)).toEqual([0, 0, 0]);
    expect(Array.from(inventory.linkObjNumber)).toEqual([3, 4, 0]);
    expect(client['invUpdateState'].get(6963)?.transmitting).toBe(false);
});
test('inventory handlers reject components without inventory storage', () => {
    IfType.list = [];
    IfType.list[6963] = new IfType();
    const client = clientFixture();

    const full = packet();
    full.p2(6963);
    full.p2(0);
    installInput(client, full);
    expect(() => client['handleUpdateInvFull']()).toThrow();

    const partial = packet();
    partial.p2(6963);
    installInput(client, partial);
    expect(() => client['handleUpdateInvPartial']()).toThrow();

    const stop = packet();
    stop.p2_alt1(6963);
    installInput(client, stop);
    expect(() => client['handleUpdateInvStopTransmit']()).toThrow();
});

test('small, large and sync varp handlers keep client and server values in step', () => {
    const client = clientFixture({ clientVar: (): void => {} });

    const small = packet();
    small.p2_alt2(1);
    small.p1_alt3(-2);
    installInput(client, small);
    expect(client['handleVarpSmall']()).toBe(true);
    expectConsumed(client);
    expect(client['var'][1]).toBe(-2);
    expect(client['varServ'][1]).toBe(-2);

    const large = packet();
    writeG4Alt3(large, 0x12345678);
    large.p2_alt1(2);
    installInput(client, large);
    expect(client['handleVarpLarge']()).toBe(true);
    expectConsumed(client);
    expect(client['var'][2]).toBe(0x12345678);
    expect(client['varServ'][2]).toBe(0x12345678);

    client['varServ'][3] = 17;
    installInput(client, packet());
    expect(client['handleVarpSync']()).toBe(true);
    expectConsumed(client);
    expect(client['var'][3]).toBe(17);
});

test('UPDATE_STAT derives base level from XP and preserves the effective level', () => {
    const client = clientFixture();
    const stat = packet();
    stat.p1_alt2(18);
    stat.p1(42);
    stat.p4(987654);
    installInput(client, stat);

    expect(client['handleUpdateStat']()).toBe(true);
    expectConsumed(client);
    expect(client['statEffectiveLevel'][18]).toBe(42);
    expect(client['statBaseLevel'][18]).toBe(72);
    expect(client['statXP'][18]).toBe(987654);
    expect(client['statSeenGeneration'][18]).toBe(7);
});

test('game-message and chat-filter handlers apply message and mode state', () => {
    const messages: [number, string, string][] = [];
    const client = clientFixture({
        chatDisabled: 0,
        addChat: (type: number, text: string, name: string): void => { messages.push([type, text, name]); }
    });

    const message = packet();
    message.pjstr('A challenger appears');
    installInput(client, message);
    expect(client['handleMessageGame']()).toBe(true);
    expectConsumed(client);
    expect(messages).toEqual([[0, 'A challenger appears', '']]);

    const filter = packet();
    filter.p1(2);
    filter.p1(1);
    filter.p1(0);
    installInput(client, filter);
    expect(client['handleChatFilterSettings']()).toBe(true);
    expectConsumed(client);
    expect([client['chatPublicMode'], client['chatPrivateMode'], client['chatTradeMode']]).toEqual([2, 1, 0]);
    expect(client['redrawChatMode']).toBe(true);
});

test('friend-list and social-dialog handlers update social UI state', () => {
    const client = clientFixture({ socialInputOpen: true, dialogInputOpen: false });

    const loaded = packet();
    loaded.p1(2);
    installInput(client, loaded);
    expect(client['handleFriendListLoaded']()).toBe(true);
    expectConsumed(client);
    expect(client['friendServerStatus']).toBe(2);

    const username = JString.toUserhash('Friend');
    const friend = packet();
    friend.p8(username);
    friend.p1(Client.nodeId);
    installInput(client, friend);
    expect(client['handleUpdateFriendList']()).toBe(true);
    expectConsumed(client);
    expect(client['friendCount']).toBe(1);
    expect(client['friendUserhash'][0]).toBe(username);
    expect(client['friendUsername'][0]).toBe('Friend');
    expect(client['friendNodeId'][0]).toBe(Client.nodeId);

    installInput(client, packet());
    expect(client['handlePCountDialog']()).toBe(true);
    expectConsumed(client);
    expect(client['socialInputOpen']).toBe(false);
    expect(getClient377State(client).chatbackInputOpen).toBe(1);
    expect(client['dialogInputOpen']).toBe(true);

    installInput(client, packet());
    expect(client['handlePNamedialog']()).toBe(true);
    expectConsumed(client);
    expect(getClient377State(client).chatbackInputOpen).toBe(2);
    expect(client['dialogInputOpen']).toBe(false);
});

test('hint-arrow handler decodes entity targets and consumes descriptor padding', () => {
    const client = clientFixture();
    const hint = packet();
    hint.p1(1);
    hint.p2(321);
    hint.pdata(Uint8Array.of(0xaa, 0xbb, 0xcc), 0, 3);
    installInput(client, hint);

    expect(client['handleHintArrow']()).toBe(true);
    expectConsumed(client);
    expect(client['hintType']).toBe(1);
    expect(client['hintNpc']).toBe(321);
    expect(client['in'].pos).toBe(6);
});

test('LAST_LOGIN_INFO decodes its Java field order and supplies diary state', () => {
    IfType.list = [];
    const client = clientFixture();
    const beforeLogin = new IfType();
    beforeLogin.clientCode = ClientCode.CC_LAST_LOGIN_INFO;
    client['clientComponent'](beforeLogin);
    expect(beforeLogin.text).not.toContain('NaN days ago');
    const login = packet();
    login.p2_alt1(11);
    login.p2_alt3(0x1234);
    login.p2(0x2345);
    login.p2(0x3456);
    login.p2_alt1(20000);
    login.p2_alt2(4);
    login.p2_alt2(19999);
    login.p2(30);
    writeG4Alt1(login, 0x12345678);
    login.p2_alt3(19998);
    login.p1_alt1(128);
    installInput(client, login);

    expect(client['handleLastLoginInfo']()).toBe(true);
    expectConsumed(client);
    const state = getClient377State(client);
    expect(dnsLookupRequests).toEqual(['18.52.86.120']);
    expect(client['daysSinceLastLogin']).toBe(1);
    expect(client['lastAddress']).toBe(0x12345678);
    expect(state.daysSincePasswordChanged).toBe(11);
    expect(state.currentDay).toBe(20000);
    expect(state.previousLoginDay).toBe(19999);
    expect(client['unreadMessages']).toBe(4);
    expect(state.daysOfMembersRemaining).toBe(30);
    expect(state.recoveriesLastChangedDay).toBe(19998);
    expect(client['getDateString'](19998)).toBe('28-Nov-2056');
    expect(client['getDateString'](20011)).toBe('Unknown');

    const component = new IfType();
    component.clientCode = ClientCode.CC_LAST_LOGIN_INFO;
    IfType.list[0] = component;
    client['clientComponent'](component);
    expect(component.text).toBe('You last logged in @red@yesterday@bla@ from: @red@18.52.86.120');

    component.clientCode = ClientCode.CC_MEMBERS_CREDIT;
    Client.memServer = false;
    client['clientComponent'](component);
    expect(component.text).toBe('This is a non-members\\nworld. To enjoy your\\nmembers benefits we\\nrecommend you play on a\\nmembers world instead.');

    Client.memServer = true;
    client['clientComponent'](component);
    expect(component.text).toBe('\\n\\nYou have @gre@30@yel@ days of\\nmember credit remaining.');

    component.clientCode = ClientCode.CC_MOD_MUTE;
    client['staffmodlevel'] = 1;
    client['reportAbuseMuteOption'] = false;
    client['clientComponent'](component);
    expect(component.text).toBe('Moderator option: Mute player for 48 hours: <OFF>');
});

test('IF open and tab handlers decode modal and icon state in Java field order', () => {
    IfType.list = [];

    const openChat = clientFixture({ sideModalId: 10, mainModalId: 11, chatModalId: 12 });
    Object.assign(getClient377State(openChat), {
        fullscreenInterfaceId0: 13,
        fullscreenInterfaceId1: 14
    });
    const chatFrame = packet();
    chatFrame.p2(0x1234);
    installInput(openChat, chatFrame);
    expect(openChat['handleIfOpenChat']()).toBe(true);
    expectConsumed(openChat);
    expect([openChat['chatModalId'], openChat['sideModalId'], openChat['mainModalId']]).toEqual([0x1234, -1, -1]);
    expect([
        getClient377State(openChat).fullscreenInterfaceId0,
        getClient377State(openChat).fullscreenInterfaceId1
    ]).toEqual([-1, -1]);

    const mainSide = clientFixture({ chatModalId: 12, dialogInputOpen: true });
    Object.assign(getClient377State(mainSide), {
        fullscreenInterfaceId0: 13,
        fullscreenInterfaceId1: 14,
        chatbackInputOpen: 2
    });
    const mainSideFrame = packet();
    mainSideFrame.p2_alt2(0x2345);
    mainSideFrame.p2_alt3(0x4567);
    installInput(mainSide, mainSideFrame);
    expect(mainSide['handleIfOpenMainSide']()).toBe(true);
    expectConsumed(mainSide);
    expect([mainSide['mainModalId'], mainSide['sideModalId'], mainSide['chatModalId']]).toEqual([0x2345, 0x4567, -1]);
    expect(getClient377State(mainSide).chatbackInputOpen).toBe(0);

    const icon = clientFixture();
    const iconFrame = packet();
    iconFrame.p1_alt3(6);
    iconFrame.p2_alt2(0x3456);
    installInput(icon, iconFrame);
    expect(icon['handleIfSetIcon']()).toBe(true);
    expectConsumed(icon);
    expect(icon['sideIcon'][6]).toBe(0x3456);

    const main = clientFixture();
    const mainFrame = packet();
    mainFrame.p2_alt3(0x5678);
    installInput(main, mainFrame);
    expect(main['handleIfOpenMain']()).toBe(true);
    expectConsumed(main);
    expect(main['mainModalId']).toBe(0x5678);

    const side = clientFixture();
    const sideFrame = packet();
    sideFrame.p2_alt3(0x6789);
    installInput(side, sideFrame);
    expect(side['handleIfOpenSide']()).toBe(true);
    expectConsumed(side);
    expect(side['sideModalId']).toBe(0x6789);

    const show = clientFixture();
    const showFrame = packet();
    showFrame.p1_alt2(9);
    installInput(show, showFrame);
    expect(show['handleIfShowIcon']()).toBe(true);
    expectConsumed(show);
    expect(show['activeIcon']).toBe(9);

    const overlay = clientFixture();
    const overlayFrame = packet();
    overlayFrame.p2(0x2345);
    installInput(overlay, overlayFrame);
    expect(overlay['handleIfOpenOverlay']()).toBe(true);
    expectConsumed(overlay);
    expect(overlay['mainOverlayId']).toBe(0x2345);
});

test('IF component handlers apply transformed fields to the decoded component', () => {
    IfType.list = [];
    const client = clientFixture();
    const component = installComponent(100, { type: 0, modelAnim: 8, modelXAn: 0, modelYAn: 0 });

    const hide = packet();
    hide.p1(1);
    hide.p2(100);
    installInput(client, hide);
    expect(client['handleIfSetHide']()).toBe(true);
    expectConsumed(client);
    expect(component.hide).toBe(true);

    const object = packet();
    object.p2(0x3456);
    object.p2_alt1(65535);
    object.p2_alt3(100);
    installInput(client, object);
    expect(client['handleIfSetObject']()).toBe(true);
    expectConsumed(client);
    expect(component.model1Type).toBe(0);

    const model = packet();
    model.p2_alt3(0x2345);
    model.p2_alt3(100);
    installInput(client, model);
    expect(client['handleIfSetModel']()).toBe(true);
    expectConsumed(client);
    expect([component.model1Type, component.model1Id]).toEqual([1, 0x2345]);

    const animation = packet();
    animation.p2_alt3(100);
    animation.p2_alt2(0x3456);
    installInput(client, animation);
    expect(client['handleIfSetAnim']()).toBe(true);
    expectConsumed(client);
    expect([component.modelAnim, component.animFrame, component.animCycle]).toEqual([0x3456, 0, 0]);

    const npcHead = packet();
    npcHead.p2_alt2(0x1234);
    npcHead.p2_alt1(100);
    installInput(client, npcHead);
    expect(client['handleIfSetNpcHead']()).toBe(true);
    expectConsumed(client);
    expect([component.model1Type, component.model1Id]).toEqual([2, 0x1234]);

    const position = packet();
    position.p2_alt1(0x4567);
    position.p2_alt1(0x2345);
    position.p2(100);
    installInput(client, position);
    expect(client['handleIfSetPosition']()).toBe(true);
    expectConsumed(client);
    expect([component.x, component.y]).toEqual([0x2345, 0x4567]);

    component.scrollHeight = 5000;
    component.height = 100;
    const scroll = packet();
    scroll.p2(100);
    scroll.p2_alt3(0x1234);
    installInput(client, scroll);
    expect(client['handleIfSetScrollPos']()).toBe(true);
    expectConsumed(client);
    expect(component.scrollPos).toBe(0x1234);

    const angle = packet();
    angle.p2_alt2(0x1234);
    angle.p2_alt3(100);
    angle.p2_alt2(0x3456);
    angle.p2_alt1(0x5678);
    installInput(client, angle);
    expect(client['handleIfSetAngle']()).toBe(true);
    expectConsumed(client);
    expect([component.modelXAn, component.modelZoom, component.modelYAn]).toEqual([0x1234, 0x3456, 0x5678]);
});

test('tutorial, ignore-list, player-operation and status handlers decode wire fields', () => {
    const client = clientFixture({
        activeIcon: 3,
        minimapFlagX: 88,
        players: [{ primaryAnim: 40 }, null],
        npc: [{ primaryAnim: 41 }, null]
    });

    const flash = packet();
    flash.p1(3);
    installInput(client, flash);
    expect(client['handleTutFlash']()).toBe(true);
    expectConsumed(client);
    expect([client['tutFlashIcon'], client['activeIcon']]).toEqual([3, 1]);

    const tutOpen = packet();
    tutOpen.p2_alt1(0x2345);
    installInput(client, tutOpen);
    expect(client['handleTutOpen']()).toBe(true);
    expectConsumed(client);
    expect(client['tutComId']).toBe(0x2345);

    const ignoreOne = JString.toUserhash('Alice');
    const ignoreTwo = JString.toUserhash('Bob');
    const ignoreList = packet();
    ignoreList.p8(ignoreOne);
    ignoreList.p8(ignoreTwo);
    installInput(client, ignoreList);
    expect(client['handleUpdateIgnoreList']()).toBe(true);
    expectConsumed(client);
    expect(client['ignoreCount']).toBe(2);
    expect(client['ignoreUserhash'].slice(0, 2)).toEqual([ignoreOne, ignoreTwo]);

    installInput(client, packet());
    expect(client['handleUnsetMapFlag']()).toBe(true);
    expectConsumed(client);
    expect(client['minimapFlagX']).toBe(0);

    const weight = packet();
    weight.p2(0xfffe);
    installInput(client, weight);
    expect(client['handleUpdateRunWeight']()).toBe(true);
    expectConsumed(client);
    expect(client['runweight']).toBe(-2);

    const reboot = packet();
    reboot.p2_alt1(12);
    installInput(client, reboot);
    expect(client['handleUpdateRebootTimer']()).toBe(true);
    expectConsumed(client);
    expect(client['rebootTimer']).toBe(360);

    const energy = packet();
    energy.p1(83);
    installInput(client, energy);
    expect(client['handleUpdateRunEnergy']()).toBe(true);
    expectConsumed(client);
    expect(client['runenergy']).toBe(83);

    installInput(client, packet());
    expect(client['handleResetAnims']()).toBe(true);
    expectConsumed(client);
    expect(client['players'][0]?.primaryAnim).toBe(-1);
    expect(client['npc'][0]?.primaryAnim).toBe(-1);

    const pid = packet();
    pid.p1(1);
    pid.p2_alt1(0x3456);
    installInput(client, pid);
    expect(client['handleUpdatePid']()).toBe(true);
    expectConsumed(client);
    expect([client['membersAccount'], client['selfSlot']]).toEqual([1, 0x3456]);

    const multiway = packet();
    multiway.p1(1);
    installInput(client, multiway);
    expect(client['handleSetMultiway']()).toBe(true);
    expectConsumed(client);
    expect(client['inMultizone']).toBe(1);

    const playerOp = packet();
    playerOp.p1_alt2(4);
    playerOp.pjstr('Trade');
    playerOp.p1(0);
    installInput(client, playerOp);
    expect(client['handleSetPlayerOp']()).toBe(true);
    expectConsumed(client);
    expect([client['playerOp'][3], client['playerOpPriority'][3]]).toEqual(['Trade', true]);

    const minimap = packet();
    minimap.p1(2);
    installInput(client, minimap);
    expect(client['handleMinimapToggle']()).toBe(true);
    expectConsumed(client);
    expect(client['minimapState']).toBe(2);
});

test('private message handler reads the full Java frame and stores its message id', () => {
    const messages: [number, string, string][] = [];
    const client = clientFixture({
        chatDisabled: 0,
        addChat: (type: number, text: string, name: string): void => { messages.push([type, text, name]); }
    });
    const message = packet();
    message.p8(JString.toUserhash('Alice'));
    message.p4(0x12345678);
    message.p1(1);
    WordPack.pack(message, 'hello');
    installInput(client, message);

    expect(client['handleMessagePrivate']()).toBe(true);
    expectConsumed(client);
    expect(client['privateMessageIds'][0]).toBe(0x12345678);
    expect(client['privateMessageCount']).toBe(1);
    expect(messages).toEqual([[7, 'Hello', '@cr1@Alice']]);
});

test('camera and jingle handlers decode transformed camera and audio fields', () => {
    Client.lowMem = false;
    const requests: [number, number][] = [];
    const client = clientFixture({
        onDemand: { request: (archive: number, file: number): void => { requests.push([archive, file]); } },
        midiActive: true,
        camLookAtRate2: 0,
        camMoveToRate2: 0
    });

    const look = packet();
    look.p1(11);
    look.p1(22);
    look.p2(0x1234);
    look.p1(33);
    look.p1(99);
    installInput(client, look);
    expect(client['handleCamLookAt']()).toBe(true);
    expectConsumed(client);
    expect([client['camLookAtLx'], client['camLookAtLz'], client['camLookAtHei'], client['camLookAtRate'], client['camLookAtRate2']]).toEqual([11, 22, 0x1234, 33, 99]);

    const move = packet();
    move.p1(44);
    move.p1(55);
    move.p2(0x2345);
    move.p1(66);
    move.p1(98);
    installInput(client, move);
    expect(client['handleCamMoveTo']()).toBe(true);
    expectConsumed(client);
    expect([client['camMoveToLx'], client['camMoveToLz'], client['camMoveToHei'], client['camMoveToRate'], client['camMoveToRate2']]).toEqual([44, 55, 0x2345, 66, 98]);

    const jingle = packet();
    jingle.p2_alt1(0x3456);
    writeG3Alt3(jingle, 0x456789);
    installInput(client, jingle);
    expect(client['handleMidiJingle']()).toBe(true);
    expectConsumed(client);
    expect([client['midiSong'], client['midiFading'], client['nextMusicDelay']]).toEqual([0x3456, false, 0x456789]);
    expect(requests).toEqual([[2, 0x3456]]);

    client['cinemaCam'] = true;
    client['camShake'].fill(true);
    installInput(client, packet());
    expect(client['handleCamReset']()).toBe(true);
    expectConsumed(client);
    expect(client['cinemaCam']).toBe(false);
    expect(client['camShake']).toEqual(new Array(5).fill(false));
});

test('getIfVar opcode 4 queries object membership at the script object id', () => {
    IfType.list = [];
    const client = clientFixture();
    const component = installComponent(100, {
        scripts: [new Uint16Array([4, 100, 17, 0])],
        linkObjType: new Int32Array([18]),
        linkObjNumber: new Int32Array([5])
    });
    const type = Object.assign(new ObjType(), { members: false });
    const lookups: number[] = [];
    const originalList = ObjType.list;
    const originalDefinitionCount = ObjType.numDefinitions;
    ObjType.numDefinitions = 100;
    ObjType.list = (id: number): ObjType => {
        lookups.push(id);
        return type;
    };
    try {
        expect(client['getIfVar'](component, 0)).toBe(5);
        expect(lookups).toEqual([17]);
    } finally {
        ObjType.list = originalList;
        ObjType.numDefinitions = originalDefinitionCount;
    }
});

test('low-memory music varp changes state without requesting MIDI', () => {
    VarpType.list = [];
    VarpType.list[168] = Object.assign(new VarpType(), { clientcode: 3 });
    Client.lowMem = true;
    const requests: [number, number][] = [];
    const client = clientFixture({
        midiActive: false,
        nextMidiSong: 321,
        nextMusicDelay: 77,
        onDemand: { request: (archive: number, file: number): void => { requests.push([archive, file]); } }
    });
    client['var'][168] = 0;

    client['clientVar'](168);
    expect(client['midiActive']).toBe(true);
    expect(requests).toEqual([]);
    expect(client['nextMusicDelay']).toBe(77);
});

test('social client buttons reset chatback state and report rule 13 uses code 12', () => {
    const actions = [
        [ClientCode.CC_ADD_FRIEND, 1],
        [ClientCode.CC_DEL_FRIEND, 2],
        [ClientCode.CC_ADD_IGNORE, 4],
        [ClientCode.CC_DEL_IGNORE, 5]
    ] as const;
    for (const [clientCode, inputType] of actions) {
        const client = clientFixture({ friendServerStatus: 2, dialogInputOpen: true });
        getClient377State(client).chatbackInputOpen = 2;
        const component = new IfType();
        component.clientCode = clientCode;
        client['clientButton'](component);
        expect(getClient377State(client).chatbackInputOpen).toBe(0);
        expect(client['dialogInputOpen']).toBe(false);
        expect(client['socialInputOpen']).toBe(true);
        expect(client['socialInputType']).toBe(inputType);
    }

    const reportClient = clientFixture({ reportAbuseInput: 'Alice', reportAbuseMuteOption: true });
    const report = new IfType();
    report.clientCode = ClientCode.CC_REPORT_RULE13;
    reportClient['clientButton'](report);
    expect(ClientCode.CC_REPORT_RULE13).toBe(613);
    expect(reportClient['out'].pos).toBe(12);
    expect(reportClient['out'].data[10]).toBe(12);
    expect(reportClient['out'].data[11]).toBe(1);
});

test('closeModal clears full-screen interface state', () => {
    const client = clientFixture({ sideModalId: 1, chatModalId: 2, mainModalId: 3 });
    Object.assign(getClient377State(client), { fullscreenInterfaceId0: 4, fullscreenInterfaceId1: 5 });

    client['closeModal']();

    expect(client['out'].pos).toBe(1);
    expect([getClient377State(client).fullscreenInterfaceId0, getClient377State(client).fullscreenInterfaceId1]).toEqual([-1, -1]);
    expect(client['redrawFrame']).toBe(true);
});

test('entityOverlays dispatches every 377 chat effect to its Java renderer', () => {
    for (const [effect, expected] of [
        [2, 'wave2'],
        [3, 'shake'],
        [4, 'draw'],
        [5, 'centre']
    ] as const) {
        const calls: string[] = [];
        const font = {
            height: 12,
            stringWid: (): number => 40,
            centreStringWave2: (): void => { calls.push('wave2'); },
            centreStringShake: (): void => { calls.push('shake'); },
            drawString: (): void => { calls.push('draw'); },
            centreString: (): void => { calls.push('centre'); }
        };
        const localPlayer = {
            isReady: (): boolean => true,
            height: 100,
            headiconPk: -1,
            headiconPrayer: -1,
            chatMessage: 'Hello',
            chatColour: 0,
            chatEffect: effect,
            chatTimer: 100,
            combatCycle: 0,
            damageCycles: new Int32Array(4)
        };
        const client = clientFixture({
            b12: font,
            chatEffects: 0,
            chatPublicMode: 0,
            localPlayer,
            playerCount: 0,
            npcCount: 0
        });
        client['getOverlayPosEntity'] = (): void => {
            client['projectX'] = 256;
            client['projectY'] = 160;
        };

        client['entityOverlays']();
        expect(calls).toEqual([expected, expected]);
    }
});
test('IF_OPENFULL consumes its two transformed ids and tolerates the missing overlay', () => {
    IfType.list = [];
    const client = clientFixture({ mainModalId: 3, sideModalId: 4, chatModalId: 5, dialogInputOpen: true });
    Object.assign(getClient377State(client), { fullscreenInterfaceId0: 1, fullscreenInterfaceId1: 2, chatbackInputOpen: 1 });
    const frame = packet();
    frame.p2_alt1(65535);
    frame.p2_alt2(0x3456);
    installInput(client, frame);

    expect(client['handleIfOpenFull']()).toBe(true);
    expectConsumed(client);
    expect([
        getClient377State(client).fullscreenInterfaceId0,
        getClient377State(client).fullscreenInterfaceId1,
        getClient377State(client).chatbackInputOpen
    ]).toEqual([0x3456, 65535, 0]);
    expect([client['mainModalId'], client['sideModalId'], client['chatModalId'], client['dialogInputOpen']]).toEqual([-1, -1, -1, false]);
});

test('animateInterface recurses through every layer and applies saved model rotations', () => {
    IfType.list = [];
    const client = clientFixture();
    const first = installComponent(101, { type: 6, modelXAn: 0, modelYAn: 0 });
    const second = installComponent(100, { type: 6, modelXAn: 0, modelYAn: 0 });
    installComponent(51, { type: 0, children: [101, -1] });
    installComponent(52, { type: 0, children: [100, -1] });
    installComponent(50, { type: 0, children: [51, 52, -1] });
    const state = getClient377State(client);
    state.modelRotateByComponentId.set(101, (1 << 16) + 2);
    state.modelRotateByComponentId.set(100, (1 << 16) + 2);

    expect(client['animateInterface'](50, 3)).toBe(true);
    expect([first.modelXAn, first.modelYAn, second.modelXAn, second.modelYAn]).toEqual([3, 6, 3, 6]);
});
test('camera and audio handlers apply 377 values without invoking renderer or audio backends', () => {
    Client.lowMem = false;
    const client = clientFixture({ waveEnabled: true });
    const shake = packet();
    shake.p1(2);
    shake.p1(7);
    shake.p1(11);
    shake.p1(13);
    installInput(client, shake);
    expect(client['handleCamShake']()).toBe(true);
    expectConsumed(client);
    expect(client['camShake'][2]).toBe(true);
    expect(client['camShakeAxis'][2]).toBe(7);
    expect(client['camShakeRan'][2]).toBe(11);
    expect(client['camShakeAmp'][2]).toBe(13);

    const sound = packet();
    sound.p2(52);
    sound.p1(3);
    sound.p2(7);
    installInput(client, sound);
    expect(client['handleSynthSound']()).toBe(true);
    expectConsumed(client);
    expect(client['waveIds'][0]).toBe(52);
    expect(client['waveLoops'][0]).toBe(3);
    expect(client['waveDelay'][0]).toBe(7 + JagFX.delays[52]);
    const queueOnly = packet();
    queueOnly.p2(0xfffe);
    queueOnly.p1(2);
    queueOnly.p2(65535);
    installInput(client, queueOnly);
    expect(client['handleSynthSound']()).toBe(true);
    expectConsumed(client);
    expect(client['waveIds'][1]).toBe(-2);
    expect(client['waveLoops'][1]).toBe(2);
    expect(client['waveDelay'][1]).toBe(0);

    const song = packet();
    song.p2_alt3(65535);
    installInput(client, song);
    expect(client['handleMidiSong']()).toBe(true);
    expectConsumed(client);
    expect(client['nextMidiSong']).toBe(-1);
});
