import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';

const API_ROOT = 'src/bot/api';
const NOUN_DIRS = ['bank', 'shop', 'trade', 'chatbox', 'magic', 'prayer', 'equipment', 'skills', 'ui'];
const IF_IDS_FILE = 'src/bot/data/ifIds.ts';
/** One documented non-component number at its site, or a group of them on the declaration that owns the literals. */
const MARKER = /\/\/[^\n]*\bnon-component\s*:\s*\S{3,}/;

export interface LiteralFinding {
    file: string;
    line: number;
    value: number;
    source: string;
}

/** Every 3-5 digit decimal literal in `text` that is neither named nor documented as a non-component number. */
export function scanSource(file: string, text: string): LiteralFinding[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const lines = text.split('\n');
    const findings: LiteralFinding[] = [];

    const documented = (node: ts.Node): boolean => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        if (MARKER.test(lines[line] ?? '')) {
            return true;
        }

        let statement: ts.Node | undefined = node;
        while (statement !== undefined && !ts.isStatement(statement)) {
            statement = statement.parent;
        }
        if (statement === undefined) {
            return false;
        }

        const comments: readonly ts.CommentRange[] = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? [];
        return comments.some((comment: ts.CommentRange) => MARKER.test(text.slice(comment.pos, comment.end)));
    };

    const visit = (node: ts.Node): void => {
        if (ts.isNumericLiteral(node)) {
            const raw = node.getText(source);
            const plain = raw.replace(/_/g, '');
            if (/^\d+$/.test(plain)) {
                const value = Number(plain);
                const digits = plain.length;
                if (digits >= 3 && digits <= 5 && !documented(node)) {
                    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
                    findings.push({ file, line: line + 1, value, source: raw });
                }
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(source);
    return findings;
}

/** Every TypeScript source under the S7b noun directories. */
export function nounSources(): string[] {
    const files: string[] = [];
    for (const dir of NOUN_DIRS) {
        const root = join(API_ROOT, dir);
        for (const relative of new Bun.Glob('**/*.ts').scanSync(root)) {
            files.push(join(root, relative));
        }
    }
    return files.sort();
}

function scanTree(files: { path: string; text: string }[]): LiteralFinding[] {
    return files.flatMap(({ path, text }) => scanSource(path, text));
}

function fixture(): string {
    return mkdtempSync(join(tmpdir(), 'ifids-census-'));
}

describe('ifIds census scanner', () => {
    test('flags a bare component-sized literal and accepts an inline documented non-component', () => {
        const dir = fixture();
        try {
            mkdirSync(join(dir, 'src'), { recursive: true });
            const bare = join(dir, 'src', 'bare.ts');
            const documentedLiteral = join(dir, 'src', 'documented.ts');
            writeFileSync(bare, 'export const ROOT = 3824;\n');
            writeFileSync(documentedLiteral, 'export const TICK_MS = 600; // non-component: tick length\n');

            expect(scanSource(bare, readFileSync(bare, 'utf8'))).toEqual([
                { file: bare, line: 1, value: 3824, source: '3824' }
            ]);
            expect(scanSource(documentedLiteral, readFileSync(documentedLiteral, 'utf8'))).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('accepts a group marker on the declaration that owns the literals', () => {
        const dir = fixture();
        try {
            const file = join(dir, 'catalog.ts');
            writeFileSync(file, [
                '// non-component: quest obj ids',
                'export const JUNK = [',
                "    [2399, 'Key'],",
                "    [2400, 'Key']",
                '];',
                ''
            ].join('\n'));
            expect(scanSource(file, readFileSync(file, 'utf8'))).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a marker on another statement, in a string, or without a reason does not document the literal', () => {
        const dir = fixture();
        try {
            const detached = join(dir, 'detached.ts');
            writeFileSync(detached, [
                '// non-component: unrelated declaration',
                'export const ONE = 1;',
                '',
                'export const ROOT = 3824;',
                ''
            ].join('\n'));
            expect(scanSource(detached, readFileSync(detached, 'utf8')).map(f => f.value)).toEqual([3824]);

            const quoted = join(dir, 'quoted.ts');
            writeFileSync(quoted, "export const NOTE = 'non-component: text'; export const ROOT = 3824;\n");
            expect(scanSource(quoted, readFileSync(quoted, 'utf8')).map(f => f.value)).toEqual([3824]);

            const empty = join(dir, 'empty.ts');
            writeFileSync(empty, 'export const TICK_MS = 600; // non-component: \n');
            expect(scanSource(empty, readFileSync(empty, 'utf8')).map(f => f.value)).toEqual([600]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('ignores non-decimal literals, short numbers and long ids', () => {
        const dir = fixture();
        try {
            const file = join(dir, 'types.ts');
            writeFileSync(file, [
                'export const SMALL = 99;',
                'export const LONG = 100000;',
                'export const HEX = 0xf80000;',
                'export const FRACTION = 0.5;',
                ''
            ].join('\n'));
            expect(scanSource(file, readFileSync(file, 'utf8'))).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the real S7b tree documents every component-sized literal', () => {
        const files = nounSources();
        expect(files.length).toBeGreaterThanOrEqual(20);
        const findings = scanTree(files.map(path => ({ path, text: readFileSync(path, 'utf8') })));
        expect(findings).toEqual([]);
    });

    test('the tree carries documented non-component numbers rather than none at all', () => {
        const documented = nounSources()
            .map(path => readFileSync(path, 'utf8'))
            .flatMap(text => text.split('\n').filter(line => MARKER.test(line)));
        expect(documented.length).toBeGreaterThanOrEqual(20);
    });

    test('every IF_IDS constant used by the nouns exists in the generated table', () => {
        const generated = readFileSync(IF_IDS_FILE, 'utf8');
        const defined = new Set([...generated.matchAll(/^\s+([A-Z0-9_]+):\s+-?\d+,$/gm)].map(m => m[1]!));
        const used = new Set<string>();
        for (const path of nounSources()) {
            for (const match of readFileSync(path, 'utf8').matchAll(/IF_IDS\.([A-Z0-9_]+)/g)) {
                used.add(match[1]!);
            }
        }

        expect(defined.size).toBeGreaterThanOrEqual(40);
        expect(used.size).toBeGreaterThanOrEqual(20);
        expect([...used].filter(name => !defined.has(name))).toEqual([]);
    });
});
