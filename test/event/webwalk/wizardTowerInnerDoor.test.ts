import { describe, expect } from 'bun:test';

import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import doors from '#/bot/event/webwalk/data/doors.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { skip377 } from '../../lib/skip377.js';

const skipped = skip377('test/event/webwalk/wizardTowerInnerDoor.test.ts', 'the 377 door and transport rows for this crossing differ from this 289 fixture (S8 live tier pending)');

interface DoorEdge {
    x: number;
    z: number;
    level: number;
    locId: number;
}

const doorEdges = doors as DoorEdge[];
const hops = transports as TransportEdgeData[];

describe("Wizards' Tower inner door", () => {
    skipped('loc 1536 at the unwalkable midpoint is recorded', () => {
        expect(doorEdges.some(d => d.x === 3107 && d.z === 3162 && d.level === 0 && d.locId === 1536)).toBe(true);
    });

    skipped('the 2-tile hop 3106↔3108 remains the live crossing', () => {
        const pair = hops.filter(e => e.locId === 1536 && e.locX === 3107 && e.locZ === 3162);
        expect(pair.some(e => e.from.x === 3106 && e.to.x === 3108)).toBe(true);
        expect(pair.some(e => e.from.x === 3108 && e.to.x === 3106)).toBe(true);
    });
});
