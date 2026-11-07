import { describe, expect, test } from 'bun:test';

import stairsJson from '#/bot/event/webwalk/data/stairEdges.json';
import transportsJson from '#/bot/event/webwalk/data/transports.json';
import { edgeCostForKind, teleportEdgeCost, ticksToCost } from '#/bot/event/webwalk/geometry/edgeCosts.js';
import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';
import { shiloGateEdges } from '#/bot/event/webwalk/travelCatalog.js';
import { specialRequiresAt } from '#/bot/event/webwalk/specialRequires.js';
import { buildScriptRoutes } from '../../../tools/nav/script-route-corpus.js';
import stairPrices from '../../../tools/nav/stair-prices.json';

const REQUIRED_ROUTES = ['F2P-01', 'F2P-02', 'F2P-03', 'F2P-04', 'F2P-05', 'F2P-06', 'MIZGOG-01'];
type PricedTransportEdge = TransportEdgeData & { extraTicks?: number };

describe('revision-377 offline route corpus', () => {
    test('keeps the six historical mainland legs and Lumbridge-to-Mizgog first in the corpus', () => {
        const routes = buildScriptRoutes({ maxBankPairs: 0 });
        expect(routes.slice(0, REQUIRED_ROUTES.length).map(route => route.id)).toEqual(REQUIRED_ROUTES);

        const mizgog = routes.find(route => route.id === 'MIZGOG-01');
        expect(mizgog).toMatchObject({
            source: 'mainland-routes.json',
            from: { x: 3222, z: 3218, level: 0 },
            to: { x: 3103, z: 3163, level: 2 }
        });
    });

    test('prices the 377 Wizard Tower stairs and quest-gated telejump edges in server ticks', () => {
        const edges = [...(transportsJson as PricedTransportEdge[]), ...(stairsJson as PricedTransportEdge[])];
        const wizardStair = (locId: number, fromLevel: number, action: string) =>
            edges.find(edge => edge.locId === locId && edge.from.level === fromLevel && edge.action === action);
        const lower = wizardStair(12536, 0, 'Climb-up');
        const middle = wizardStair(12537, 1, 'Climb-up');
        const upper = wizardStair(12538, 2, 'Climb-down');

        expect(lower).toMatchObject({
            from: { x: 3105, z: 3160, level: 0 },
            to: { x: 3105, z: 3160, level: 1 },
            kind: 'stair',
            extraTicks: 0
        });
        expect(middle).toMatchObject({
            from: { x: 3103, z: 3161, level: 1 },
            to: { x: 3104, z: 3161, level: 2 },
            kind: 'stair',
            extraTicks: 0
        });
        expect(upper).toMatchObject({
            from: { x: 3104, z: 3161, level: 2 },
            to: { x: 3103, z: 3158, level: 1 },
            kind: 'stair',
            extraTicks: 0
        });
        expect(edgeCostForKind('stair')).toBe(ticksToCost(3));

        const pricedStair = (stairsJson as PricedTransportEdge[]).find(edge => edge.debugName === 'board_game_stairs_base');
        expect(pricedStair).toMatchObject({ locId: 4622, kind: 'stair', extraTicks: 1 });
        expect(stairPrices.baseTicks).toBe(1);
        expect(ticksToCost(stairPrices.baseTicks + stairPrices.handlers.board_game_stairs_base.extraTicks)).toBe(4);

        const shiloTelejump = shiloGateEdges().find(edge => edge.debugName === 'shilo_mosol_leads_in');
        expect(shiloTelejump).toMatchObject({
            from: { x: 2883, z: 2951, level: 0 },
            to: { x: 2866, z: 2952, level: 0 },
            action: 'Talk-to',
            kind: 'ship',
            requires: {
                members: true,
                quests: [{ quest: 'Shilo Village', minStatus: 'complete' }]
            }
        });
        expect(edgeCostForKind(shiloTelejump?.kind)).toBe(ticksToCost(18));
        expect(teleportEdgeCost(SPELL_TELEPORTS[0]?.family)).toBe(ticksToCost(5));
        expect(specialRequiresAt(3046, 9756, 0)?.skills).toEqual([{ name: 'mining', level: 60 }]);
    });
});
