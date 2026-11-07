import { afterEach, expect, mock, test } from 'bun:test';
import IfType from '#/client/config/IfType.js';
import JString from '#/client/datastruct/JString.js';
import Packet from '#/client/io/Packet.js';
import { ClientCode } from '#/client/shell/ClientCode.js';
import JagFX from '#/client/sound/JagFX.js';

const dnsLookupRequests: string[] = [];
// Mock before loading Client: WebDns is captured when the module evaluates.
mock.module('#/client/util/WebDns.js', () => ({
    reverseDnsLookup: async (ip: string): Promise<(string | null)[]> => {
        dnsLookupRequests.push(ip);
        return [];
    }
}));
const { Client } = await import('#/client/shell/Client.js');
type ClientInstance = InstanceType<typeof Client>;


const originalInterfaces = IfType.list;
const originalMembersWorld = Client.memServer;
const originalLowMem = Client.lowMem;
afterEach(() => {
    IfType.list = originalInterfaces;
    Client.memServer = originalMembersWorld;
    Client.lowMem = originalLowMem;
    dnsLookupRequests.length = 0;
});

type Client377Fixture = ClientInstance & {
    fullscreenInterfaceId0: number;
    fullscreenInterfaceId1: number;
    chatbackInputOpen: number;
    currentDay: number;
    previousLoginDay: number;
    daysSincePasswordChanged: number;
    recoveriesLastChangedDay: number;
    daysOfMembersRemaining: number;
};
function clientFixture(fields: Record<string, unknown> = {}): Client377Fixture {
    return Object.assign(Object.create(Client.prototype), {
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
        fullscreenInterfaceId0: -1,
        fullscreenInterfaceId1: -1,
        chatbackInputOpen: 0,
        var: new Int32Array(4),
        varServ: new Int32Array(4),
        tutComId: -1,
        statBaseLevel: new Int32Array(21),
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
        invUpdateState: new Map(),
        ...fields
    }) as Client377Fixture;
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

function writeG4Alt3(packet: Packet, value: number): void {
    const unsigned = value >>> 0;
    packet.data[packet.pos++] = (unsigned >>> 16) & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 24) & 0xff;
    packet.data[packet.pos++] = unsigned & 0xff;
    packet.data[packet.pos++] = (unsigned >>> 8) & 0xff;
}

test('IF handlers apply transformed text, colour and packed rotation values', () => {
    IfType.list = [];
    const component = IfType.list[100] = new IfType();
    const client = clientFixture();

    const text = packet();
    text.p2_alt3(100);
    text.pjstr('Welcome');
    installInput(client, text);
    expect(client['handleIfSetText']()).toBe(true);
    expect(component.text).toBe('Welcome');

    const colour = packet();
    colour.p2(100);
    colour.p2_alt2(0x7fff);
    installInput(client, colour);
    expect(client['handleIfSetColour']()).toBe(true);
    expect(component.colour).toBe(0xf8f8f8);

    const rotation = packet();
    rotation.p2(0x1234);
    rotation.p2_alt2(100);
    rotation.p2_alt1(0x5678);
    installInput(client, rotation);
    expect(client['handleIfSetRotation']()).toBe(true);
    expect((component as IfType & { modelRotate: number }).modelRotate).toBe(0x12345678);
});
test('IF_CLOSE handler resets modal input state and advances its generation', () => {
    const close = clientFixture({
        modalCloseGeneration: 0,
        mainModalId: 100,
        sideModalId: 101,
        chatModalId: 102,
        fullscreenInterfaceId0: 103,
        fullscreenInterfaceId1: 104,
        dialogInputOpen: true,
        chatbackInputOpen: 1,
        resumedPauseButton: true
    });
    installInput(close, packet());
    expect(close['handleIfClose']()).toBe(true);
    expect(close['modalCloseGeneration']).toBe(1);
    expect([close['mainModalId'], close['sideModalId'], close['chatModalId']]).toEqual([-1, -1, -1]);
    expect([close['fullscreenInterfaceId0'], close['fullscreenInterfaceId1']]).toEqual([-1, -1]);
    expect(close['chatbackInputOpen']).toBe(0);
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
    expect(Array.from(inventory.linkObjType)).toEqual([146, 158, 0]);
    expect(Array.from(inventory.linkObjNumber)).toEqual([3, 7, 0]);

    const partial = packet();
    partial.p2(6963);
    partial.p1(1);
    partial.p2(181);
    partial.p1(4);
    installInput(client, partial);
    expect(client['handleUpdateInvPartial']()).toBe(true);
    expect(Array.from(inventory.linkObjType)).toEqual([146, 181, 0]);
    expect(Array.from(inventory.linkObjNumber)).toEqual([3, 4, 0]);

    const stop = packet();
    stop.p2_alt1(6963);
    installInput(client, stop);
    expect(client['handleUpdateInvStopTransmit']()).toBe(true);
    expect(Array.from(inventory.linkObjType)).toEqual([0, 0, 0]);
    expect(Array.from(inventory.linkObjNumber)).toEqual([0, 0, 0]);
    expect(client['invUpdateState'].get(6963)?.transmitting).toBe(false);
});

test('small, large and sync varp handlers keep client and server values in step', () => {
    const client = clientFixture({ clientVar: (): void => {} });

    const small = packet();
    small.p2_alt2(1);
    small.p1_alt3(-2);
    installInput(client, small);
    expect(client['handleVarpSmall']()).toBe(true);
    expect(client['var'][1]).toBe(-2);
    expect(client['varServ'][1]).toBe(-2);

    const large = packet();
    writeG4Alt3(large, 0x12345678);
    large.p2_alt1(2);
    installInput(client, large);
    expect(client['handleVarpLarge']()).toBe(true);
    expect(client['var'][2]).toBe(0x12345678);
    expect(client['varServ'][2]).toBe(0x12345678);

    client['varServ'][3] = 17;
    installInput(client, packet());
    expect(client['handleVarpSync']()).toBe(true);
    expect(client['var'][3]).toBe(17);
});

test('UPDATE_STAT applies the transformed skill index, level, experience and generation', () => {
    const client = clientFixture();
    const stat = packet();
    stat.p1_alt2(18);
    stat.p1(42);
    stat.p4(987654);
    installInput(client, stat);

    expect(client['handleUpdateStat']()).toBe(true);
    expect(client['statBaseLevel'][18]).toBe(42);
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
    expect(messages).toEqual([[0, 'A challenger appears', '']]);

    const filter = packet();
    filter.p1(2);
    filter.p1(1);
    filter.p1(0);
    installInput(client, filter);
    expect(client['handleChatFilterSettings']()).toBe(true);
    expect([client['chatPublicMode'], client['chatPrivateMode'], client['chatTradeMode']]).toEqual([2, 1, 0]);
    expect(client['redrawChatMode']).toBe(true);
});

test('friend-list and social-dialog handlers update social UI state', () => {
    const client = clientFixture({ socialInputOpen: true, dialogInputOpen: false });

    const loaded = packet();
    loaded.p1(2);
    installInput(client, loaded);
    expect(client['handleFriendListLoaded']()).toBe(true);
    expect(client['friendServerStatus']).toBe(2);

    const username = JString.toUserhash('Friend');
    const friend = packet();
    friend.p8(username);
    friend.p1(Client.nodeId);
    installInput(client, friend);
    expect(client['handleUpdateFriendList']()).toBe(true);
    expect(client['friendCount']).toBe(1);
    expect(client['friendUserhash'][0]).toBe(username);
    expect(client['friendUsername'][0]).toBe('Friend');
    expect(client['friendNodeId'][0]).toBe(Client.nodeId);

    installInput(client, packet());
    expect(client['handlePCountDialog']()).toBe(true);
    expect(client['socialInputOpen']).toBe(false);
    expect(client['chatbackInputOpen']).toBe(1);
    expect(client['dialogInputOpen']).toBe(true);

    installInput(client, packet());
    expect(client['handlePNamedialog']()).toBe(true);
    expect(client['chatbackInputOpen']).toBe(2);
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
    expect(client['hintType']).toBe(1);
    expect(client['hintNpc']).toBe(321);
    expect(client['in'].pos).toBe(6);
});

test('LAST_LOGIN_INFO applies 377 account fields and Java member-world content', () => {
    IfType.list = [];
    const client = clientFixture();
    const login = packet();
    login.p2_alt1(11);
    login.p2_alt3(0);
    login.p2(0);
    login.p2(0);
    login.p2_alt1(20000);
    login.p2_alt2(4);
    login.p2_alt2(19999);
    login.p2(30);
    login.pdata(Uint8Array.of(0, 0, 0, 0), 0, 4);
    login.p2_alt3(19998);
    login.p1(128);
    installInput(client, login);

    expect(client['handleLastLoginInfo']()).toBe(true);
    expect(dnsLookupRequests).toEqual(['0.0.0.0']);
    expect(client['daysSincePasswordChanged']).toBe(11);
    expect(client['currentDay']).toBe(20000);
    expect(client['previousLoginDay']).toBe(19999);
    expect(client['unreadMessages']).toBe(4);
    expect(client['daysOfMembersRemaining']).toBe(30);
    expect(client['recoveriesLastChangedDay']).toBe(19998);
    expect(client['getDateString'](19998)).toBe('28-Nov-2056');
    expect(client['getDateString'](20011)).toBe('Unknown');

    const component = new IfType();
    component.clientCode = ClientCode.CC_LAST_LOGIN_INFO;
    IfType.list[0] = component;
    client['clientComponent'](component);
    expect(component.text).toBe('You last logged in @red@yesterday@bla@ from: @red@0.0.0.0');

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
    expect(client['waveIds'][0]).toBe(52);
    expect(client['waveLoops'][0]).toBe(3);
    expect(client['waveDelay'][0]).toBe(7 + JagFX.delays[52]);

    const song = packet();
    song.p2_alt3(65535);
    installInput(client, song);
    expect(client['handleMidiSong']()).toBe(true);
    expect(client['nextMidiSong']).toBe(-1);
});
