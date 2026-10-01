"use strict";

const utils = require("@iobroker/adapter-core");
const { ModbusClient } = require("./lib/modbusClient");
const { buildBlocks } = require("./lib/blocks");
const { registers, registersById } = require("./lib/registers");

const MIN_POLL_INTERVAL_SEC = 3;
const MAX_CONSECUTIVE_ERRORS_BEFORE_RECONNECT = 3;
const MAX_BACKOFF_SEC = 60;

class Solintec extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    constructor(options) {
        super({ ...options, name: "solintec" });

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.modbus = null;
        this.fastTimer = null;
        this.slowTimer = null;
        this.fastBlocks = [];
        this.slowBlocks = [];
        this.consecutiveErrors = 0;
        this.polling = false;
    }

    async onReady() {
        await this.setStateAsync("info.connection", false, true);

        const host = (this.config.host || "").trim();
        if (!host) {
            this.log.error(
                "No inverter host/IP configured. Please set it in the instance configuration.",
            );
            return;
        }
        const port = Number(this.config.port) || 502;
        const unitId = Number(this.config.unitId) || 1;
        this.enableEmsControl = this.config.enableEmsControl === true;

        const fastIntervalSec = Math.max(
            MIN_POLL_INTERVAL_SEC,
            Number(this.config.fastPollInterval) || 5,
        );
        const slowIntervalSec = Math.max(
            fastIntervalSec,
            Number(this.config.slowPollInterval) || 30,
        );

        await this._ensureObjects();

        this.fastBlocks = buildBlocks(
            registers.filter((def) => def.group === "fast"),
        );
        this.slowBlocks = buildBlocks(
            registers.filter((def) => def.group === "slow"),
        );

        this.modbus = new ModbusClient({
            host,
            port,
            unitId,
            timeoutMs:
                Math.max(1, Number(this.config.requestTimeout) || 5) * 1000,
            log: (level, message) => {
                if (typeof this.log[level] === "function") {
                    this.log[level](message);
                } else {
                    this.log.debug(message);
                }
            },
        });

        this.log.info(
            `Solinteg adapter started. Target ${host}:${port} (unit ${unitId}). ` +
                `Fast poll: ${fastIntervalSec}s, slow poll: ${slowIntervalSec}s. ` +
                `EMS write access: ${this.enableEmsControl ? "ENABLED" : "disabled"}.`,
        );
        if (!this.enableEmsControl) {
            this.log.info(
                "EMS write access is disabled by default. Enable it in the instance configuration only if you " +
                    "intend to actively control the inverter/battery (charge power, working mode, limits, ...).",
            );
        }

        await this._connectWithRetry();

        this.fastTimer = this.setInterval(
            () => this._pollSafe("fast"),
            fastIntervalSec * 1000,
        );
        this.slowTimer = this.setInterval(
            () => this._pollSafe("slow"),
            slowIntervalSec * 1000,
        );

        // Run one slow poll immediately so diagnostics/device info populate right away
        // instead of waiting a full slow-poll interval.
        this._pollSafe("slow");
    }

    /**
     * Creates/updates the ioBroker object tree from the register map. Uses extendObjectAsync
     * so object metadata (role/unit/states) stays in sync on adapter upgrades, never a raw
     * setObject that would wipe existing object properties.
     */
    async _ensureObjects() {
        const groups = new Set();
        for (const def of registers) {
            const channel = def.id.split(".")[0];
            groups.add(channel);
        }
        for (const channel of groups) {
            await this.extendObjectAsync(channel, {
                type: "channel",
                common: { name: channel },
                native: {},
            });
        }

        for (const def of registers) {
            let objectType = "number";
            if (def.type === "str") {
                objectType = "string";
            } else if (def.type === "bool") {
                objectType = "boolean";
            }
            const common = {
                name: def.name,
                role: def.role || "value",
                type: objectType,
                read: true,
                write: def.write === true,
            };
            if (def.unit) {
                common.unit = def.unit;
            }
            if (def.type === "map" && def.map) {
                common.states = { ...def.map };
            }
            if (def.write && typeof def.min === "number") {
                common.min = def.min;
            }
            if (def.write && typeof def.max === "number") {
                common.max = def.max;
            }
            await this.extendObjectAsync(def.id, {
                type: "state",
                common,
                native: {},
            });
        }
    }

    async _connectWithRetry() {
        try {
            // TCP-level connect only. info.connection / lastError / consecutiveErrors are
            // deliberately NOT touched here: a device can accept the TCP handshake on port
            // 502 and still never answer a Modbus request (e.g. Modbus TCP disabled in the
            // inverter's own settings), so "connected" must only mean "a register read
            // actually succeeded" - see _poll(). Resetting the error counter here would
            // also defeat the reconnect backoff, since every reconnect would zero it.
            await this.modbus.connect();
        } catch (error) {
            await this.setStateAsync("info.connection", false, true);
            await this.setStateAsync("info.lastError", error.message, true);
            this.log.warn(
                `Modbus connect failed: ${error.message}. Will retry on next poll.`,
            );
        }
    }

    /**
     * @param {"fast"|"slow"} group
     */
    async _pollSafe(group) {
        if (this.polling) {
            // Previous poll (fast or slow) still running - skip this tick rather than overlap requests
            // on the same TCP connection.
            return;
        }
        this.polling = true;
        try {
            await this._poll(group);
        } catch (error) {
            await this._handlePollError(error);
        } finally {
            this.polling = false;
        }
    }

    /**
     * @param {"fast"|"slow"} group
     */
    async _poll(group) {
        if (!this.modbus.connected) {
            await this._connectWithRetry();
            if (!this.modbus.connected) {
                return;
            }
        }

        const blocks = group === "fast" ? this.fastBlocks : this.slowBlocks;
        for (const block of blocks) {
            const words = await this.modbus.readHoldingBlock(
                block.startAddress,
                block.length,
            );
            for (const def of block.defs) {
                const offset = def.address - block.startAddress;
                const length = ModbusClient.registerLength(def);
                const slice = words.slice(offset, offset + length);
                let value = ModbusClient.decode(slice, def.type);
                if (typeof value === "number" && def.scale && def.scale !== 1) {
                    value = Math.round(value * def.scale * 1000) / 1000;
                }
                await this.setStateAsync(def.id, value, true);
            }
        }

        await this.setStateAsync("info.connection", true, true);
        await this.setStateAsync("info.lastSuccess", Date.now(), true);
        await this.setStateAsync("info.lastError", "", true);
        this.consecutiveErrors = 0;
    }

    async _handlePollError(error) {
        this.consecutiveErrors++;
        this.log.warn(
            `Poll failed (${this.consecutiveErrors}x consecutive): ${error.message}`,
        );
        await this.setStateAsync("info.lastError", error.message, true);

        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_RECONNECT) {
            await this.setStateAsync("info.connection", false, true);
            this.modbus.close();
            const backoffSec = Math.min(
                MAX_BACKOFF_SEC,
                this.consecutiveErrors * 5,
            );
            this.log.warn(
                `Too many consecutive errors, reconnecting in ${backoffSec}s.`,
            );
            this.setTimeout(() => this._connectWithRetry(), backoffSec * 1000);
        }
    }

    /**
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const relativeId = id.substring(this.namespace.length + 1);
        const def = registersById.get(relativeId);
        if (!def) {
            return;
        }
        if (!def.write) {
            this.log.warn(
                `${relativeId} is a read-only register, ignoring state change.`,
            );
            return;
        }
        if (!this.enableEmsControl) {
            this.log.warn(
                `Ignoring write to ${relativeId}: EMS write access is disabled. ` +
                    "Enable it in the instance configuration to allow controlling the inverter/battery.",
            );
            return;
        }
        if (!this.modbus || !this.modbus.connected) {
            this.log.warn(
                `Cannot write ${relativeId}: Modbus is not connected.`,
            );
            return;
        }

        try {
            let rawValue = state.val;
            if (typeof rawValue === "number" && def.scale && def.scale !== 1) {
                rawValue = Math.round(rawValue / def.scale);
            }
            if (
                def.write &&
                typeof def.min === "number" &&
                rawValue < def.min
            ) {
                throw new Error(
                    `Value ${rawValue} is below minimum ${def.min}`,
                );
            }
            if (
                def.write &&
                typeof def.max === "number" &&
                rawValue > def.max
            ) {
                throw new Error(
                    `Value ${rawValue} is above maximum ${def.max}`,
                );
            }
            const words = ModbusClient.encode(rawValue, def.type);
            await this.modbus.writeHoldingRegisters(def.address, words);
            await this.setStateAsync(id, state.val, true);
            this.log.info(`Wrote ${relativeId} = ${state.val}`);
        } catch (error) {
            this.log.error(`Failed to write ${relativeId}: ${error.message}`);
        }
    }

    onUnload(callback) {
        try {
            if (this.fastTimer) {
                this.clearInterval(this.fastTimer);
            }
            if (this.slowTimer) {
                this.clearInterval(this.slowTimer);
            }
            if (this.modbus) {
                this.modbus.close();
            }
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new Solintec(options);
} else {
    new Solintec();
}
