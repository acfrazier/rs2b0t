import { describe, expect, test } from 'bun:test';

import { DROP_DB } from '#/bot/data/dropdb.js';

// 377 skill_combat/scripts/npc/npc_combat.rs2:3 sets `[ai_queue3,_] gosub(npc_default_death)`, and :90-95 adds the npc's `death_drop` param for the hero.
// An npc without an ai_queue3 block of its own therefore yields that item.
describe('default death drops (377 npc_default_death)', () => {
    test('the iron dragon has no table block, so its loot is the death_drop param: dragon bones', () => {
        // 377 dragons.npc [iron_dragon] param=death_drop,dragon_bones
        expect(DROP_DB['Iron dragon']).toEqual(['Dragon bones']);
    });

    test('ogres drop their configured big bones through the same default', () => {
        expect(DROP_DB['Ogre']).toContain('Big bones');
    });

    test('an npc with its own explicit table keeps it and still lists its death drop once', () => {
        const green = DROP_DB['Green dragon'];
        expect(green).toContain('Dragon bones');
        expect(green.filter(name => name === 'Dragon bones')).toHaveLength(1);
    });
});
