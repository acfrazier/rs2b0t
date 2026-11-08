import { afterEach, describe, expect, test } from 'bun:test';

import Packet from '#/client/io/Packet.js';
import Skill from '#/client/shell/Skill.js';

import { attach, detach } from '#/bot/adapter/ClientAdapter.js';
import { Skills } from '#/bot/api/skills/Skills.js';

import { decodeRecordedFrame } from '../../io/replay/runtime.js';
import { loadReplayRecordings } from '../../io/replay/recording.js';

interface RecordedStat {
    level: number;
    xp: number;
}

/** The UPDATE_STAT values the L1 recording carries, keyed by skill index. */
function recordedStats(): Map<number, RecordedStat> {
    const recording = loadReplayRecordings(377).find(candidate => candidate.recordingFile.includes('l1'));
    if (!recording) {
        throw new Error('the L1 recording is missing');
    }

    const byId = new Map(recording.protocol.server.map(descriptor => [descriptor.id, descriptor]));
    const stats = new Map<number, RecordedStat>();
    for (const record of recording.records) {
        if (record.type !== 'frame' || record.direction !== 'in') {
            continue;
        }
        const descriptor = byId.get(parseInt(record.bytes.slice(0, 2), 16));
        if (descriptor?.name !== 'UPDATE_STAT') {
            continue;
        }

        const wire = decodeRecordedFrame(record, recording.protocol.server);
        const packet = new Packet(wire.subarray(1));
        const index = packet.g1_alt2();
        const level = packet.g1();
        const xp = packet.g4();
        stats.set(index, { level, xp });
    }
    return stats;
}

afterEach(() => {
    detach();
});

describe('skills against the replay stat snapshot', () => {
    test('the recorded skill ids are the client table the noun indexes', () => {
        const stats = recordedStats();
        expect([...stats.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, index) => index));
        for (const index of stats.keys()) {
            expect(Skill.names[index]).toBeDefined();
            expect(Skill.names[index]!.startsWith('-')).toBe(false);
            expect(Skill.used[index]).toBe(true);
        }
    });

    test('Skills reads names, levels and experience from the recorded values', () => {
        const stats = recordedStats();
        const base = new Int32Array(Skill.count);
        const effective = new Int32Array(Skill.count);
        const xp = new Int32Array(Skill.count);
        const seen = new Int32Array(Skill.count);
        for (const [index, stat] of stats) {
            base[index] = stat.level;
            effective[index] = stat.level;
            xp[index] = stat.xp;
            seen[index] = 1;
        }

        attach({
            statBaseLevel: base,
            statEffectiveLevel: effective,
            statXP: xp,
            statSeenGeneration: seen,
            statSessionGeneration: 1,
            var: []
        });

        expect(Skills.index('hitpoints')).toBe(3);
        expect(Skills.level('hitpoints')).toBe(10);
        expect(Skills.effective('hitpoints')).toBe(10);
        expect(Skills.xp('hitpoints')).toBe(1154);
        expect(Skills.level('attack')).toBe(1);
        expect(Skills.xp('attack')).toBe(0);
        expect(Skills.hpFraction()).toBe(1);
    });
});
