"use strict";

/**
 * Modbus unit (slave) ID. Over Modbus TCP the valid range is 0-255 (the 1-247 limit only
 * applies to serial RTU slaves), and some gateways expect 255. Anything missing, empty or
 * out of range falls back to 1. 0 is a valid value and must not be treated as "unset".
 *
 * @param {unknown} value
 * @returns {number}
 */
function parseUnitId(value) {
    if (value === undefined || value === null || value === "") {
        return 1;
    }
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : 1;
}

module.exports = { parseUnitId };
