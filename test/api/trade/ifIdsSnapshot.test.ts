import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { IF_IDS } from '#/bot/data/ifIds.js';

import { snapshotComponent, snapshotId } from '../ifids/interfaceSnapshot.js';

const originals = {
    ifButton: actions.ifButton,
    tradeOfferOpen: reader.tradeOfferOpen,
    tradeConfirmOpen: reader.tradeConfirmOpen,
    delayUntil: Execution.delayUntil
};
const sent: number[] = [];

afterEach(() => {
    actions.ifButton = originals.ifButton;
    reader.tradeOfferOpen = originals.tradeOfferOpen;
    reader.tradeConfirmOpen = originals.tradeConfirmOpen;
    Execution.delayUntil = originals.delayUntil;
    sent.length = 0;
});

describe('trade component ids against the replay interface snapshot', () => {
    test('offer, accept and decline are the recorded trade components', () => {
        expect(snapshotId('tradeside:inv')).toBe(IF_IDS.TRADESIDE_INV);
        expect(snapshotId('trademain:inv')).toBe(IF_IDS.TRADEMAIN_INV);
        expect(snapshotId('trademain:accept')).toBe(IF_IDS.TRADEMAIN_ACCEPT);
        expect(snapshotId('trademain:decline')).toBe(IF_IDS.TRADEMAIN_DECLINE);
        expect(snapshotId('tradeconfirm:accept')).toBe(IF_IDS.TRADECONFIRM_ACCEPT);

        const sidePack = snapshotComponent(IF_IDS.TRADESIDE_INV);
        expect(sidePack.type).toBe(2);
        expect(sidePack.ops).toContain('Offer All');

        const offerInv = snapshotComponent(IF_IDS.TRADEMAIN_INV);
        expect(offerInv.type).toBe(2);
        expect(offerInv.layerId).toBe(snapshotComponent(IF_IDS.TRADEMAIN_ACCEPT).layerId);

        expect(snapshotComponent(IF_IDS.TRADEMAIN_ACCEPT).buttonType).toBe(1);
        expect(snapshotComponent(IF_IDS.TRADEMAIN_DECLINE).buttonType).toBe(3);
        expect(snapshotComponent(IF_IDS.TRADECONFIRM_ACCEPT).layerId).toBe(IF_IDS.TRADECONFIRM);
        expect(snapshotComponent(IF_IDS.TRADECONFIRM_ACCEPT).buttonType).toBe(1);
    });

    test('accept clicks the offer or confirm button the snapshot names', async () => {
        actions.ifButton = (comId: number) => {
            sent.push(comId);
            return true;
        };

        reader.tradeConfirmOpen = () => true;
        reader.tradeOfferOpen = () => false;
        expect(await Trade.accept()).toBe(true);
        expect(sent).toEqual([IF_IDS.TRADECONFIRM_ACCEPT]);

        sent.length = 0;
        reader.tradeConfirmOpen = () => false;
        reader.tradeOfferOpen = () => true;
        expect(await Trade.accept()).toBe(true);
        expect(sent).toEqual([IF_IDS.TRADEMAIN_ACCEPT]);
    });

    test('decline clicks the snapshot decline button', async () => {
        actions.ifButton = (comId: number) => {
            sent.push(comId);
            return true;
        };
        Execution.delayUntil = async () => true;

        reader.tradeOfferOpen = () => true;
        reader.tradeConfirmOpen = () => false;
        await Trade.decline();

        expect(sent).toEqual([IF_IDS.TRADEMAIN_DECLINE]);
    });
});
