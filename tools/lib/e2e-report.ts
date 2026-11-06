/** Verdicts for the local gates, and the skip vocabulary they read.
 *  Why: a gate that skipped its content or engine input must not look green (pitfalls 10, 29); groups 1-4 are the local inputs, and `test/lib/skipUnless.ts` prints the `SKIP:` lines parsed here.
 */

export type InputKey = 'engine' | 'content' | 'cache-bundle' | 'collision-pack' | 'prod-rsa';

/** The five input-keyed groups of the plan's section 3. */
export const SKIP_GROUPS: readonly InputKey[] = ['engine', 'content', 'cache-bundle', 'collision-pack', 'prod-rsa'];

/** Canonical missing-input reasons. A skip line is keyed by this prefix; keep them stable. */
export const SKIP_REASON: Record<InputKey, string> = {
    engine: 'ENGINE_DIR absent or on another revision',
    content: 'CONTENT_DIR absent',
    'cache-bundle': 'RS2B0T_CACHE_BUNDLE absent',
    'collision-pack': 'out/collision.lcnav.gz absent',
    'prod-rsa': 'PROD_RSAE/PROD_RSAN absent'
};

/** Groups a local gate must not skip: an absent local input means the gate did not check its data. */
export const LOCAL_GATE_GROUPS: readonly InputKey[] = ['engine', 'content', 'cache-bundle', 'collision-pack'];

export interface SkipLine {
    file: string;
    reason: string;
    /** The input group named by this skip, or null when it is not one of ours. */
    input: InputKey | null;
}

/** Every `SKIP: <file>: <reason>` line in a run's output, in order. */
export function parseSkips(text: string): SkipLine[] {
    const out: SkipLine[] = [];
    for (const match of text.matchAll(/^SKIP: ([^:\n]+): (.+)$/gm)) {
        const reason = match[2].trim();
        const input = SKIP_GROUPS.find(key => reason.startsWith(SKIP_REASON[key])) ?? null;
        out.push({ file: match[1], reason, input });
    }
    return out;
}

/** The groups a local gate skipped, minus the ones the caller explicitly allows. */
export function skippedLocalGroups(text: string, allow: readonly InputKey[] = []): InputKey[] {
    const groups = new Set<InputKey>();
    for (const skip of parseSkips(text)) {
        if (skip.input === null || !LOCAL_GATE_GROUPS.includes(skip.input) || allow.includes(skip.input)) continue;
        groups.add(skip.input);
    }
    return [...groups];
}

const DRIFT_STALE_RE = /\bSTALE\b|does not match/i;
const DRIFT_CLEAN_RE = /\bok:|is up to date\b/i;

/** A drift gate passes only on a clean marker and no `STALE`, and by default only when it did not skip a local input; a slice receipt must not use `allowSkips`. */
export function driftVerdict(text: string, options: { allowSkips?: readonly InputKey[] } = {}): 'pass' | 'fail' {
    if (DRIFT_STALE_RE.test(text)) return 'fail';
    if (!DRIFT_CLEAN_RE.test(text)) return 'fail';
    return skippedLocalGroups(text, options.allowSkips ?? []).length === 0 ? 'pass' : 'fail';
}

const ERROR_RE = /\berror\b|\bFAIL\b|\bfailed\b|✗|Cannot\b|not found/i;
/** Stack frames and runtime banners that trail the live message. */
const NOISE_RE = /^\s*at\s|^Bun v\d|^\s*log:\s|coreBundle\.js/;
const CAP = 240;

/** Why: crash logs end with stack frames; prefer the last error lines and fall back to the tail. */
export function errorTail(lines: string[]): string {
    const clean = lines.map(l => l.trim()).filter(Boolean);
    if (clean.length === 0) return '';

    const signal = clean.filter(l => ERROR_RE.test(l) && !NOISE_RE.test(l));
    const picked = signal.length > 0 ? signal.slice(-2) : clean.slice(-3);
    return picked.join(' | ').slice(0, CAP);
}
