import { gameHttpUrl, TARGET, type Target } from './target.js';

// Login response 6 triggers one refresh of the baked modulus. The 377 engine has no /loginkey route
// (its web.ts serves only /crc and the archive routes) and keeps one static key in data/config/private.pem,
// so against it the refresh finds nothing newer: /loginkey answers 404 and the scrape of the server's
// client bundle returns the modulus already baked. A host that rotates its keypair on restart, as
// rs2b2t does, serves /loginkey or a bundle that carries the new modulus.

const BAKED_MODULUS = process.env.LOGIN_RSAN ?? '';
const EXPONENT = process.env.LOGIN_RSAE ?? '65537';
const CLIENT_BUNDLE = '/client/client.js';

let modulus = BAKED_MODULUS;

export function loginModulus(): bigint {
    return BigInt(modulus);
}

export function loginExponent(): bigint {
    return BigInt(EXPONENT);
}

export function parseLoginModulus(text: string): string | null {
    const match = /^\d{250,}$/.exec(text.trim());
    return match ? match[0] : null;
}

// Keep the plain-text parser strict; minified bundles use this unanchored fallback.
export function extractLoginModulus(text: string): string | null {
    const match = /\d{250,}/.exec(text);
    return match ? match[0] : null;
}

async function readModulus(url: string, extract: (text: string) => string | null): Promise<string | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            return null;
        }

        return extract(await res.text());
    } catch (_e) {
        return null;
    }
}

export async function refreshLoginKey(target: Target = TARGET): Promise<boolean> {
    const next = (await readModulus(gameHttpUrl('/loginkey', target), parseLoginModulus)) ?? (await readModulus(gameHttpUrl(CLIENT_BUNDLE, target), extractLoginModulus));
    if (!next || next === modulus) {
        return false;
    }

    modulus = next;
    return true;
}

export function resetLoginKey(): void {
    modulus = BAKED_MODULUS;
}
