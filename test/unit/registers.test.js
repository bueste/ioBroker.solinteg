"use strict";

const { expect } = require("chai");
const { registers, registersById } = require("../../lib/registers");
const { ModbusClient } = require("../../lib/modbusClient");

const VALID_TYPES = new Set(["u16", "s16", "u32", "s32", "str", "fw", "map", "bool"]);
const VALID_GROUPS = new Set(["fast", "slow"]);

// Roles actually used in registers.js, each checked against the official ioBroker
// state-roles reference (https://github.com/ioBroker/ioBroker.docs, "State roles"):
// role -> required common.write value ("value.*" roles are read-only, "level"/"switch" are writable).
const KNOWN_ROLES = {
    value: false,
    "value.voltage": false,
    "value.current": false,
    "value.power": false,
    "value.energy": false,
    "value.temperature": false,
    "value.battery": false,
    "value.frequency": false,
    "info.serial": false,
    "info.firmware": false,
    "info.name": false,
    level: true,
    "level.battery": true,
    "level.current": true,
    switch: true,
};

describe("registers", () => {
    it("is a non-empty array", () => {
        expect(registers).to.be.an("array").that.is.not.empty;
    });

    it("has a unique id for every register", () => {
        const ids = registers.map((def) => def.id);
        expect(new Set(ids).size).to.equal(ids.length);
    });

    it("registersById contains every register, keyed by its id", () => {
        expect(registersById.size).to.equal(registers.length);
        for (const def of registers) {
            expect(registersById.get(def.id)).to.equal(def);
        }
    });

    it("has well-formed dot-path ids (channel.state, no leading/trailing dots)", () => {
        for (const def of registers) {
            expect(def.id).to.match(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)+$/, def.id);
        }
    });

    it("uses only known register types and poll groups", () => {
        for (const def of registers) {
            expect(VALID_TYPES.has(def.type), `${def.id}: unknown type "${def.type}"`).to.be.true;
            expect(VALID_GROUPS.has(def.group), `${def.id}: unknown group "${def.group}"`).to.be.true;
        }
    });

    it("has a name and a positive integer address for every register", () => {
        for (const def of registers) {
            expect(def.name, def.id).to.be.a("string").that.is.not.empty;
            expect(def.address, def.id).to.be.a("number");
            expect(Number.isInteger(def.address), def.id).to.be.true;
            expect(def.address, def.id).to.be.at.least(0);
        }
    });

    it("provides a map for every 'map'-typed register", () => {
        for (const def of registers.filter((d) => d.type === "map")) {
            expect(def.map, def.id).to.be.an("object");
            expect(Object.keys(def.map || {}).length, def.id).to.be.greaterThan(0);
        }
    });

    it("does not mark non-numeric (str) registers as writable", () => {
        for (const def of registers.filter((d) => d.write)) {
            expect(def.type, def.id).to.not.equal("str");
        }
    });

    it("gives every writable numeric register a min/max range", () => {
        for (const def of registers.filter((d) => d.write && d.type !== "map" && d.type !== "bool")) {
            expect(def.min, `${def.id} missing min`).to.be.a("number");
            expect(def.max, `${def.id} missing max`).to.be.a("number");
            expect(def.min, def.id).to.be.lessThan(Number(def.max));
        }
    });

    it("uses only officially documented ioBroker state roles", () => {
        for (const def of registers) {
            expect(
                Object.prototype.hasOwnProperty.call(KNOWN_ROLES, String(def.role)),
                `${def.id}: role "${def.role}" is not in the official ioBroker state-roles list`,
            ).to.be.true;
        }
    });

    it("only uses read-only ('value.*'/'info.*') roles on read-only registers, and vice versa", () => {
        for (const def of registers) {
            const roleRequiresWrite = KNOWN_ROLES[def.role];
            expect(
                Boolean(def.write),
                `${def.id}: role "${def.role}" requires common.write=${roleRequiresWrite}, but write=${Boolean(def.write)}`,
            ).to.equal(roleRequiresWrite);
        }
    });

    it("only uses role 'switch' on boolean-typed registers", () => {
        for (const def of registers.filter((d) => d.role === "switch")) {
            expect(def.type, `${def.id}: role "switch" requires common.type=boolean`).to.equal("bool");
        }
    });

    it("does not have two registers overlapping the same address range", () => {
        const sorted = [...registers].sort((a, b) => a.address - b.address);
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const prevEnd = prev.address + ModbusClient.registerLength(prev);
            expect(
                sorted[i].address,
                `${prev.id} (${prev.address}-${prevEnd - 1}) overlaps ${sorted[i].id} (${sorted[i].address})`,
            ).to.be.at.least(prevEnd);
        }
    });
});
