/** Resolve the git commit baked into a client/bot bundle.
 *  Override with RS2B0T_GIT_COMMIT (full SHA) or GITHUB_SHA when the build tree has no .git; RS2B0T_GIT_DIRTY=1|true forces a dirty flag alongside the override. */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export type BuildIdentity = {
    commit: string;
    short: string;
    dirty: boolean;
    builtAt: string;
    /** `dummy` marks the CI `prod` compile, which bakes a fixed public test pair instead of a real
     *  engine key; pack and deploy helpers refuse such an artifact. Absent means a keyed build. */
    rsa?: 'dummy';
};

export interface LoginKey {
    rsae: string;
    rsan: string;
}

export function resolveBuildIdentity(now: () => Date = () => new Date()): BuildIdentity {
    // Why: build:all-targets resolves one identity and passes it down, so the client and bot
    // bundles of a single build cannot disagree about when it happened.
    const builtAt = (process.env.RS2B0T_BUILD_TIME ?? '').trim() || now().toISOString();
    const envCommit = (process.env.RS2B0T_GIT_COMMIT ?? process.env.GITHUB_SHA ?? '').trim();
    if (envCommit) {
        const dirty = /^(1|true|yes)$/i.test(process.env.RS2B0T_GIT_DIRTY ?? '');
        return {
            commit: envCommit,
            short: envCommit.slice(0, 7),
            dirty,
            builtAt
        };
    }
    try {
        const commit = execSync('git rev-parse HEAD', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        let dirty = false;
        try {
            dirty =
                execSync('git status --porcelain', {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim().length > 0;
        } catch {
            // bare repos / sparse checkouts may lack a worktree
        }
        return {
            commit,
            short: commit.slice(0, 7),
            dirty,
            builtAt
        };
    } catch {
        return { commit: 'unknown', short: 'unknown', dirty: false, builtAt };
    }
}

/** Bun `define` map, string values become compile-time literals. */
export function buildIdentityDefines(identity: BuildIdentity): Record<string, string> {
    return {
        'process.env.BUILD_TIME': JSON.stringify(identity.builtAt),
        'process.env.GIT_COMMIT': JSON.stringify(identity.commit),
        'process.env.GIT_COMMIT_SHORT': JSON.stringify(identity.short),
        'process.env.GIT_DIRTY': JSON.stringify(identity.dirty ? '1' : '0')
    };
}

export function buildIdentityLabel(identity: BuildIdentity): string {
    const dirty = identity.dirty ? '-dirty' : '';
    return identity.rsa === 'dummy' ? `${identity.short}${dirty}-dummy` : `${identity.short}${dirty}`;
}

/** Why: both bundlers share one define map, so a build bakes the same target, strict flags and identity into every entry; `rsa` is required because Client.ts reads both LOGIN_* values at load. */
export function buildDefines(identity: BuildIdentity, target: string, rsa: LoginKey): Record<string, string> {
    return {
        'process.env.SECURE_ORIGIN': JSON.stringify(process.env.SECURE_ORIGIN ?? 'false'),
        'process.env.RS2B0T_TARGET': JSON.stringify(target),
        'process.env.LOGIN_RSAE': JSON.stringify(rsa.rsae),
        'process.env.LOGIN_RSAN': JSON.stringify(rsa.rsan),
        // Config decoders enable strict mode only for '1'.
        'process.env.STRICT_PACKETS': JSON.stringify(process.env.STRICT_PACKETS ?? ''),
        'process.env.STRICT_CONFIG': JSON.stringify(process.env.STRICT_CONFIG ?? ''),
        ...buildIdentityDefines(identity)
    };
}

/** Sidecar for `curl .../rs2b0t/version.json` without parsing the JS bundle. */
export function writeVersionJson(path: string, identity: BuildIdentity): void {
    writeFileSync(
        path,
        `${JSON.stringify(
            {
                commit: identity.commit,
                short: identity.short,
                dirty: identity.dirty,
                builtAt: identity.builtAt,
                label: buildIdentityLabel(identity),
                rsa: identity.rsa ?? 'keyed'
            },
            null,
            2
        )}\n`
    );
}
