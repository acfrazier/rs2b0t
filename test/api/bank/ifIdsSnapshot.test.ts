import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { ARRANGE_INSERT_COM, ARRANGE_SWAP_COM, BANK_INSERT_VARP } from '#/bot/api/bank/bankSort.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { IF_IDS } from '#/bot/data/ifIds.js';

import { loadInterfaceSnapshot, snapshotComponent, snapshotId } from '../ifids/interfaceSnapshot.js';

const originals = {
    ifButton: actions.ifButton,
    bankComId: reader.bankComId,
    delayTicks: Execution.delayTicks
};
const sent: number[] = [];

afterEach(() => {
    actions.ifButton = originals.ifButton;
    reader.bankComId = originals.bankComId;
    Execution.delayTicks = originals.delayTicks;
    sent.length = 0;
});

function bankRoot(): number {
    return snapshotComponent(IF_IDS.BANK_MAIN_COM_93).layerId;
}

describe('bank component ids against the replay interface snapshot', () => {
    test('note, item, swap and insert are children of the recorded bank root', () => {
        expect(snapshotId('bank_main:com_93')).toBe(IF_IDS.BANK_MAIN_COM_93);
        expect(snapshotId('bank_main:com_94')).toBe(IF_IDS.BANK_MAIN_COM_94);
        expect(snapshotId('bank_main:com_99')).toBe(IF_IDS.BANK_MAIN_COM_99);
        expect(snapshotId('bank_main:com_100')).toBe(IF_IDS.BANK_MAIN_COM_100);

        const root = snapshotComponent(bankRoot());
        const children = root.children ?? [];
        for (const id of [
            IF_IDS.BANK_MAIN_COM_93,
            IF_IDS.BANK_MAIN_COM_94,
            IF_IDS.BANK_MAIN_COM_99,
            IF_IDS.BANK_MAIN_COM_100
        ]) {
            expect(children).toContain(id);
            expect(snapshotComponent(id).layerId).toBe(bankRoot());
        }
    });

    test('setNoteMode sends the snapshot Note and Item buttons', async () => {
        reader.bankComId = () => bankRoot();
        Execution.delayTicks = async () => {};
        actions.ifButton = (comId: number) => {
            sent.push(comId);
            return true;
        };

        await Bank.setNoteMode(true);
        await Bank.setNoteMode(false);

        expect(sent).toEqual([IF_IDS.BANK_MAIN_COM_93, IF_IDS.BANK_MAIN_COM_94]);
    });

    test('the arrange buttons are snapshot components while the insert varp is not', () => {
        expect(snapshotId('bank_main:com_99')).toBe(ARRANGE_SWAP_COM);
        expect(snapshotId('bank_main:com_100')).toBe(ARRANGE_INSERT_COM);
        expect(snapshotComponent(ARRANGE_SWAP_COM).layerId).toBe(bankRoot());
        expect(snapshotComponent(ARRANGE_INSERT_COM).layerId).toBe(bankRoot());
        expect(loadInterfaceSnapshot().components[String(BANK_INSERT_VARP)]).toBeUndefined();
    });
});
