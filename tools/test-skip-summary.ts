import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { generateSkipSummary } from './lib/test-skip-summary.js';

function main(): void {
    const [junitPath, logPath, summaryPath, ...extra] = process.argv.slice(2);
    if (!junitPath || !logPath || !summaryPath || extra.length > 0) {
        console.error('usage: bun tools/test-skip-summary.ts <junit-report> <test-log> <summary-file>');
        process.exitCode = 2;
        return;
    }

    if (!existsSync(junitPath) || !existsSync(logPath)) {
        appendFileSync(summaryPath, '## Skipped tests\n\nThe unit-test step did not produce both its JUnit report and test log.\n');
        return;
    }

    try {
        const summary = generateSkipSummary(readFileSync(junitPath, 'utf8'), readFileSync(logPath, 'utf8'));
        appendFileSync(summaryPath, `${summary}\n`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`skip summary generation failed: ${message}`);
        appendFileSync(summaryPath, `## Skipped tests\n\nSkip summary generation failed: ${message}\n`);
        process.exitCode = 1;
    }
}

if (import.meta.main) main();
