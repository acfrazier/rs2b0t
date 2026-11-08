import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { IF_IDS } from '#/bot/data/ifIds.js';

const TOGGLE_MS = 2000; // non-component: wait budget

interface PrayerDef {
    com: number;
    varp: number;
    level: number;
}

/**
 * The prayer overlay's toggle buttons and the varps that mirror them.
 * Why: the engine treats any tab root as visible, so you can toggle a prayer without switching to the prayer tab.
 * @see docs/reference/api-skills.md#prayer
 */
const PRAYERS: Record<string, PrayerDef> = {
    'thick skin': { com: IF_IDS.PRAYER_PRAYER_THICKSKIN, varp: 83, level: 1 },
    'burst of strength': { com: IF_IDS.PRAYER_PRAYER_STRENGTHBURST, varp: 84, level: 4 },
    'clarity of thought': { com: IF_IDS.PRAYER_PRAYER_CLARITY, varp: 85, level: 7 },
    'rock skin': { com: IF_IDS.PRAYER_PRAYER_ROCKSKIN, varp: 86, level: 10 },
    'superhuman strength': { com: IF_IDS.PRAYER_PRAYER_SUPERHUMANSTRENGTH, varp: 87, level: 13 },
    'improved reflexes': { com: IF_IDS.PRAYER_PRAYER_IMPROVEDREFLEXES, varp: 88, level: 16 },
    'rapid restore': { com: IF_IDS.PRAYER_PRAYER_RAPIDRESTORE, varp: 89, level: 19 },
    'rapid heal': { com: IF_IDS.PRAYER_PRAYER_RAPIDHEAL, varp: 90, level: 22 },
    'protect item': { com: IF_IDS.PRAYER_PRAYER_PROTECTITEMS, varp: 91, level: 25 },
    'steel skin': { com: IF_IDS.PRAYER_PRAYER_STEELSKIN, varp: 92, level: 28 },
    'ultimate strength': { com: IF_IDS.PRAYER_PRAYER_ULTIMATESTRENGTH, varp: 93, level: 31 },
    'incredible reflexes': { com: IF_IDS.PRAYER_PRAYER_INCREDIBLEREFLEXES, varp: 94, level: 34 },
    'protect from magic': { com: IF_IDS.PRAYER_PRAYER_PROTECTFROMMAGIC, varp: 95, level: 37 },
    'protect from missiles': { com: IF_IDS.PRAYER_PRAYER_PROTECTFROMMISSILES, varp: 96, level: 40 },
    'protect from melee': { com: IF_IDS.PRAYER_PRAYER_PROTECTFROMMELEE, varp: 97, level: 43 }
};

export const PROTECT_FROM_MAGIC = 'Protect from Magic';

function def(name: string): PrayerDef | null {
    return PRAYERS[name.trim().toLowerCase()] ?? null;
}

/**
 * Prayer points and the protection prayers.
 * @see docs/reference/api-skills.md#prayer
 */
export const Prayer = {
    points(): number {
        return Skills.effective('prayer');
    },

    max(): number {
        return Skills.level('prayer');
    },

    full(): boolean {
        const max = this.max();
        return max > 0 && this.points() >= max;
    },

    known(name: string): boolean {
        return def(name) !== null;
    },

    /** Whether the prayer's level requirement is met and points remain. */
    available(name: string): boolean {
        const d = def(name);
        return d !== null && this.max() >= d.level && this.points() > 0;
    },

    active(name: string): boolean {
        const d = def(name);
        return d !== null && reader.varp(d.varp) === 1;
    },

    async set(name: string, on: boolean): Promise<boolean> {
        const d = def(name);
        if (!d) {
            return false;
        }
        if (this.active(name) === on) {
            return true;
        }
        if (on && !this.available(name)) {
            return false;
        }
        actions.ifButton(d.com);
        return Execution.delayUntil(() => this.active(name) === on, TOGGLE_MS);
    },

    /** Turn off every active prayer. */
    async clear(): Promise<void> {
        for (const name of Object.keys(PRAYERS)) {
            if (this.active(name)) {
                await this.set(name, false);
            }
        }
    }
};
