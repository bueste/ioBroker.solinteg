"use strict";

/**
 * Pure conversion helpers between raw Modbus words and ioBroker state values, so the rules
 * (read scale, write scale, range check, "no value" markers) are unit-testable.
 */

const { ModbusClient } = require("./modbusClient");

/**
 * Decodes the raw words of a register into the value to publish, or reports that the register
 * currently holds a "nothing to report" marker (def.ignoreRaw, e.g. 0xFFFF on a command register).
 *
 * @param {object} def register definition
 * @param {number[]} words raw words of exactly this register
 * @returns {{skip: true} | {skip: false, value: number|string|boolean}}
 */
function readValue(def, words) {
    if (Array.isArray(def.ignoreRaw) && def.ignoreRaw.includes(words[0])) {
        return { skip: true };
    }
    let value = ModbusClient.decode(words, def.type);
    if (typeof value === "number" && def.scale && def.scale !== 1) {
        value = Math.round(value * def.scale * 1000) / 1000;
    }
    return { skip: false, value };
}

/**
 * Converts a value written to a state into the raw number for the register. The allowed range
 * (def.min/def.max) is given in the unit of the STATE (kW, %, ...), so it is checked BEFORE the
 * value is scaled back to raw register units. A register may use a different scale for writing
 * than for reading (def.writeScale, e.g. the charge cutoff SOC is read in 0.1 % but written in %).
 *
 * @param {object} def register definition
 * @param {number|boolean} value
 * @returns {number|boolean} raw value to encode
 */
function toRawValue(def, value) {
    if (typeof value === "number") {
        if (typeof def.min === "number" && value < def.min) {
            throw new Error(`Value ${value} is below minimum ${def.min}`);
        }
        if (typeof def.max === "number" && value > def.max) {
            throw new Error(`Value ${value} is above maximum ${def.max}`);
        }
        const scale = def.writeScale ?? def.scale;
        if (scale && scale !== 1) {
            return Math.round(value / scale);
        }
    }
    return value;
}

module.exports = { readValue, toRawValue };
