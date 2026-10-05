"use strict";

// The Solinteg MHT inverters answer on unit ID 255 over Modbus TCP.
const DEFAULT_UNIT_ID = 255;

/**
 * Modbus unit (slave) ID. Over Modbus TCP the valid range is 0-255 (the 1-247 limit only applies
 * to serial RTU slaves). Anything missing, empty or out of range falls back to the default 255.
 * 0 is a valid value and must not be treated as "unset".
 *
 * @param {unknown} value
 * @returns {number}
 */
function parseUnitId(value) {
    if (value === undefined || value === null || value === "") {
        return DEFAULT_UNIT_ID;
    }
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : DEFAULT_UNIT_ID;
}

module.exports = { parseUnitId, DEFAULT_UNIT_ID };
