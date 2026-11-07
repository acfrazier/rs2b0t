import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { driveDialog } from '#/bot/api/ai/quests/exec/primitives.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';

// Why: Lawgof walks to the cannon and inspects it before the next page, and the default 1.5s lull
// tolerance ended the drive mid-scene, the quest then picked another step and talked over him.

const TICK_MS = 600;
/** Poll the predicate once per simulated tick, so a longer wait gets more chances. */
beforeEach(() => {
    spyOn(Execution, 'delayUntil').mockImplementation(async (check: () => boolean, ms = 6000) => {
        for (let i = 0; i < Math.max(1, Math.floor(ms / TICK_MS)); i++) {
            if (check()) {
                return true;
            }
        }
        return check();
    });
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {});
});

afterEach(() => {
    mock.restore();
});

/** A conversation that goes quiet for `gapTicks` polls, then offers one last page. */
function scriptGap(gapTicks: number): { pages: () => number } {
    let polls = 0;
    let pages = 0;
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => false);
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => {
        polls++;
        return polls > gapTicks;
    });
    spyOn(ChatDialog, 'continue').mockImplementation(async () => {
        pages++;
        return true;
    });
    spyOn(ChatDialog, 'options').mockImplementation(() => []);
    return { pages: () => pages };
}

describe('a talk can wait out a scripted pause', () => {
    test('the default tolerance gives up on a long inspection', async () => {
        const seen = scriptGap(8);
        await driveDialog([], () => {});
        expect(seen.pages()).toBe(0);
    });

    test('a stop that asks for longer clicks the page that follows', async () => {
        const seen = scriptGap(8);
        await driveDialog([], () => {}, 12_000);
        expect(seen.pages()).toBeGreaterThan(0);
    });
});
