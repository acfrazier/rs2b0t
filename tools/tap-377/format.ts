/** Development-only recording schema. Game frames include the decrypted opcode and wire length prefix. */
export const TAP_VERSION = 1;
export const ARCHIVES = ['crc', 'title', 'config', 'interface', 'media', 'versionlist', 'textures', 'wordenc', 'sounds'] as const;
export type ArchiveName = (typeof ARCHIVES)[number];
export type Direction = 'in' | 'out';
export interface Descriptor { name: string; id: number; length: number }
export interface Protocol { revision: number; client: Descriptor[]; server: Descriptor[] }
export interface RecordingHeader {
    type: 'header';
    tapVersion: 1;
    revision: number;
    engineCommit: string;
    contentCommit: string;
    clientCommit: string;
    accountPrefix: string;
    archiveHashes: Record<ArchiveName, string>;
    tickBasis: 'player-info';
}
export interface LoginRecord {
    type: 'login';
    segment: number;
    replies: number[];
    staffmodlevel: number;
    mouseTracked: boolean;
    reconnect: boolean;
}
export interface FrameRecord {
    type: 'frame';
    segment: number;
    direction: Direction;
    tick: number;
    /** Per-direction, per-segment count, starting at one. */
    ordinal: number;
    /** Lowercase hexadecimal, including opcode and variable length prefix. */
    bytes: string;
}
export interface CheckpointState {
    serverTile: { x: number; z: number; level: number };
    sceneState: number;
    ingame: boolean;
    sceneInstanced: boolean;
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
}
export interface CheckpointRecord {
    type: 'checkpoint';
    segment: number;
    label: string;
    inboundCount: number;
    state: CheckpointState;
}
export interface EndRecord {
    type: 'end';
    segment: number;
    reason: 'logout' | 'reconnect';
    inboundCount: number;
    outboundCount: number;
}
export type RecordingRecord = RecordingHeader | LoginRecord | FrameRecord | CheckpointRecord | EndRecord;
export interface CacheBundle {
    format: 1;
    /** Original HTTP response bytes, base64 encoded. */
    archives: Record<ArchiveName, string>;
    /** Reassembled compressed OnDemand files including their version suffix, keyed by archive/file. */
    ondemand: Record<string, string>;
}
export interface RecordingIndex {
    format: 1;
    recordings: { file: string; sha256: string; cacheSha256: string; revision: number }[];
}
