import { afterEach, describe, expect, test } from 'bun:test';

import { attach, detach } from '#/bot/adapter/ClientAdapter.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';

import { installInterfaceSnapshot, snapshotComponent } from '../ifids/interfaceSnapshot.js';

/** Chat roots the L1 and mainland recordings open, and the bank root they leave in the main modal. */
const OPTIONS_ROOT = 2459;
const CONTINUE_ROOT = 4882;
const BANK_ROOT = 5292;

let restoreInterfaces: (() => void) | null = null;

afterEach(() => {
    detach();
    restoreInterfaces?.();
    restoreInterfaces = null;
});

interface RecordedClient {
    statSessionGeneration: number;
    mainModalId: number;
    sideModalId: number;
    chatModalId: number;
    resumedPauseButton: boolean;
    var: number[];
}

function recordedClient(chatModalId: number): RecordedClient {
    const vars: number[] = [];
    vars[101] = 42;
    return {
        statSessionGeneration: 1,
        mainModalId: BANK_ROOT,
        sideModalId: -1,
        chatModalId,
        resumedPauseButton: false,
        var: vars
    };
}

describe('dialogue and quest readers against the replay interface snapshot', () => {
    test('the recorded option and continue roots carry the buttons the noun looks for', () => {
        const options = snapshotComponent(OPTIONS_ROOT);
        expect(options.type).toBe(0);
        expect(options.children).toContain(2461);
        expect(options.children).toContain(2462);
        expect(snapshotComponent(2461).buttonType).toBe(1);
        expect(snapshotComponent(2462).buttonType).toBe(1);

        const continueRoot = snapshotComponent(CONTINUE_ROOT);
        const continueButton = (continueRoot.children ?? []).find(id => snapshotComponent(id).buttonType === 6);
        expect(continueButton).toBe(4886);
    });

    test('ChatDialog reads the recorded option root', () => {
        restoreInterfaces = installInterfaceSnapshot();
        attach(recordedClient(OPTIONS_ROOT));

        expect(ChatDialog.isOpen()).toBe(true);
        expect(ChatDialog.options()).toEqual(['option1', 'option2']);
        expect(ChatDialog.texts()).toContain('Select an Option');
        expect(ChatDialog.canContinue()).toBe(false);
    });

    test('ChatDialog reads the recorded continue root', () => {
        restoreInterfaces = installInterfaceSnapshot();
        attach(recordedClient(CONTINUE_ROOT));

        expect(ChatDialog.options()).toEqual([]);
        expect(ChatDialog.canContinue()).toBe(true);
        expect(ChatDialog.texts()).toContain('Click here to continue');
        expect(ChatDialog.texts()).toContain('Name');
        expect(ChatDialog.texts()).toContain('Line1');
    });

    test('the quest points varp and the modal root are read from the recorded client', () => {
        restoreInterfaces = installInterfaceSnapshot();
        const client = recordedClient(-1);
        attach(client);

        expect(Quests.points()).toBe(42);
        expect(Modals.main()).toBe(BANK_ROOT);
        expect(Modals.isOpen()).toBe(true);

        client.mainModalId = -1;
        expect(Modals.isOpen()).toBe(false);
    });
});
