import { afterEach, describe, expect, test } from 'bun:test';

import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';

import { installInterfaceSnapshot, snapshotComponent } from '../ifids/interfaceSnapshot.js';

/** The equipment tab root and inventory the mainland recording reports through IF_SETICON. */
const EQUIPMENT_TAB = 1644;
const EQUIPMENT_INV = 1688;

let restoreInterfaces: (() => void) | null = null;

afterEach(() => {
    detach();
    restoreInterfaces?.();
    restoreInterfaces = null;
});

function recordedClient(): Record<string, unknown> {
    return {
        statSessionGeneration: 1,
        sideIcon: [-1, -1, -1, -1, EQUIPMENT_TAB, -1],
        mainModalId: -1,
        sideModalId: -1,
        chatModalId: -1,
        resumedPauseButton: false
    };
}

describe('equipment tab against the replay interface snapshot', () => {
    test('the recorded equipment tab contains one inventory component', () => {
        const tab = snapshotComponent(EQUIPMENT_TAB);
        expect(tab.type).toBe(0);
        expect(tab.children).toContain(EQUIPMENT_INV);

        const inventory = snapshotComponent(EQUIPMENT_INV);
        expect(inventory.type).toBe(2);
        expect(inventory.layerId).toBe(EQUIPMENT_TAB);
    });

    test('the adapter resolves the recorded equipment inventory for the noun', () => {
        restoreInterfaces = installInterfaceSnapshot();
        expect(attach(recordedClient())).toContain('tcpIn');

        expect(reader.sideTabInterface(4)).toBe(EQUIPMENT_TAB);
        expect(reader.equipment()).toEqual([]);
        expect(Equipment.items()).toEqual([]);
        expect(Equipment.contains('rune platebody')).toBe(false);
    });
});
