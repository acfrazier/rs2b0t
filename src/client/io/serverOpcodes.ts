function isOpcodeList(value: unknown): value is readonly number[] {
    return Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 0 && item < 256);
}

/**
 * Builds the set of server opcodes the client accepts from the generated protocol table.
 * The generated `ServerProtKnown` membership is required; its absence or a malformed value throws.
 */
export function knownServerOpcodes(table: Readonly<Record<string, unknown>>): ReadonlySet<number> {
    if (!isOpcodeList(table.ServerProtKnown)) throw new Error('missing or invalid generated server opcode membership (ServerProtKnown)');
    return new Set(table.ServerProtKnown);
}
