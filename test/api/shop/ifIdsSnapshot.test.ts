import { afterEach, describe, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { IF_IDS } from '#/bot/data/ifIds.js';

import { snapshotComponent, snapshotId } from '../ifids/interfaceSnapshot.js';

const originals = {
    modals: reader.modals,
    shopInv: reader.shopInv
};
const readComponents: number[] = [];

afterEach(() => {
    reader.modals = originals.modals;
    reader.shopInv = originals.shopInv;
    readComponents.length = 0;
});

describe('shop component ids against the replay interface snapshot', () => {
    test('the template, stock and player inventories are the recorded shop components', () => {
        expect(snapshotId('shop_template')).toBe(IF_IDS.SHOP_TEMPLATE);
        expect(snapshotId('shop_template:inv')).toBe(IF_IDS.SHOP_TEMPLATE_INV);
        expect(snapshotId('shop_template_side:inv')).toBe(IF_IDS.SHOP_TEMPLATE_SIDE_INV);

        const template = snapshotComponent(IF_IDS.SHOP_TEMPLATE);
        expect(template.type).toBe(0);
        expect(template.children).toContain(IF_IDS.SHOP_TEMPLATE_INV);

        const stock = snapshotComponent(IF_IDS.SHOP_TEMPLATE_INV);
        expect(stock.type).toBe(2);
        expect(stock.layerId).toBe(IF_IDS.SHOP_TEMPLATE);
        expect(stock.ops).toContain('Buy 1');

        const side = snapshotComponent(IF_IDS.SHOP_TEMPLATE_SIDE_INV);
        expect(side.type).toBe(2);
        expect(side.ops).toContain('Sell 1');
        expect(snapshotComponent(side.layerId).children).toContain(IF_IDS.SHOP_TEMPLATE_SIDE_INV);
    });

    test('isOpen and stock read the snapshot components', () => {
        reader.modals = () => ({ main: IF_IDS.SHOP_TEMPLATE, side: -1, chat: -1 });
        reader.shopInv = (comId: number) => {
            readComponents.push(comId);
            return [{ slot: 0, id: 1359, name: 'Rune axe', count: 2, ops: ['Value', 'Buy 1'], comId }];
        };

        expect(Shop.isOpen()).toBe(true);
        expect(Shop.stock()).toEqual([{ name: 'Rune axe', count: 2, slot: 0 }]);
        expect(readComponents).toEqual([IF_IDS.SHOP_TEMPLATE_INV]);

        reader.modals = () => ({ main: IF_IDS.SHOP_TEMPLATE_SIDE_INV, side: -1, chat: -1 });
        expect(Shop.isOpen()).toBe(false);
    });
});
