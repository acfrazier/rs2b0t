import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseSkips, type SkipLine } from './e2e-report.js';


interface SuiteFrame {
    file: string | undefined;
    line: number | undefined;
}

interface SkippedCase {
    file: string;
    line: number | undefined;
    name: string;
    suites: SuiteFrame[];
}

function decodeXml(value: string): string {
    return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
        switch (entity) {
            case '&amp;': return '&';
            case '&lt;': return '<';
            case '&gt;': return '>';
            case '&quot;': return '"';
            case '&apos;': return "'";
            default: {
                const hex = entity[2]?.toLowerCase() === 'x';
                const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
                return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
            }
        }
    });
}

function attributes(source: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const match of source.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
        result.set(match[1]!, decodeXml(match[2]!));
    }
    return result;
}

function lineNumber(value: string | undefined): number | undefined {
    if (value === undefined || !/^\d+$/.test(value)) return undefined;
    const line = Number(value);
    return line > 0 ? line : undefined;
}

function parseSkippedCases(xml: string): SkippedCase[] {
    const rootTag = /<testsuites\b([^>]*)>/.exec(xml);
    if (!rootTag && !/<testsuite\b/.test(xml)) throw new Error('JUnit report has no testsuite root');
    const reportedSkipped = attributes(rootTag?.[1] ?? '').get('skipped');
    const expectedSkipped = reportedSkipped === undefined ? undefined : Number(reportedSkipped);
    if (expectedSkipped !== undefined && (!Number.isInteger(expectedSkipped) || expectedSkipped < 0)) {
        throw new Error(`JUnit report has an invalid skipped count: ${reportedSkipped}`);
    }

    const cases: SkippedCase[] = [];
    const suites: SuiteFrame[] = [];
    const tags = /<(\/)?(testsuite|testcase)\b([^>]*?)(\/?)>/g;
    for (const match of xml.matchAll(tags)) {
        const closing = match[1] === '/';
        const tag = match[2]!;
        const rawAttributes = match[3]!;
        const selfClosing = match[4] === '/';
        if (tag === 'testsuite') {
            if (closing) {
                suites.pop();
            } else {
                const attrs = attributes(rawAttributes);
                suites.push({ file: attrs.get('file'), line: lineNumber(attrs.get('line')) });
                if (selfClosing) suites.pop();
            }
            continue;
        }
        if (closing || selfClosing) continue;

        const attrs = attributes(rawAttributes);
        const end = xml.indexOf('</testcase>', match.index! + match[0].length);
        if (end === -1) throw new Error('JUnit report has an unterminated testcase');
        const body = xml.slice(match.index! + match[0].length, end);
        if (/<skipped\b/.test(body)) {
            const file = attrs.get('file') ?? [...suites].reverse().find(suite => suite.file)?.file;
            if (!file) throw new Error(`JUnit skipped testcase '${attrs.get('name') ?? '(unnamed)'}' has no source file`);
            cases.push({ file, line: lineNumber(attrs.get('line')), name: attrs.get('name') ?? '(unnamed)', suites: [...suites] });
        }
    }
    if (expectedSkipped !== undefined && cases.length !== expectedSkipped) {
        throw new Error(`JUnit reports ${expectedSkipped} skipped tests but emitted ${cases.length} testcase records`);
    }
    return cases;
}

function repoPath(root: string, file: string): string {
    const rootPath = resolve(root);
    const normalized = file.replaceAll('\\', '/');
    const absolute = isAbsolute(normalized) ? resolve(normalized) : resolve(rootPath, normalized);
    const rel = relative(rootPath, absolute);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(`JUnit source file is outside the repository: ${file}`);
    }
    return rel.split(sep).join('/');
}

function sourceGate(root: string, file: string, line: number | undefined, suites: SuiteFrame[]): string | null {
    const path = join(root, ...file.split('/'));
    if (!existsSync(path)) throw new Error(`Skipped test source is missing: ${file}`);
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const gate = (lineNumber: number | undefined): string | null => {
        if (lineNumber === undefined) return null;
        const text = lines[lineNumber - 1]?.trim();
        if (!text) return null;
        if (/\b(?:describe|test)\.skip(?:If)?\s*\(/.test(text) || /\bskip(?:Unless|377)\s*\(/.test(text)) {
            return `source gate at ${file}:${lineNumber}: ${text}`;
        }
        if (/\b\w+\s*\(/.test(text)) {
            let alias: string | undefined;
            let aliasLine = 0;
            for (let index = Math.min(lines.length - 1, lineNumber - 2); index >= Math.max(0, lineNumber - 41); index--) {
                const candidate = lines[index] ?? '';
                if (/\b(?:describe|test)\.skip\b/.test(candidate)) {
                    alias = candidate;
                    aliasLine = index + 1;
                    break;
                }
            }
            if (alias) return `source gate at ${file}:${aliasLine}: ${alias.trim()} (used by ${file}:${lineNumber}: ${text})`;
        }
        return null;
    };

    for (const suite of [...suites].reverse()) {
        const reason = gate(suite.line);
        if (reason !== null) return reason;
    }
    const direct = gate(line);
    if (direct !== null) return direct;

    const start = Math.max(0, (line ?? lines.length) - 41);
    for (let index = (line ?? lines.length) - 2; index >= start; index--) {
        const text = lines[index]?.trim() ?? '';
        if (/\b(?:describe|test)\.skip(?:If)?\s*\(/.test(text)) return `source gate at ${file}:${index + 1}: ${text}`;
    }
    return null;
}

function escapeSummaryText(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('`', '\\`').replaceAll('|', '\\|');
}

/** Render every JUnit skipped testcase with its explicit SKIP reason or source skip condition. */
export function generateSkipSummary(junit: string, testLog: string, root = process.cwd()): string {
    const cases = parseSkippedCases(junit);
    const reasonsByFile = new Map<string, SkipLine[]>();
    for (const skip of parseSkips(testLog)) {
        const file = repoPath(root, skip.file);
        const reasons = reasonsByFile.get(file) ?? [];
        if (!reasons.some(reason => reason.input === skip.input && reason.reason === skip.reason)) reasons.push(skip);
        reasonsByFile.set(file, reasons);
    }

    const rows = cases.map(testCase => {
        const file = repoPath(root, testCase.file);
        const source = sourceGate(root, file, testCase.line, testCase.suites);
        const explicit = reasonsByFile.get(file) ?? [];
        const gateInput = source?.match(/\bskipUnless\(\s*(['"])([^'"]+)\1\s*\)/)?.[2];
        const matching = gateInput ? explicit.filter(skip => skip.input === gateInput) : explicit;
        const reason = source?.includes('skipUnless(')
            ? matching.map(skip => skip.reason).join('; ') || source
            : explicit.length > 0
                ? `file-level SKIP reason(s): ${explicit.map(skip => skip.reason).join('; ')}`
                : source;
        if (!reason) throw new Error(`Skipped testcase '${testCase.name}' in ${file} has no recorded reason or source skip condition`);
        return `- ${escapeSummaryText(file)}:${testCase.line ?? '?'} — ${escapeSummaryText(testCase.name)} — ${escapeSummaryText(reason)}`;
    });

    if (rows.length === 0) return '## Skipped tests\n\nNone reported by the JUnit report.';
    return [`## Skipped tests (${rows.length})`, '', ...rows].join('\n');
}
