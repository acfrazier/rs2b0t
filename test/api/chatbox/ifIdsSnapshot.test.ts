import { afterEach, describe, expect, test } from 'bun:test';

import Packet from '#/client/io/Packet.js';

import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';

import { decodeRecordedFrame } from '../../io/replay/runtime.js';
import { loadReplayRecordings } from '../../io/replay/recording.js';

/** The MESSAGE_GAME lines the L1 recording carries, in wire order. */
function recordedMessages(): string[] {
    const recording = loadReplayRecordings(377).find(candidate => candidate.recordingFile.includes('l1'));
    if (!recording) {
        throw new Error('the L1 recording is missing');
    }

    const byId = new Map(recording.protocol.server.map(descriptor => [descriptor.id, descriptor]));
    const messages: string[] = [];
    for (const record of recording.records) {
        if (record.type !== 'frame' || record.direction !== 'in') {
            continue;
        }
        const descriptor = byId.get(parseInt(record.bytes.slice(0, 2), 16));
        if (descriptor?.name !== 'MESSAGE_GAME') {
            continue;
        }

        const wire = decodeRecordedFrame(record, recording.protocol.server);
        const prefix = descriptor.length === -1 ? 1 : descriptor.length === -2 ? 2 : 0;
        messages.push(new Packet(wire.subarray(1 + prefix)).gjstr());
    }
    return messages;
}

afterEach(() => {
    GameMessages.reset();
});

describe('game messages against the replay chat snapshot', () => {
    test('the recording carries the welcome and tutorial lines the noun parses', () => {
        const messages = recordedMessages();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.every(message => message.length > 0)).toBe(true);
        expect(messages.some(message => /^Welcome to RuneScape\.$/.test(message))).toBe(true);
        expect(messages.some(message => message.startsWith('get tutorial:'))).toBe(true);
    });

    test('the ring keeps recorded order, marks and matches', () => {
        const messages = recordedMessages();
        GameMessages.reset();
        const mark = GameMessages.mark();
        for (const message of messages) {
            GameMessages.record(message);
        }

        expect(GameMessages.since(mark).map(message => message.text)).toEqual(messages);
        expect(GameMessages.recent(2).map(message => message.text)).toEqual(messages.slice(-2).reverse());
        expect(GameMessages.sawSince(mark, /^Welcome to RuneScape\.$/)).toBe(true);
        expect(GameMessages.firstSince(mark, /^get tutorial:/)?.text).toBe(
            messages.find(message => message.startsWith('get tutorial:'))
        );
        expect(GameMessages.sawSince(mark, /this line was never recorded/)).toBe(false);
    });
});
