import { describe, expect, test } from 'bun:test';

import { USERNAME_LIMIT, accountName } from '../../e2e/lib/accountName.js';

describe('accountName', () => {
    test('every generated name is lowercase alphanumerics within the username limit', () => {
        for (const prefix of ['l1x', 'l1rc', 'a', 'abcd4', 'frd3r']) {
            const name = accountName(prefix);
            expect(name.startsWith(prefix)).toBe(true);
            expect(name.length).toBeLessThanOrEqual(USERNAME_LIMIT);
            expect(name).toMatch(/^[a-z0-9]+$/);
            expect(name.slice(prefix.length)).toMatch(/^[0-9a-f]+$/);
        }
    });

    test('the random suffix fills the limit: 28 bits under a five character prefix, 32 otherwise', () => {
        expect(accountName('abcde')).toMatch(/^abcde[0-9a-f]{7}$/);
        expect(accountName('abcde').length).toBe(USERNAME_LIMIT);
        for (const prefix of ['a', 'l1x', 'abcd']) {
            expect(accountName(prefix)).toMatch(new RegExp(`^${prefix}[0-9a-f]{8}$`));
        }
    });

    test('a prefix at the limit or empty is refused instead of silently shortening the suffix', () => {
        expect(() => accountName('')).toThrow();
        expect(() => accountName('abcdefghijkl')).toThrow();
    });
});
