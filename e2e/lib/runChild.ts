/** Child-process runner for the e2e gates and harnesses. */
import { errorTail } from '../../tools/lib/e2e-report.js';

export type Status = 'pass' | 'fail' | 'timeout' | 'skip';

/** Output check run on a finished child. */
export type Verdict = (text: string) => Status;

/**
 * A gate passes only when the child exited 0 and the verdict accepts its output.
 * Why: a nonzero exit fails whatever the output says (plan pitfall 10); a clean marker printed before a crash must not rescue it.
 */
export function settle(timedOut: boolean, code: number, text: string, verdict?: Verdict): Status {
    if (timedOut) return 'timeout';
    if (code !== 0) return 'fail';
    return verdict ? verdict(text) : 'pass';
}

const TTY = Boolean(process.stdout.isTTY);
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
/** How often a non-TTY run (cron, CI) prints a still-alive line. */
const HEARTBEAT_MS = 30_000;

function statusLine(label: string, started: number, last: string): void {
    const el = `${Math.floor((Date.now() - started) / 1000)}s`.padStart(5);
    const text = `  ⏳ ${label} ${el}  ${last}`.slice(0, (process.stdout.columns || 100) - 1);
    if (TTY) process.stdout.write(`\r\u001b[2K${text}`);
    else console.log(text);
}

export async function run(label: string, cmd: string[], logFile: string, budgetMs: number, verdict?: Verdict, caseEnv?: Readonly<Record<string, string>>): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    // Why: the case env lands after HEADED so a case may ask for a headed run of its own.
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HEADED: '0', ...caseEnv } });
    const timer = setTimeout(() => proc.kill(9), budgetMs);
    const log = Bun.file(logFile).writer();
    const lines: string[] = [];
    const verdictLines: string[] | null = verdict === undefined ? null : [];
    let last = '';
    let beat = Date.now();

    const recordLine = (line: string, terminated: boolean): void => {
        log.write(terminated ? `${line}\n` : line);
        lines.push(line);
        if (lines.length > 400) lines.shift();
        verdictLines?.push(line);

        const clean = line.trim();
        if (!clean) return;
        last = clean;
        if (VERBOSE) {
            if (TTY) process.stdout.write('\r\u001b[2K');
            console.log(`     ${clean}`.slice(0, (process.stdout.columns || 100) - 1));
        } else if (TTY || Date.now() - beat > HEARTBEAT_MS) {
            beat = Date.now();
            statusLine(label, started, clean);
        }
    };

    const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
        const decoder = new TextDecoder();
        const rd = stream.getReader();
        let buf = '';
        for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n');
            buf = parts.pop() ?? '';
            for (const line of parts) recordLine(line, true);
        }
        buf += decoder.decode();
        if (buf.length > 0) recordLine(buf, false);
    };

    const ticker = TTY && !VERBOSE ? setInterval(() => statusLine(label, started, last), 1000) : null;
    await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
    const code = await proc.exited;
    clearTimeout(timer);
    clearInterval(ticker ?? undefined);
    if (TTY) process.stdout.write('\r\u001b[2K');
    await log.end();

    const ms = Date.now() - started;
    const text = verdictLines?.join('\n') ?? '';
    const timedOut = ms >= budgetMs - 1000;
    return { status: settle(timedOut, code, text, verdict), ms, tail: errorTail(lines) };
}
