"use strict";

const utils = require("@iobroker/adapter-core");
const { ModbusClient } = require("./lib/modbusClient");
const { buildBlocks } = require("./lib/blocks");
const { registers, registersById } = require("./lib/registers");
const { parseUnitId } = require("./lib/config");
const { readValue, toRawValue } = require("./lib/convert");
const { channelPaths, channelName } = require("./lib/channels");

const MIN_POLL_INTERVAL_SEC = 3;
const MAX_CONSECUTIVE_ERRORS_BEFORE_RECONNECT = 3;
const MAX_BACKOFF_SEC = 60;

class Solinteg extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    constructor(options) {
        super({ ...options, name: "solinteg" });

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        // Placeholder (never connected) so that this.modbus is always a ModbusClient; onReady()
        // replaces it with the configured one.
        this.modbus = new ModbusClient({ host: "", port: 502, unitId: 255 });
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
        const unitId = parseUnitId(this.config.unitId);
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
        // One channel per path segment, so that pv.string1.voltage has both "pv" and "pv.string1".
        for (const channel of channelPaths(registers.map((def) => def.id))) {
            await this.extendObjectAsync(channel, {
                type: "channel",
                common: { name: channelName(channel) },
                native: {},
            });
        }

        for (const def of registers) {
            /** @type {ioBroker.CommonType} */
            let objectType = "number";
            if (def.type === "str" || def.type === "fw") {
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
            // def.min/def.max are deliberately NOT published as common.min/max: they are the range for
            // WRITING, but the inverter may report values outside it (e.g. import limit 650 kW when
            // the limit is off, charge cutoff 100 %), and js-controller warns on every such update.
            // The range is enforced in onStateChange() instead.
            await this.extendObjectAsync(def.id, {
                type: "state",
                common,
                native: {},
            });
            // extendObject only adds or overwrites keys, it never removes them: objects created by
            // an earlier version still carry common.min/common.max and would keep the warnings.
            const existing = await this.getObjectAsync(def.id);
            if (
                existing &&
                existing.common &&
                (existing.common.min !== undefined ||
                    existing.common.max !== undefined)
            ) {
                delete existing.common.min;
                delete existing.common.max;
                await this.setObjectAsync(def.id, existing);
            }
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
                const converted = readValue(def, slice);
                if (converted.skip) {
                    // "no value" marker (e.g. 0xFFFF on a command register): clear the state instead of
                    // leaving a stale value from an earlier poll or an earlier version.
                    await this.setStateAsync(def.id, null, true);
                    continue;
                }
                await this.setStateAsync(def.id, converted.value, true);
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

        // A string (or null) must never reach the register encoder: it would be written as 0.
        if (typeof state.val !== "number" && typeof state.val !== "boolean") {
            this.log.warn(
                `Ignoring write to ${relativeId}: the value must be a number or boolean, got ${state.val === null ? "null" : typeof state.val}.`,
            );
            return;
        }

        try {
            const rawValue = toRawValue(def, state.val);
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
    module.exports = (options) => new Solinteg(options);
} else {
    new Solinteg();
}
