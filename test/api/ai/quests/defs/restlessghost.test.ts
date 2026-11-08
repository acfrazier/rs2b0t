import { expect, test, describe } from 'bun:test';
import { decide } from '#/bot/api/ai/quests/defs/restlessghost.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const snap = (journal: string, inv: string[] = [], worn: string[] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv.map(n => [n, 1])),
    worn: new Set(worn),
    noProgress: 0,
    bankCoins: 0,
    bankKnown: true,
    bank: new Map(),
    bankIds: new Map()
});

describe('restlessghost decide', () => {
    test('ends and start', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Aereck');
    });
    test('no amulet anywhere -> Urhney (also the lost-amulet recovery)', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Urhney');
    });
    test('reads an unknown bank before asking Urhney to replace an amulet', () => {
        expect(decide({ ...snap('inProgress'), bankKnown: false })).toMatchObject({ kind: 'scanBank' });
    });
    test('withdraws the banked amulet by ID, then equips it', () => {
        const banked = { ...snap('inProgress'), bankIds: new Map([[552, 1]]) };
        expect(decide(banked)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Ghostspeak amulet', id: 552, qty: 1 }] });
        expect(decide({ ...banked, inv: new Map([['ghostspeak amulet', 1]]) })).toEqual({ kind: 'equip', item: 'Ghostspeak amulet' });
    });
    test('a held or worn amulet does not cause a bank scan', () => {
        expect(decide({ ...snap('inProgress', ['ghostspeak amulet']), bankKnown: false }).kind).toBe('equip');
        const step = decide({ ...snap('inProgress', [], ['ghostspeak amulet']), bankKnown: false });
        expect(step.kind === 'custom' && step.name).toBe('ghost + skull');
    });
    test('amulet in pack but not worn -> equip', () => {
        expect(decide(snap('inProgress', ['ghostspeak amulet'])).kind).toBe('equip');
    });
    test('amulet worn, no skull -> ghost+skull custom', () => {
        const s = decide(snap('inProgress', [], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('ghost + skull');
    });
    // 377 (content cb6cc5ea1) pack/obj.pack:554 `553=ghostskull`; pack/obj.pack:965 `964=skull` shares the name.
    test('quest skull held (obj 553) -> return-to-coffin custom (works regardless of worn state)', () => {
        const s = decide({ ...snap('inProgress', ['skull'], ['ghostspeak amulet']), invIds: new Map([[553, 1]]) });
        expect(s.kind === 'custom' && s.name).toBe('return skull');
        const unworn = decide({ ...snap('inProgress', ['skull']), invIds: new Map([[553, 1]]) });
        expect(unworn.kind === 'custom' && unworn.name).toBe('return skull');
    });
    test('the generic same-named skull (obj 964) is not the quest skull', () => {
        const s = decide({ ...snap('inProgress', ['skull'], ['ghostspeak amulet']), invIds: new Map([[964, 1]]) });
        expect(s.kind === 'custom' && s.name).toBe('ghost + skull');
        expect(decide({ ...snap('inProgress', ['skull']), invIds: new Map([[964, 1]]) })).toMatchObject({ kind: 'talk', stop: { npc: 'Father Urhney' } });
    });
});

describe('restlessghost return skull', () => {
    // 377 (content cb6cc5ea1) quest_priest.rs2:55-63 [oplocu,restless_ghost_altar]: three mesbox pages, and inv_del (:56) runs only after the first is continued.
    test('continues "You put the skull in the coffin." and the two pages after it; the skull leaves the pack after the first', async () => {
        const skull = new InvItem({ slot: 0, id: 553, name: 'Skull', count: 1, ops: ['Drop'], comId: 3214 });
        const events: string[] = [];
        let held = true;
        let pages = 0;
        const restore = [
            stubProps(Game, { tile: () => ({ x: 3250, z: 3193, level: 0 }) }),
            stubProps(EventSignal, { pending: () => false }),
            // The open form `restless_ghost_altar`, loc 2146 (pack/loc.pack:2147): Close and Search, no Open.
            stubProps(reader, { locs: () => [{ typecode: 0, id: 2146, name: 'Coffin', tile: { x: 3249, z: 3192, level: 0 }, ops: ['Close', 'Search'], distance: 2 }] }),
            stubProps(Inventory, { items: () => (held ? [skull] : []), countById: id => (held && id === 553 ? 1 : 0) }),
            stubProps(skull, { useOn: async target => { events.push(`use on ${target.id}`); pages = 3; return true; } }),
            stubProps(ChatDialog, {
                isOpen: () => pages > 0,
                canContinue: () => pages > 0,
                options: () => [],
                continue: async () => {
                    events.push(`continue ${pages} ${held ? 'held' : 'gone'}`);
                    pages--;
                    if (pages === 2) held = false;
                    return true;
                }
            }),
            stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
        ];
        try {
            const step = decide({ ...snap('inProgress', ['skull'], ['ghostspeak amulet']), invIds: new Map([[553, 1]]) });
            if (step.kind !== 'custom') throw new Error('expected the return skull step');
            expect(await step.run(() => {})).toBe(true);
            expect(events).toEqual(['use on 2146', 'continue 3 held', 'continue 2 gone', 'continue 1 gone']);
        } finally { restore.reverse().forEach(fn => fn()); }
    });
});
