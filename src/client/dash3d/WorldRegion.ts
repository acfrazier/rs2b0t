/**
 * Chunk rotation helpers for REBUILD_REGION instanced scenes: Client-Java 377 `WorldRegion`
 * (`method461`..`method464`). A source 8x8 chunk is placed into the scene rotated clockwise by
 * `rotation` quarter turns; tile and loc coordinates are chunk-local (0..7).
 */
export default class WorldRegion {
    /** Java `method461(rotation, x, z)`: destination chunk-local x of source tile (x, z). */
    static localX(rotation: number, x: number, z: number): number {
        const rot: number = rotation & 0x3;
        if (rot === 0) {
            return x;
        } else if (rot === 1) {
            return z;
        } else if (rot === 2) {
            return 7 - x;
        }
        return 7 - z;
    }

    /** Java `method462(z, x, rotation)`: destination chunk-local z of source tile (x, z). */
    static localZ(z: number, x: number, rotation: number): number {
        const rot: number = rotation & 0x3;
        if (rot === 0) {
            return z;
        } else if (rot === 1) {
            return 7 - x;
        } else if (rot === 2) {
            return 7 - z;
        }
        return x;
    }

    /**
     * Java `method463(rotation, length, locAngle, x, width, z)`: destination chunk-local x of a
     * loc's south-west tile. A loc with an odd `locAngle` swaps its footprint before rotating.
     */
    static locX(rotation: number, length: number, locAngle: number, x: number, width: number, z: number): number {
        let sizeX: number = width;
        let sizeZ: number = length;
        if ((locAngle & 0x1) === 1) {
            sizeX = length;
            sizeZ = width;
        }

        const rot: number = rotation & 0x3;
        if (rot === 0) {
            return x;
        } else if (rot === 1) {
            return z;
        } else if (rot === 2) {
            return 7 - x - (sizeX - 1);
        }
        return 7 - z - (sizeZ - 1);
    }

    /** Java `method464(width, rotation, x, z, length, locAngle)`: the z counterpart of {@link locX}. */
    static locZ(width: number, rotation: number, x: number, z: number, length: number, locAngle: number): number {
        let sizeX: number = width;
        let sizeZ: number = length;
        if ((locAngle & 0x1) === 1) {
            sizeX = length;
            sizeZ = width;
        }

        const rot: number = rotation & 0x3;
        if (rot === 0) {
            return z;
        } else if (rot === 1) {
            return 7 - x - (sizeX - 1);
        } else if (rot === 2) {
            return 7 - z - (sizeZ - 1);
        }
        return x;
    }
}
