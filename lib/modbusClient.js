"use strict";

const ModbusRTU = require("modbus-serial");

/**
 * Thin wrapper around `modbus-serial` for Modbus TCP: connection/reconnect handling
 * plus encode/decode for the register types used in lib/registers.js.
 */
class ModbusClient {
    /**
     * @param {object} opts
     * @param {string} opts.host
     * @param {number} opts.port
     * @param {number} opts.unitId
     * @param {number} [opts.timeoutMs]
     * @param {(level: string, message: string) => void} [opts.log]
     */
    constructor(opts) {
        this.host = opts.host;
        this.port = opts.port;
        this.unitId = opts.unitId;
        this.timeoutMs = opts.timeoutMs || 5000;
        this.log = opts.log || (() => {});
        this.client = new ModbusRTU();
        this.connected = false;
    }

    /**
     * Opens the Modbus TCP connection, if not already connected.
     */
    async connect() {
        if (this.connected) {
            return;
        }
        await this.client.connectTCP(this.host, { port: this.port });
        this.client.setID(this.unitId);
        this.client.setTimeout(this.timeoutMs);
        this.connected = true;
        this.log(
            "info",
            `Modbus TCP connected to ${this.host}:${this.port} (unit ${this.unitId}).`,
        );
    }

    /**
     * Closes the Modbus TCP connection, if open.
     */
    close() {
        if (!this.connected) {
            return;
        }
        try {
            this.client.close(() => {});
        } catch {
            // ignore close errors, socket is going away regardless
        }
        this.connected = false;
    }

    /**
     * Reads a contiguous block of holding registers.
     *
     * @param {number} address
     * @param {number} length
     * @returns {Promise<number[]>} raw 16-bit register words
     */
    async readHoldingBlock(address, length) {
        if (!this.connected) {
            throw new Error("Modbus client is not connected");
        }
        const result = await this.client.readHoldingRegisters(address, length);
        return result.data;
    }

    /**
     * Writes a single or multi-register holding value.
     *
     * @param {number} address
     * @param {number[]} words
     */
    async writeHoldingRegisters(address, words) {
        if (!this.connected) {
            throw new Error("Modbus client is not connected");
        }
        if (words.length === 1) {
            await this.client.writeRegister(address, words[0]);
        } else {
            await this.client.writeRegisters(address, words);
        }
    }

    /**
     * Decodes a slice of raw register words according to a register definition's type.
     *
     * @param {number[]} words raw 16-bit words, big-endian register order
     * @param {"u16"|"s16"|"u32"|"s32"|"str"|"map"|"bool"} type
     * @returns {number|string|boolean}
     */
    static decode(words, type) {
        switch (type) {
            case "u16":
            case "map":
                return words[0];
            case "bool":
                return words[0] !== 0;
            case "s16":
                return ModbusClient._toSigned16(words[0]);
            case "u32":
                return ((words[0] << 16) >>> 0) + words[1];
            case "s32": {
                const unsigned = ((words[0] << 16) >>> 0) + words[1];
                return unsigned > 0x7fffffff
                    ? unsigned - 0x100000000
                    : unsigned;
            }
            case "str":
                return ModbusClient._decodeString(words);
            case "fw":
                return ModbusClient._decodeFirmware(words);
            default:
                throw new Error(`Unknown register type: ${type}`);
        }
    }

    /**
     * Encodes a value into raw register words for writing, according to a register definition's type.
     *
     * @param {number|boolean} value
     * @param {"u16"|"s16"|"u32"|"s32"|"map"|"bool"} type
     * @returns {number[]}
     */
    static encode(value, type) {
        switch (type) {
            case "u16":
            case "map":
                return [value & 0xffff];
            case "bool":
                return [value ? 1 : 0];
            case "s16":
                return [
                    value < 0 ? (value + 0x10000) & 0xffff : value & 0xffff,
                ];
            case "u32": {
                const v = value >>> 0;
                return [(v >>> 16) & 0xffff, v & 0xffff];
            }
            case "s32": {
                const v = value < 0 ? value + 0x100000000 : value;
                return [(v >>> 16) & 0xffff, v & 0xffff];
            }
            default:
                throw new Error(`Register type "${type}" is not writable`);
        }
    }

    /**
     * @param {number} raw
     * @returns {number}
     */
    static _toSigned16(raw) {
        return raw > 0x7fff ? raw - 0x10000 : raw;
    }

    /**
     * Decodes the firmware register (4 words = 8 bytes) into "V<b0>.<b1>.<b2>.<b3>-<b4>.<b5>.<b6>.<b7>",
     * the notation of the Solinteg tools (e.g. words [2566,1028,778,3328] -> "V10.6.4.4-3.10.13.0").
     *
     * @param {number[]} words
     * @returns {string}
     */
    static _decodeFirmware(words) {
        const bytes = [];
        for (const word of words) {
            bytes.push((word >> 8) & 0xff, word & 0xff);
        }
        return `V${bytes.slice(0, 4).join(".")}-${bytes.slice(4, 8).join(".")}`;
    }

    /**
     * Decodes a fixed-length ASCII string packed 2 chars per register (big-endian byte order),
     * trimming trailing NUL padding.
     *
     * @param {number[]} words
     * @returns {string}
     */
    static _decodeString(words) {
        const bytes = [];
        for (const word of words) {
            bytes.push((word >> 8) & 0xff, word & 0xff);
        }
        let str = "";
        for (const byte of bytes) {
            if (byte === 0) {
                break;
            }
            str += String.fromCharCode(byte);
        }
        return str.trim();
    }

    /**
     * Returns the register word count for a given register definition (length override,
     * or the natural size of its type).
     *
     * @param {{type: string, length?: number}} def
     * @returns {number}
     */
    static registerLength(def) {
        if (def.length) {
            return def.length;
        }
        switch (def.type) {
            case "u32":
            case "s32":
                return 2;
            default:
                return 1;
        }
    }
}

module.exports = { ModbusClient };
