/** Why: the L1 cell creates one disposable account per run; with `LOGIN_SERVER=false` the engine
 *  loads an existing save for a known username instead of refusing the password, so the random
 *  part must be too large to collide with an earlier run (D3 review note 1).
 */
import { randomBytes } from 'node:crypto';

/** The engine's login username limit; every L1 account name must stay inside it. */
export const USERNAME_LIMIT = 12;

/**
 * A collision-safe account name: `prefix` plus lowercase hex up to the 12-character username
 * limit: eight hex characters (32 bits) under a one-to-four character prefix, seven (28 bits)
 * under a five character one. The 12-bit suffix this replaces could load an earlier run's save.
 */
export function accountName(prefix: string): string {
    if (prefix.length < 1 || prefix.length >= USERNAME_LIMIT) {
        throw new Error(`account prefix must be 1..${USERNAME_LIMIT - 1} characters, got '${prefix}'`);
    }
    return `${prefix}${randomBytes(4).toString('hex').slice(0, USERNAME_LIMIT - prefix.length)}`;
}
