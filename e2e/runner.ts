/** E2E runner for local gates and browser harnesses. */
// Deploys once and compares the report with the previous run.

// Usage:
//   bun run e2e                     # quick: the fast harnesses
//   bun run e2e -- --level smart    # only what the working diff can affect
//   bun run e2e -- --level full     # every harness, quests included
//   bun run e2e -- --only troll,horror
//   bun run e2e -- --gates-only     # packed 377 inputs required; no running game server
//   bun run e2e -- --verbose        # stream every child line
//   bun run e2e -- --level full --jobs 6   # every harness, six at a time
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Why: e2e-report stays on the tools side because it needs no browser; e2e may import tools.
import { driftVerdict, parseSkips } from '../tools/lib/e2e-report.js';
import type { SkipLine } from '../tools/lib/e2e-report.js';
import { run } from './lib/runChild.js';
import type { Status, Verdict } from './lib/runChild.js';
import { CASES } from './manifest.js';
import { casesForLevel, selectByChanges } from './manifestQuery.js';
import type { Case, Level } from './manifestTypes.js';

interface Result { name: string; kind: 'gate' | 'harness'; status: Status; ms: number; note: string; }
interface Run { startedAt: string; git: string; level: Level; results: Result[]; }

const OUT = 'out/e2e';
const LOGS = join(OUT, 'logs');
const LATEST = join(OUT, 'latest.json');

/** Default case budget in minutes. */
const DEFAULT_BUDGET = 12;

/** Output verdict that a gate must also pass: a zero exit with a missing clean marker, a STALE line or a skipped local input fails (pitfalls 10, 29), and a nonzero exit fails whatever the output says. */
const DRIFT = driftVerdict;

/** Every `SKIP:` line a gate printed, kept for the report and the end-of-run summary. */
const SKIPS: { gate: string; skip: SkipLine }[] = [];

interface Gate { name: string; cmd: string[]; verdict?: Verdict; }
const OFFLINE_GATES: Gate[] = [
    { name: 'unit tests', cmd: ['bun', 'test'] },
    { name: 'typecheck', cmd: ['bun', 'run', 'typecheck'] },
    { name: 'lint', cmd: ['bun', 'run', 'lint'] },
    { name: 'cluedb drift', cmd: ['bun', 'tools/clues/gen-cluedb.ts', '--check'], verdict: DRIFT },
    { name: 'dropdb drift', cmd: ['bun', 'tools/combat/gen-dropdb.ts', '--check'], verdict: DRIFT },
    { name: 'spelldb drift', cmd: ['bun', 'tools/combat/gen-spelldb.ts', '--check'], verdict: DRIFT },
    { name: 'itemdb drift', cmd: ['bun', 'tools/items/gen-itemdb.ts', '--check'], verdict: DRIFT },
    { name: 'shopdb drift', cmd: ['bun', 'tools/shops/gen-shopdb.ts', '--check'], verdict: DRIFT },
    { name: 'scriptdocs drift', cmd: ['bun', 'tools/gen-scriptdocs.ts', '--check'], verdict: DRIFT },
    { name: 'ifids drift', cmd: ['bun', 'tools/gen-ifids.ts', '--check'], verdict: DRIFT },
    { name: 'untradeable drift', cmd: ['bun', 'tools/items/gen-untradeable.ts', '--check'], verdict: DRIFT },
    { name: 'namecollisions drift', cmd: ['bun', 'tools/items/gen-namecollisions.ts', '--check'], verdict: DRIFT },
    { name: 'cooksurfaces drift', cmd: ['bun', 'tools/cooking/gen-cooksurfaces.ts', '--check'], verdict: DRIFT },
    { name: 'doors drift', cmd: ['bun', 'tools/nav/derive-doors.ts', '--check'], verdict: DRIFT },
    { name: 'nav transports drift', cmd: ['sh', 'tools/nav/derive-transports.sh', '--check'], verdict: DRIFT },
    { name: 'manifest verify', cmd: ['bun', 'tools/lib/manifest.ts', 'verify'], verdict: DRIFT }
];

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function pick(level: Level, only: string[]): { cases: Case[]; why: string } {
    let cases: Case[];
    let why: string;
    if (level === 'smart') {
        const changed = (Bun.spawnSync(['git', 'diff', '--name-only', 'origin/main...HEAD']).stdout.toString() +
                         Bun.spawnSync(['git', 'diff', '--name-only']).stdout.toString())
            .split('\n').map(s => s.trim()).filter(Boolean);
        ({ cases, why } = selectByChanges(CASES, [...new Set(changed)]));
    } else {
        cases = casesForLevel(CASES, level);
        why = `${level}: ${cases.length} case(s) from the manifest`;
    }
    if (only.length > 0) {
        // Why: --only reaches broken and manual cases, which no level selects.
        cases = CASES.filter(c => only.some(o => c.id.includes(o) || c.harness.includes(o)));
        why += '; filtered by --only';
    }
    return { cases, why };
}

const mins = (ms: number): string => `${(ms / 60000).toFixed(1)}m`;
const ICON: Record<Status, string> = { pass: '✅', fail: '❌', timeout: '⏱', skip: '⏭' };

function skipSection(): string {
    if (SKIPS.length === 0) return '## Skipped checks\n\nNone.\n';
    const rows = SKIPS.map(({ gate, skip }) => `| ${gate} | ${skip.file} | ${skip.reason} | ${skip.input ?? 'other'} |`).join('\n');
    return `## Skipped checks\n\n| Gate | Test | Reason | Group |\n|---|---|---|---|\n${rows}\n`;
}

function report(now: Run, before: Run | null): string {
    const prev = new Map((before?.results ?? []).map(r => [r.name, r.status]));
    const newlyBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) === 'pass');
    const newlyFixed = now.results.filter(r => r.status === 'pass' && prev.has(r.name) && prev.get(r.name) !== 'pass');
    const stillBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) && prev.get(r.name) !== 'pass');
    const untracked = now.results.filter(r => r.status !== 'pass' && !prev.has(r.name));

    const rows = (rs: Result[]): string => rs.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n');
    const section = (title: string, rs: Result[], empty: string): string =>
        rs.length === 0 ? `## ${title}\n\n${empty}\n` : `## ${title}\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n${rows(rs)}\n`;

    const failed = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
    const head = [
        '# Regression report',
        '',
        '| | |',
        '|---|---|',
        `| Started | ${now.startedAt} |`,
        `| Commit | \`${now.git}\` |`,
        `| Level | ${now.level} |`,
        `| Ran | ${now.results.length} |`,
        `| Failing | ${failed} |`,
        `| Baseline | ${before ? `${before.startedAt} (\`${before.git}\`)` : 'none — this is the first run'} |`,
        ''
    ].join('\n');

    return [
        head,
        section('Newly broken since the baseline', newlyBroken, 'Nothing regressed.'),
        section('Newly fixed', newlyFixed, 'Nothing newly fixed.'),
        section('Still broken', stillBroken, 'Nothing carried over.'),
        section('Failing, no baseline entry', untracked, 'Nothing new and failing.'),
        '## Everything\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n' +
            now.results.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n') + '\n',
        skipSection(),
        `Logs: \`${LOGS}/\`\n`
    ].join('\n');
}

const level = (arg('level') as Level | undefined) ?? 'quick';
const only = (arg('only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const engine = arg('engine');
// Why: browser memory and shared-world contention make one job the safe default.
const jobs = Math.max(1, Number(arg('jobs') ?? 1) || 1);

// `--list` needs no engine, deploy, or browser.
if (has('list')) {
    const byStatus = new Map<string, number>();
    for (const c of CASES) {
        byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    }
    console.log(`${CASES.length} case(s): ${[...byStatus].map(([s, n]) => `${n} ${s}`).join(', ')}`);
    for (const lvl of ['quick', 'smart', 'full'] as const) {
        const { cases, why } = pick(lvl, only);
        console.log(`\n${lvl} — ${cases.length} case(s) — ${why}`);
        for (const c of cases) {
            const covers = [...(c.covers.scripts ?? []), ...(c.covers.subsystems ?? [])].join(', ');
            console.log(`  ${c.status.padEnd(10)} ${c.id.padEnd(34)} ${covers}`);
        }
    }
    process.exit(0);
}

mkdirSync(LOGS, { recursive: true });
const git = (await new Response(Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim();
const now: Run = { startedAt: new Date().toISOString(), git, level, results: [] };

console.log(`e2e: level=${level} commit=${git}`);

for (const { name, cmd, verdict } of OFFLINE_GATES) {
    const logPath = join(LOGS, `${name.replace(/\W+/g, '-')}.log`);
    const r = await run(name, cmd, logPath, 20 * 60_000, verdict);
    for (const skip of parseSkips(readFileSync(logPath, 'utf8'))) SKIPS.push({ gate: name, skip });
    now.results.push({ name, kind: 'gate', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
    console.log(`  ${ICON[r.status]} ${name} (${mins(r.ms)})${r.status === 'pass' ? '' : `\n      ${r.tail}`}`);
}

if (!has('gates-only')) {
    const gatesGreen = now.results.every(r => r.status === 'pass');
    if (!gatesGreen && !has('force')) {
        console.log('offline gates failed — skipping harnesses (pass --force to run anyway)');
    } else {
        const deploy = await run('deploy', ['sh', 'tools/deploy-local.sh'], join(LOGS, 'deploy.log'), 20 * 60_000);
        now.results.push({ name: 'deploy', kind: 'gate', status: deploy.status, ms: deploy.ms, note: deploy.status === 'pass' ? '' : deploy.tail });
        console.log(`  ${ICON[deploy.status]} deploy (${mins(deploy.ms)})`);

        if (deploy.status === 'pass') {
            const { cases, why } = pick(level, only);
            console.log(`${cases.length} case(s) — ${why}${jobs > 1 ? `, ${jobs} at a time` : ''}`);

            // Why: one shared deploy and `--no-deploy` prevent workers from replacing `public/bot` mid-run.
            // Each harness owns its account; only the world is shared.
            let next = 0;
            let done = 0;
            const worker = async (): Promise<void> => {
                for (;;) {
                    const i = next++;
                    const c = cases[i];
                    if (!c) {
                        return;
                    }
                    const budget = (c.budgetMin ?? DEFAULT_BUDGET) * 60_000;
                    const cmd = ['bun', join('e2e', c.harness), ...(c.args ?? []), '--no-deploy'];
                    if (engine) cmd.push('--base', engine);
                    const r = await run(`[${i + 1}/${cases.length}] ${c.id}`, cmd, join(LOGS, `${c.id}.log`), budget, undefined, c.env);
                    now.results.push({ name: c.id, kind: 'harness', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
                    done += 1;
                    console.log(`  ${ICON[r.status]} [${done}/${cases.length}] ${c.id} (${mins(r.ms)})${r.status === 'pass' ? '' : `\n      ${r.tail}`}`);
                }
            };
            await Promise.all(Array.from({ length: Math.min(jobs, cases.length) }, () => worker()));
        } else {
            console.log('deploy failed — harnesses would test a stale bundle, so none were run');
        }
    }
}

// Why: stable manifest order keeps report diffs free of pool completion noise.
const ORDER = new Map(CASES.map((c, i) => [c.id, i]));
now.results.sort((a, b) => {
    if (a.kind !== b.kind) {
        return a.kind === 'gate' ? -1 : 1;
    }
    return (ORDER.get(a.name) ?? 0) - (ORDER.get(b.name) ?? 0);
});

const before: Run | null = existsSync(LATEST) ? JSON.parse(readFileSync(LATEST, 'utf8')) as Run : null;
const md = report(now, before);
const stamp = now.startedAt.replace(/[:.]/g, '-');
writeFileSync(join(OUT, `${stamp}.json`), JSON.stringify(now, null, 1));
writeFileSync(join(OUT, 'report.md'), md);
writeFileSync(LATEST, JSON.stringify(now, null, 1));

console.log(`\n${md.split('## Everything')[0]}`);
if (SKIPS.length > 0) {
    console.log(`skips: ${SKIPS.length}`);
    for (const { gate, skip } of SKIPS) console.log(`  ${gate}: ${skip.file}: ${skip.reason}`);
}
console.log(`report: ${OUT}/report.md`);

const broken = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
process.exit(broken > 0 ? 1 : 0);
