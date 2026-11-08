/** Pitfall 7: the bundle test used to skip when no bundle existed. `build:all-targets` writes `out/build-targets.json`, and this suite then requires every recorded output, no surviving `process.env`, and the dummy marker exactly when that compile was dummy.
 *  A build without the record keeps the weaker present-only check, so a local `bun run build` does not make the suite red.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const RECORD = 'out/build-targets.json';
const CANONICAL = ['out/botclient.js', 'out/client.js', 'out/mapview.js', 'out/multibox.js', 'out/ondemandworker.js', 'out/navworker.js'];

interface BuildRecord {
    outputs: string[];
    dummyRsa: boolean;
    strict: { packets: string; config: string };
}

function readRecord(): BuildRecord | null {
    if (!existsSync(RECORD)) return null;
    const raw: unknown = JSON.parse(readFileSync(RECORD, 'utf8'));
    if (typeof raw !== 'object' || raw === null) throw new Error(`${RECORD}: expected an object`);
    if (!('outputs' in raw) || !Array.isArray(raw.outputs)) throw new Error(`${RECORD}: outputs must be an array`);
    if (!('dummyRsa' in raw) || typeof raw.dummyRsa !== 'boolean') throw new Error(`${RECORD}: dummyRsa must be a boolean`);
    if (!('strict' in raw) || typeof raw.strict !== 'object' || raw.strict === null) throw new Error(`${RECORD}: strict must be an object`);
    const strict = raw.strict;
    if (!('packets' in strict) || !('config' in strict)) throw new Error(`${RECORD}: strict needs packets and config`);

    const outputs = raw.outputs;
    for (const path of outputs) {
        if (typeof path !== 'string' || path === '') throw new Error(`${RECORD}: outputs entries must be non-empty strings`);
    }
    return {
        outputs: outputs as string[],
        dummyRsa: raw.dummyRsa,
        strict: { packets: String(strict.packets), config: String(strict.config) }
    };
}

const RECORDED = readRecord();
const PRESENT = CANONICAL.filter(path => existsSync(path));

describe.skipIf(RECORDED === null && PRESENT.length === 0)('browser bundle outputs (build-gated)', () => {
    const outputs = RECORDED?.outputs ?? PRESENT;

    for (const path of outputs) {
        test(`${path} exists`, () => {
            expect(existsSync(path)).toBe(true);
        });
    }

    for (const path of outputs.filter(candidate => candidate.endsWith('.js'))) {
        test(`${path} has no surviving process.env reference`, () => {
            expect(readFileSync(path, 'utf8')).not.toContain('process.env');
        });
    }

    test.skipIf(RECORDED === null)('the build record covers every browser and worker entry', () => {
        for (const path of CANONICAL) expect(outputs).toContain(path);
        expect(RECORDED?.dummyRsa === true || RECORDED?.dummyRsa === false).toBe(true);
    });

    test.skipIf(RECORDED === null)('every bundle was built with both strict flags on', () => {
        expect(RECORDED?.strict).toEqual({ packets: '1', config: '1' });
    });

    test.skipIf(RECORDED === null)('the Spessa processor is recorded and tinymidipcm.wasm is gone', () => {
        expect(outputs).toContain('out/spessasynth_processor.min.js');
        expect(outputs).not.toContain('out/tinymidipcm.wasm');
        expect(existsSync('out/spessasynth_processor.min.js')).toBe(true);
        expect(existsSync('out/tinymidipcm.wasm')).toBe(false);
    });

    test.skipIf(RECORDED === null)('the prod compile is marked dummy exactly when it was built that way', () => {
        const version: unknown = JSON.parse(readFileSync('out/version.json', 'utf8'));
        const rsa = typeof version === 'object' && version !== null && 'rsa' in version ? version.rsa : undefined;
        const label = typeof version === 'object' && version !== null && 'label' in version ? version.label : undefined;

        if (RECORDED?.dummyRsa === true) {
            expect(rsa).toBe('dummy');
            expect(String(label)).toContain('-dummy');
        } else {
            expect(rsa).toBe('keyed');
            expect(String(label)).not.toContain('-dummy');
        }

        const target: unknown = JSON.parse(readFileSync('out/target.json', 'utf8'));
        const name = typeof target === 'object' && target !== null && 'target' in target ? target.target : undefined;
        expect(name).toBe('prod');
    });
});
