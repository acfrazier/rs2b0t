import { gzipSync } from 'fflate';
import { expect, spyOn, test } from 'bun:test';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import LinkList from '#/client/datastruct/LinkList.js';
import OnDemand from '#/client/io/OnDemand.js';
import OnDemandRequest from '#/client/io/OnDemandRequest.js';

test('cache worker receives the selected frame target instead of the wall origin', () => {
    const previousTarget = { ...TARGET };
    const previousWorker = globalThis.Worker;
    let init: unknown;
    class WorkerFixture {
        postMessage(message: unknown) {
            init = message;
        }
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: WorkerFixture });
    try {
        Object.assign(TARGET, resolveTarget('proxy', 'localhost:8081', false, new URLSearchParams('world=2')));
        const loader = Object.create(OnDemand.prototype);
        Object.assign(loader, { app: { ingame: false, db: null }, worker: null, versions: [], crcs: [] });
        Reflect.get(loader, 'startWorker').call(loader);
        expect(init).toEqual({ type: 'init', versions: [], crcs: [], host: 'localhost:8081/__rs2b0t/world/2', secured: false, ingame: false, dbEnabled: false });
    } finally {
        delete TARGET.world;
        delete TARGET.httpPrefix;
        Object.assign(TARGET, previousTarget);
        Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: previousWorker });
    }
});

function loopFixture(data: Uint8Array | null): { loader: OnDemand; request: OnDemandRequest } {
    const loader = Object.create(OnDemand.prototype) as OnDemand;
    const request = new OnDemandRequest();
    request.archive = 0;
    request.file = 7;
    request.data = data;
    const completed = new LinkList<OnDemandRequest>();
    completed.push(request);
    Object.assign(loader, { completed });
    return { loader, request };
}

test('loop strips the two-byte version trailer and gunzips the payload (Java OnDemand.cycle)', () => {
    const payload = Uint8Array.from([1, 2, 3, 4, 5]);
    const { loader, request } = loopFixture(Uint8Array.from([...gzipSync(payload), 0x01, 0x02]));
    expect(loader.loop()).toBe(request);
    expect([...request.data!]).toEqual([...payload]);
});

test('loop hands the caller null data when the archive does not unzip instead of throwing (Java "error unzipping")', () => {
    const { loader, request } = loopFixture(Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9]));
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
        expect(loader.loop()).toBe(request);
        expect(request.data).toBeNull();
        expect(errors).toHaveBeenCalledTimes(1);
    } finally {
        errors.mockRestore();
    }
});
