import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import {
    ATTACKSTYLE_MAGIC_VARP,
    AUTOCAST_ARMED,
    AUTO_CHOOSE_COM,
    AUTO_TOGGLE_COM,
    spellButtonCom
} from '#/bot/api/combat/CombatStyleLogic.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Autocast } from '#/bot/api/magic/Autocast.js';
import { IF_IDS } from '#/bot/data/ifIds.js';

import { snapshotComponent, snapshotId } from '../ifids/interfaceSnapshot.js';

const originals = {
    ifButton: actions.ifButton,
    varp: reader.varp,
    sideTabInterface: reader.sideTabInterface,
    delayUntil: Execution.delayUntil,
    openSideTab: Game.openSideTab
};
const sent: number[] = [];

afterEach(() => {
    actions.ifButton = originals.ifButton;
    reader.varp = originals.varp;
    reader.sideTabInterface = originals.sideTabInterface;
    Execution.delayUntil = originals.delayUntil;
    Game.openSideTab = originals.openSideTab;
    sent.length = 0;
});

describe('magic component ids against the replay interface snapshot', () => {
    test('the staff tab and spell panel are recorded interface roots', () => {
        expect(snapshotId('combat_staff_2')).toBe(IF_IDS.COMBAT_STAFF_2);
        expect(snapshotId('staff_spells')).toBe(IF_IDS.STAFF_SPELLS);

        const staffTab = snapshotComponent(IF_IDS.COMBAT_STAFF_2);
        const spellPanel = snapshotComponent(IF_IDS.STAFF_SPELLS);
        expect(staffTab.type).toBe(0);
        expect(staffTab.layerId).toBe(IF_IDS.COMBAT_STAFF_2);
        expect(staffTab.children?.length).toBeGreaterThan(0);
        expect(spellPanel.type).toBe(0);
        expect(spellPanel.layerId).toBe(IF_IDS.STAFF_SPELLS);
        expect(spellPanel.children?.length).toBeGreaterThan(0);
        expect(IF_IDS.COMBAT_STAFF_2).not.toBe(IF_IDS.STAFF_SPELLS);
    });

    test('staffTabAttached compares the combat tab with the snapshot root', () => {
        reader.sideTabInterface = (tab: number) => (tab === 0 ? IF_IDS.COMBAT_STAFF_2 : -1);
        expect(Autocast.staffTabAttached()).toBe(true);

        reader.sideTabInterface = (tab: number) => (tab === 0 ? IF_IDS.STAFF_SPELLS : -1);
        expect(Autocast.staffTabAttached()).toBe(false);
    });

    test('arm clicks the chooser, the spell button and the toggle', async () => {
        const spell = 'Wind Strike';
        reader.sideTabInterface = (tab: number) => (tab === 0 ? IF_IDS.COMBAT_STAFF_2 : -1);
        reader.varp = (index: number) => (index === ATTACKSTYLE_MAGIC_VARP ? AUTOCAST_ARMED : 0);
        Execution.delayUntil = async () => true;
        Game.openSideTab = async () => true;
        actions.ifButton = (comId: number) => {
            sent.push(comId);
            return true;
        };

        expect(await Autocast.arm(spell, () => {})).toBe(true);
        expect(sent).toEqual([AUTO_CHOOSE_COM, spellButtonCom(spell), AUTO_TOGGLE_COM]);
    });
});
