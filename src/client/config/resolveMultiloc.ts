import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import VarBitType from '#/client/config/VarBitType.js';

/** Live client.var reference. ClientLocAnim.app's setter keeps this current. */
let liveVarps: number[] = [];

export function setMorphVarps(varps: number[]): void {
    liveVarps = varps;
}

export function getMorphVarps(): number[] {
    return liveVarps;
}

function morphIndex(varbitId: number, varpId: number, varps: number[]): number | null {
    if (varbitId !== -1) {
        const varbit = VarBitType.list[varbitId];
        if (!varbit) {
            return null;
        }
        const width = varbit.endbit - varbit.startbit;
        const mask = 2 ** (width + 1) - 1;
        return ((varps[varbit.basevar] ?? 0) >> varbit.startbit) & mask;
    }
    if (varpId !== -1) {
        return varps[varpId] ?? 0;
    }
    return null;
}

export function resolveMultiloc(loc: LocType, varps: number[]): LocType | null {
    if (loc.multiloc.length === 0) {
        return loc;
    }

    const index = morphIndex(loc.multivarbit ?? -1, loc.multivar ?? -1, varps);
    if (index === null) {
        return null;
    }
    const id = loc.multiloc[index];
    return id === undefined || id === -1 ? null : LocType.list(id);
}

export function resolveMultiNpc(npc: NpcType, varps: number[]): NpcType | null {
    if (npc.multinpc.length === 0) {
        return npc;
    }

    const index = morphIndex(npc.multivarbit ?? -1, npc.multivar ?? -1, varps);
    if (index === null) {
        return null;
    }
    const id = npc.multinpc[index];
    return id === undefined || id === -1 ? null : NpcType.list(id);
}
