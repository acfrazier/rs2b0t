import { expect, test } from 'bun:test';

import { movementExtraTicks } from '../../tools/nav/derive-stairs.js';

test('377 stair pricing fails closed for an unpriced movement handler', () => {
    const prices = {
        schemaVersion: 1,
        baseTicks: 1,
        handlers: {}
    } satisfies Parameters<typeof movementExtraTicks>[0];

    expect(() => movementExtraTicks(prices, 'unreviewed_stairs', 1)).toThrow("Unpriced stair movement handler 'unreviewed_stairs'");
});

test('377 stair pricing fails closed for an unpriced option on a known handler', () => {
    const prices = {
        schemaVersion: 1,
        baseTicks: 1,
        handlers: {
            reviewed_stairs: {
                opPrices: { '1': { extraTicks: 2, source: 'reviewed stairs.rs2 option 1' } }
            }
        }
    } satisfies Parameters<typeof movementExtraTicks>[0];

    expect(() => movementExtraTicks(prices, 'reviewed_stairs', 2)).toThrow("Unpriced stair movement handler 'reviewed_stairs' option 2");
});
