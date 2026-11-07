import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { Client } = await import('#/client/shell/Client.js');
const { default: NpcType } = await import('#/client/config/NpcType.js');
const { default: ClientNpc } = await import('#/client/dash3d/ClientNpc.js');
const { default: Model } = await import('#/client/dash3d/Model.js');
const { Int32Array2d } = await import('#/client/util/Arrays.js');
const { MiniMenuAction } = await import('#/client/shell/MiniMenuAction.js');
const { default: OnDemandRequest } = await import('#/client/io/OnDemandRequest.js');

type ClientInstance = InstanceType<typeof Client>;
type Npc = InstanceType<typeof NpcType>;

// Java 377 NpcType: a multinpc wrapper carries no name, ops or level; the resolved form does.
// Fixtures: wrapper 3 morphs on varp 0 to child 9 (slot 0), child 10 (slot 1), hidden (slot 2).
const BASE_ID = 3;
const ACTIVE_CHILD = 9;
const INACTIVE_CHILD = 10;

function type(id: number, fields: Partial<Npc>): Npc {
    return Object.assign(Object.create(NpcType.prototype) as Npc, { id, multinpc: [], multivarbit: -1, multivar: -1, ...fields });
}

const guard = type(ACTIVE_CHILD, {
    name: 'Guard',
    desc: null,
    vislevel: 0,
    op: ['Talk-to', null, null, null, null],
    minimap: true,
    active: true,
    alwaysontop: false,
    size: 1
});
const statue = type(INACTIVE_CHILD, {
    name: 'Statue',
    desc: 'A statue.',
    vislevel: 0,
    op: [null, null, null, null, null],
    minimap: true,
    active: false,
    alwaysontop: false,
    size: 1
});
const wrapper = type(BASE_ID, {
    name: null,
    desc: null,
    vislevel: -1,
    op: null,
    minimap: true,
    active: true,
    alwaysontop: false,
    size: 1,
    multivar: 0,
    multinpc: [ACTIVE_CHILD, INACTIVE_CHILD, -1]
});

const origList = NpcType.list;
beforeEach(() => {
    NpcType.list = (id: number): Npc => (id === ACTIVE_CHILD ? guard : id === INACTIVE_CHILD ? statue : wrapper);
});
afterEach(() => {
    NpcType.list = origList;
});

function client(slot: number, fields: Record<string, unknown> = {}): ClientInstance {
    return Object.assign(Object.create(Client.prototype), {
        var: [slot],
        menuNumEntries: 0,
        menuOption: [],
        menuAction: [],
        menuParamA: [],
        menuParamB: [],
        menuParamC: [],
        useMode: 0,
        targetMode: 0,
        localPlayer: { combatLevel: 3 },
        ...fields
    }) as ClientInstance;
}

function npcAt(npcType: Npc): InstanceType<typeof ClientNpc> {
    const npc = new ClientNpc();
    npc.type = npcType;
    npc.x = 64 + 128 * 5;
    npc.z = 64 + 128 * 6;
    npc.size = 1;
    return npc;
}

describe('multinpc sites (Java 377 Client.java 6071-6078, 10318-10323, 10521-10530, 12286-12294)', () => {
    describe('addNpcOptions', () => {
        test('a visible form lists its own ops and name, never the wrapper nulls', () => {
            const c = client(0);
            c['addNpcOptions'](wrapper, 7, 5, 6);
            expect(c['menuOption'].slice(0, c['menuNumEntries'])).toEqual(['Talk-to @yel@Guard', 'Examine @yel@Guard']);
            expect(Array.from(c['menuAction'].slice(0, 2))).toEqual([MiniMenuAction.OP_NPC1, MiniMenuAction.OP_NPC6]);
        });

        test('a hidden form adds no option', () => {
            const c = client(2);
            c['addNpcOptions'](wrapper, 7, 5, 6);
            expect(c['menuNumEntries']).toBe(0);
        });

        test('a form with active false adds no option', () => {
            const c = client(1);
            c['addNpcOptions'](wrapper, 7, 5, 6);
            expect(c['menuNumEntries']).toBe(0);
        });
    });

    describe('doAction examine (OP_NPC6)', () => {
        function examine(slot: number): string[] {
            const messages: string[] = [];
            const npc = npcAt(wrapper);
            const c = client(slot, {
                npc: { 7: npc },
                menuNumEntries: 1,
                menuAction: [MiniMenuAction.OP_NPC6],
                menuParamA: [7],
                menuParamB: [0],
                menuParamC: [0],
                addChat: (_type: number, text: string): void => {
                    messages.push(text);
                }
            });
            c['doAction'](0);
            return messages;
        }

        test('examine prints the resolved form, not "It\'s a null."', () => {
            expect(examine(0)).toEqual(["It's a Guard."]);
            expect(examine(1)).toEqual(['A statue.']);
        });

        test('a hidden form prints nothing', () => {
            expect(examine(2)).toEqual([]);
        });
    });

    describe('addNpcs', () => {
        function draw(slot: number, base: Npc): { calls: number[]; occupied: number } {
            const calls: number[] = [];
            const npc = npcAt(base);
            const c = client(slot, {
                npc: { 7: npc },
                npcIds: [7],
                npcCount: 1,
                sceneCycle: 4,
                minusedlevel: 0,
                tileLastOccupiedCycle: new Int32Array2d(104, 104),
                getAvH: (): number => 0,
                world: {
                    addDynamic: (_level: number, _x: number, _y: number, _z: number, _model: unknown, typecode: number): boolean => {
                        calls.push(typecode);
                        return true;
                    }
                }
            });
            c['addNpcs'](false);
            return { calls, occupied: c['tileLastOccupiedCycle'][5][6] };
        }

        test('a hidden multinpc form is not drawn and does not claim its tile', () => {
            const hidden = draw(2, wrapper);
            expect(hidden.calls).toEqual([]);
            expect(hidden.occupied).toBe(0);
            const shown = draw(0, wrapper);
            expect(shown.calls.length).toBe(1);
            expect(shown.occupied).toBe(4);
        });

        test('a base type with active false loses mouse picking (typecode high bit)', () => {
            const picked = draw(0, wrapper).calls[0];
            expect(picked).toBe((7 << 14) + 0x20000000);
            const inactiveBase = type(20, { ...wrapper, id: 20, active: false });
            const dull = draw(0, inactiveBase).calls[0];
            expect(dull).toBe(((7 << 14) + 0x20000000 + -0x80000000) | 0);
        });
    });

    describe('minimapDraw', () => {
        function dots(slot: number): number {
            let dotCount = 0;
            const npc = npcAt(wrapper);
            const marker = { id: 'mapdots2' };
            const c = client(slot, {
                npc: { 7: npc },
                npcIds: [7],
                npcCount: 1,
                playerCount: 0,
                activeMapFunctionCount: 0,
                minimapState: 0,
                minusedlevel: 0,
                groundObj: [Array.from({ length: 104 }, () => new Array(104).fill(null))],
                mapdots2: marker,
                hintType: 0,
                minimapFlagX: 0,
                localPlayer: { x: 64, z: 64 },
                minimapDrawDot: (_dy: number, image: unknown): void => {
                    if (image === marker) {
                        dotCount++;
                    }
                }
            });
            c['minimapDraw']();
            return dotCount;
        }

        test('a visible active form plots a dot, a hidden or inactive form does not', () => {
            expect(dots(0)).toBe(1);
            expect(dots(1)).toBe(0);
            expect(dots(2)).toBe(0);
        });
    });
});

describe('onDemandLoop null completions (Java 377 updateOnDemand 2535-2578)', () => {
    function requests(...reqs: InstanceType<typeof OnDemandRequest>[]): ClientInstance {
        const queue = [...reqs];
        return client(0, {
            onDemand: {
                run: async (): Promise<void> => {},
                loop: () => queue.shift() ?? null,
                getModelUse: (): number => 0,
                hasMapLocFile: (): boolean => false
            },
            sceneState: 1,
            mapBuildGroundData: [new Uint8Array(1), new Uint8Array(1)],
            mapBuildLocationData: [new Uint8Array(1), new Uint8Array(1)],
            mapBuildGroundFile: [500, 501],
            mapBuildLocationFile: [600, 601]
        });
    }

    function req(archive: number, file: number, data: Uint8Array | null): InstanceType<typeof OnDemandRequest> {
        const r = new OnDemandRequest();
        r.archive = archive;
        r.file = file;
        r.data = data;
        return r;
    }

    test('null map land and loc data marks the file -1 so the scene build stops waiting', async () => {
        const c = requests(req(3, 500, null), req(3, 601, null));
        await c.onDemandLoop();
        expect(c['mapBuildGroundFile']).toEqual([-1, 501]);
        expect(c['mapBuildGroundData']![0]).toBeNull();
        expect(c['mapBuildLocationFile']).toEqual([600, -1]);
        expect(c['mapBuildLocationData']![1]).toBeNull();
    });

    test('real map data is stored and the file keeps its id', async () => {
        const data = Uint8Array.of(1, 2, 3);
        const c = requests(req(3, 501, data));
        await c.onDemandLoop();
        expect(c['mapBuildGroundFile']).toEqual([500, 501]);
        expect(c['mapBuildGroundData']![1]).toBe(data);
    });

    test('null model data installs empty metadata so the model counts as ready', async () => {
        const saved = Model.meta;
        Model.meta = [];
        try {
            const c = requests(req(0, 41, null));
            await c.onDemandLoop();
            expect(Model.meta[41]).toBeDefined();
            expect(Model.meta[41]!.numPoints).toBe(0);
            expect(Model.meta[41]!.numFaces).toBe(0);
        } finally {
            Model.meta = saved;
        }
    });
});
