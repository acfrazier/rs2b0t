import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { IF_IDS } from '#/bot/data/ifIds.js';

import { snapshotComponent, snapshotId } from '../ifids/interfaceSnapshot.js';

const PRAYERS: readonly (readonly [name: string, constant: number, packName: string])[] = [
    ['thick skin', IF_IDS.PRAYER_PRAYER_THICKSKIN, 'prayer:prayer_thickskin'],
    ['burst of strength', IF_IDS.PRAYER_PRAYER_STRENGTHBURST, 'prayer:prayer_strengthburst'],
    ['clarity of thought', IF_IDS.PRAYER_PRAYER_CLARITY, 'prayer:prayer_clarity'],
    ['rock skin', IF_IDS.PRAYER_PRAYER_ROCKSKIN, 'prayer:prayer_rockskin'],
    ['superhuman strength', IF_IDS.PRAYER_PRAYER_SUPERHUMANSTRENGTH, 'prayer:prayer_superhumanstrength'],
    ['improved reflexes', IF_IDS.PRAYER_PRAYER_IMPROVEDREFLEXES, 'prayer:prayer_improvedreflexes'],
    ['rapid restore', IF_IDS.PRAYER_PRAYER_RAPIDRESTORE, 'prayer:prayer_rapidrestore'],
    ['rapid heal', IF_IDS.PRAYER_PRAYER_RAPIDHEAL, 'prayer:prayer_rapidheal'],
    ['protect item', IF_IDS.PRAYER_PRAYER_PROTECTITEMS, 'prayer:prayer_protectitems'],
    ['steel skin', IF_IDS.PRAYER_PRAYER_STEELSKIN, 'prayer:prayer_steelskin'],
    ['ultimate strength', IF_IDS.PRAYER_PRAYER_ULTIMATESTRENGTH, 'prayer:prayer_ultimatestrength'],
    ['incredible reflexes', IF_IDS.PRAYER_PRAYER_INCREDIBLEREFLEXES, 'prayer:prayer_incrediblereflexes'],
    ['protect from magic', IF_IDS.PRAYER_PRAYER_PROTECTFROMMAGIC, 'prayer:prayer_protectfrommagic'],
    ['protect from missiles', IF_IDS.PRAYER_PRAYER_PROTECTFROMMISSILES, 'prayer:prayer_protectfrommissiles'],
    ['protect from melee', IF_IDS.PRAYER_PRAYER_PROTECTFROMMELEE, 'prayer:prayer_protectfrommelee']
];

const originals = {
    ifButton: actions.ifButton,
    varp: reader.varp,
    delayUntil: Execution.delayUntil
};
const sent: number[] = [];
const readVarps: number[] = [];

afterEach(() => {
    actions.ifButton = originals.ifButton;
    reader.varp = originals.varp;
    Execution.delayUntil = originals.delayUntil;
    sent.length = 0;
    readVarps.length = 0;
});

describe('prayer component ids against the replay interface snapshot', () => {
    test('every toggle is a recorded prayer button under one overlay layer', () => {
        let layer: number | null = null;
        for (const [name, constant, packName] of PRAYERS) {
            expect(constant).toBe(snapshotId(packName));
            const component = snapshotComponent(constant);
            expect(component.buttonType).toBe(4);
            expect(component.type).toBe(5);
            if (layer === null) {
                layer = component.layerId;
            }
            expect(component.layerId).toBe(layer);
            expect(Prayer.known(name)).toBe(true);
        }
        expect(new Set(PRAYERS.map(([, constant]) => constant)).size).toBe(PRAYERS.length);
    });

    test('set clicks the snapshot button and waits on the prayer varp', async () => {
        actions.ifButton = (comId: number) => {
            sent.push(comId);
            return true;
        };
        reader.varp = (index: number) => {
            readVarps.push(index);
            return 1;
        };
        Execution.delayUntil = async () => true;

        expect(await Prayer.active('protect from melee')).toBe(true);
        expect(readVarps).toEqual([97]);
        expect(await Prayer.set('protect from melee', false)).toBe(true);
        expect(sent).toEqual([IF_IDS.PRAYER_PRAYER_PROTECTFROMMELEE]);
    });
});
