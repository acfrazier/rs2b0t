#!/usr/bin/env bun
// Compiler census: bun run audit:exports writes out/audit-exports/integrated.json from raw rows (G0 is not a CI failure).
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { runExportCensus } from './lib/exportCensus.js';

export { classifyExportGroup, integrateCensus } from './lib/exportCensus.js';
export { runExportCensus };
export { collectHeritageDeclarations, createConduitResolver, exportInterestNames, moduleExportTargets } from './lib/exportCensusCore.js';

export function parseAuditArgs(argv: readonly string[], cwd = process.cwd()): { root: string; out: string; revision?: string } {
    const rootFlag = argv.findIndex(a => a === '--root');
    const outFlag = argv.findIndex(a => a === '--out');
    const revFlag = argv.findIndex(a => a === '--revision');
    const root = rootFlag >= 0 && argv[rootFlag + 1] ? resolve(cwd, argv[rootFlag + 1]) : cwd;
    const out = outFlag >= 0 && argv[outFlag + 1] ? resolve(cwd, argv[outFlag + 1]) : resolve(root, 'out/audit-exports');
    const revision = revFlag >= 0 ? argv[revFlag + 1] : undefined;
    return { root, out, revision };
}

function defaultRevision(root: string): string {
    if (process.env.RS2B0T_REVISION) {
        return process.env.RS2B0T_REVISION;
    }
    try {
        return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

if (import.meta.main) {
    const parsed = parseAuditArgs(process.argv.slice(2));
    const root = process.env.RS2B0T_ROOT ?? parsed.root;
    const out = process.env.RS2B0T_OUT ?? parsed.out;
    const revision = parsed.revision ?? defaultRevision(root);
    const result = runExportCensus({ root, out, revision, writeArtifacts: true });
    const integrated = result.integrated;
    const g0 = integrated.exports.rawExternalConsumerGroups['G0-noref'] ?? 0;
    console.log(
        `audit:exports — ${integrated.exports.total} bindings, ${integrated.exports.protected} protected, ${g0} G0, ${integrated.exports.sourceTestOnlyCount} source-test-only, ${integrated.conduits.resolved}/${integrated.conduits.total} conduits resolved`
    );
    console.log(`wrote ${resolve(out)}/integrated.json`);
}
