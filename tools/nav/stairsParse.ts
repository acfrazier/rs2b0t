import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';

export function decodeCoord(s: string): NavPoint {
    const [level, mx, mz, lx, lz] = s.split('_').map(Number);
    return { x: mx * 64 + lx, z: mz * 64 + lz, level };
}

export function applyMovecoord(base: NavPoint, args: number[]): NavPoint {
    const [dx, dLevel, dz] = args;
    return { x: base.x + dx, z: base.z + dz, level: base.level + dLevel };
}

export interface StairCase {
    from: NavPoint;
    to: NavPoint;
    debugname: string;
    op: number;
    coordOffset?: NavPoint;
}

const CASE_RE = /case\s+(\d+_\d+_\d+_\d+_\d+)\s*:\s*p_telejump\(\s*(movecoord\([^)]*\)|\d+(?:_\d+)+)\s*\)/g;
const MOVECOORD_RE = /^movecoord\(\s*(loc_coord|coord)(?:\(\s*\))?\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;
const LITERAL_RE = /^\d+(?:_\d+)+$/;

export function parseSwitchStairs(text: string): StairCase[] {
    const out: StairCase[] = [];
    const blockRe = /^\[oploc(\d+),([a-z0-9_]+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
        const op = Number(m[1]);
        const debugname = m[2];
        const end = text.indexOf('\n[', m.index + 1);
        const body = text.slice(m.index, end === -1 ? undefined : end);

        CASE_RE.lastIndex = 0;
        let c: RegExpExecArray | null;
        while ((c = CASE_RE.exec(body)) !== null) {
            const from = decodeCoord(c[1]);
            const dest = c[2].trim();
            const mv = MOVECOORD_RE.exec(dest);
            if (mv) {
                const dx = Number(mv[2]);
                const deltaLevel = Number(mv[3]);
                const dz = Number(mv[4]);
                const row: StairCase = { from, to: applyMovecoord(from, [dx, deltaLevel, dz]), debugname, op };
                if (mv[1] === 'coord') {
                    row.coordOffset = { x: dx, z: dz, level: deltaLevel };
                }
                out.push(row);
            } else if (LITERAL_RE.test(dest)) {
                out.push({ from, to: decodeCoord(dest), debugname, op });
            }
        }
    }
    return out;
}
