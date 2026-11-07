import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import VarBitType from '#/client/config/VarBitType.js';

type MultiNpc = {
    multinpc?: number[];
    multivarbit?: number;
    multivar?: number;
};

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

export function resolveMultiNpc(npc: NpcType, varps: number[]): NpcType | null {
    const morph = npc as NpcType & MultiNpc;
    if (!morph.multinpc || morph.multinpc.length === 0) {
        return npc;
    }

    const index = morphIndex(morph.multivarbit ?? -1, morph.multivar ?? -1, varps);
    if (index === null) {
        return null;
    }
    const id = morph.multinpc[index];
    return id === undefined || id === -1 ? null : NpcType.list(id);
}

export function resolveMultiloc(loc: LocType, varps: number[]): LocType | null {
    if (loc.multiloc.length === 0) {
        return loc;
    }

    const varbit = VarBitType.list[loc.multivarbit];
    if (!varbit) {
        return null;
    }

    const width = varbit.endbit - varbit.startbit;
    const mask = 2 ** (width + 1) - 1;
    const index = ((varps[varbit.basevar] ?? 0) >> varbit.startbit) & mask;
    const id = loc.multiloc[index];
    return id === undefined || id === -1 ? null : LocType.list(id);
}
