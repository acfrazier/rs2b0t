import NpcType from '#/client/config/NpcType.js';
import { resolveMultiNpc } from '#/client/config/resolveMultiloc.js';
import SeqType from '#/client/config/SeqType.js';
import SpotType from '#/client/config/SpotType.js';

import ClientEntity from '#/client/dash3d/ClientEntity.js';
import ClientLocAnim from '#/client/dash3d/ClientLocAnim.js';

import AnimFrame from '#/client/dash3d/AnimFrame.js';
import Model from '#/client/dash3d/Model.js';

/** 377 mask bits — oracle Client-Java getNpcPosExtended / rsbuf NpcInfoProt */
export const enum NpcUpdate {
    CHANGETYPE = 0x1,
    ANIM = 0x2,
    SPOTANIM = 0x4,
    FACESQUARE = 0x8,
    HITMARK2 = 0x10,
    SAY = 0x20,
    FACEENTITY = 0x40,
    HITMARK = 0x80
}

export default class ClientNpc extends ClientEntity {
    type: NpcType | null = null;

    override getTempModel(): Model | null {
        if (this.type == null) {
            return null;
        }

        let model = this.getTempModel2();
        if (model == null) {
            return null;
        }

        this.height = model.minY;

        if (this.spotanimId != -1 && this.spotanimFrame != -1) {
            const spot = SpotType.list[this.spotanimId];
            const spotModel = spot.getTempModel2();

            if (spotModel != null) {
                const temp: Model = Model.copyForAnim(spotModel, true, AnimFrame.animateTransparencies(this.spotanimFrame), false);
                temp.translate(-this.spotanimHeight, 0, 0);
                temp.prepareAnim();
                if (spot.seq && spot.seq.frames) {
                    temp.animate(spot.seq.frames[this.spotanimFrame]);
                }

                temp.labelFaces = null;
                temp.labelVertices = null;

                if (spot.resizeh != 128 || spot.resizev != 128) {
                    temp.resize(spot.resizev, spot.resizeh, spot.resizeh);
                }

                temp.calculateNormals(spot.ambient + 64, spot.contrast + 850, -30, -50, -30, true);

                const models: Model[] = [model, temp];
                model = Model.combine(models, 2);
            }
        }

        // Java ClientNpc.method239: base type field1445 (size), not multi-resolved
        if (this.type.size == 1) {
            model.useAABBMouseCheck = true;
        }

        return model;
    }

    private getTempModel2(): Model | null {
        if (!this.type) {
            return null;
        }

        // NpcType.getTempModel does not auto-resolve multinpc (SC-e: no varProvider).
        const type = resolveMultiNpc(this.type, ClientLocAnim.app?.var ?? []);
        if (!type) {
            return null;
        }

        if (this.primaryAnim < 0 || this.primaryAnimDelay != 0) {
            const secondarySeq = SeqType.list[this.secondaryAnim];
            let secondaryTransform = -1;
            if (this.secondaryAnim >= 0 && secondarySeq.frames) {
                secondaryTransform = secondarySeq.frames[this.secondaryAnimFrame];
            }

            return type.getTempModel(secondaryTransform, -1, null);
        } else {
            const primarySeq = SeqType.list[this.primaryAnim];
            let primaryTransform = -1;
            if (primarySeq.frames) {
                primaryTransform = primarySeq.frames[this.primaryAnimFrame];
            }

            const secondarySeq = SeqType.list[this.secondaryAnim];
            let secondaryTransform = -1;
            if (this.secondaryAnim >= 0 && this.secondaryAnim != this.readyanim && secondarySeq.frames) {
                secondaryTransform = secondarySeq.frames[this.secondaryAnimFrame];
            }

            return type.getTempModel(primaryTransform, secondaryTransform, primarySeq.walkmerge);
        }
    }

    isReady(): boolean {
        return this.type !== null;
    }
}
