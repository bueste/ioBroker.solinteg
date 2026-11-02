"use strict";

/** @type {any} */
const Module = require("node:module");
const path = require("node:path");
const { expect } = require("chai");

/**
 * Loads main.js with a minimal stand-in for @iobroker/adapter-core, so the adapter class can be driven
 * without a js-controller. Timers are recorded instead of started.
 */
function loadAdapter() {
    class FakeAdapter {
        constructor() {
            this.config = {};
            this.namespace = "solinteg.0";
            this.states = new Map();
            this.subscribed = [];
            this.timers = [];
            this.cleared = [];
            this.log = { info() {}, warn() {}, error() {}, debug() {} };
        }
        on() {}
        async setStateAsync(id, val) {
            this.states.set(id, val);
        }
        async subscribeStatesAsync(pattern) {
            this.subscribed.push(pattern);
        }
        async extendObjectAsync() {}
        async getObjectAsync() {
            return null;
        }
        setTimeout(fn, ms) {
            const timer = { fn, ms };
            this.timers.push(timer);
            return timer;
        }
        clearTimeout(timer) {
            this.cleared.push(timer);
        }
    }

    const mainPath = path.join(__dirname, "..", "..", "main.js");
    delete require.cache[mainPath];
    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === "@iobroker/adapter-core") {
            return { Adapter: FakeAdapter };
        }
        return originalLoad.call(this, request, ...rest);
    };
    try {
        const factory = require(mainPath);
        return factory({});
    } finally {
        Module._load = originalLoad;
    }
}

describe("Solinteg adapter lifecycle", () => {
    it("subscribes to the writable ems.* states (without it onStateChange is never called)", async () => {
        const adapter = loadAdapter();
        adapter.config = { host: "127.0.0.1", port: 1 };
        adapter._connectWithRetry = async () => {};
        adapter._pollCycle = async () => {};
        await adapter.onReady();
        expect(adapter.subscribed).to.deep.equal(["ems.*"]);
    });

    it("schedules the next poll cycle only after the current one has finished", async () => {
        const adapter = loadAdapter();
        adapter.fastIntervalMs = 5000;
        const polled = [];
        adapter._poll = async (group) => {
            polled.push(group);
            expect(adapter.timers, "no timer may be pending while a poll runs").to.have.length(0);
        };
        await adapter._pollCycle();
        expect(adapter.timers).to.have.length(1);
        expect(adapter.timers[0].ms).to.equal(5000);
        expect(polled).to.deep.equal(["fast", "slow"]);
    });

    it("polls the slow group only when its interval has elapsed", async () => {
        const adapter = loadAdapter();
        adapter.fastIntervalMs = 5000;
        adapter.slowIntervalMs = 30000;
        adapter.modbus = { connected: true };
        const polled = [];
        adapter._poll = async (group) => {
            polled.push(group);
        };
        await adapter._pollCycle();
        await adapter._pollCycle();
        expect(polled).to.deep.equal(["fast", "slow", "fast"]);
        adapter.lastSlowPoll = Date.now() - 31000;
        await adapter._pollCycle();
        expect(polled).to.deep.equal(["fast", "slow", "fast", "fast", "slow"]);
    });

    it("keeps the slow group due while the inverter is not connected", async () => {
        const adapter = loadAdapter();
        adapter.modbus = { connected: false };
        adapter._poll = async () => {};
        await adapter._pollCycle();
        expect(adapter.lastSlowPoll).to.equal(0);
    });

    it("keeps polling after a failed cycle", async () => {
        const adapter = loadAdapter();
        adapter.modbus = { connected: true, close() {} };
        adapter._poll = async () => {
            throw new Error("timeout");
        };
        await adapter._pollCycle();
        expect(adapter.consecutiveErrors).to.equal(1);
        expect(adapter.timers).to.have.length(1);
    });

    it("delays reconnects after repeated errors instead of reconnecting on every cycle", async () => {
        const adapter = loadAdapter();
        let connects = 0;
        adapter.modbus = {
            connected: false,
            async connect() {
                connects++;
                throw new Error("refused");
            },
        };
        await adapter._connectWithRetry();
        await adapter._connectWithRetry();
        await adapter._connectWithRetry();
        expect(connects).to.equal(1);
        expect(adapter.reconnectNotBefore).to.be.greaterThan(Date.now());
    });

    it("stops scheduling and clears the pending timer on unload", async () => {
        const adapter = loadAdapter();
        adapter.modbus = { connected: false, close() {} };
        adapter._poll = async () => {};
        await adapter._pollCycle();
        const pending = adapter.timers[0];
        await new Promise((resolve) => adapter.onUnload(resolve));
        expect(adapter.cleared).to.deep.equal([pending]);
        await adapter._pollCycle();
        expect(adapter.timers).to.have.length(1);
    });
});
