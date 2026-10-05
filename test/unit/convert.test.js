"use strict";

const { expect } = require("chai");
const { readValue, toRawValue } = require("../../lib/convert");
const { ModbusClient } = require("../../lib/modbusClient");
const { registers, registersById } = require("../../lib/registers");

describe("readValue", () => {
    it("applies the read scale", () => {
        expect(readValue({ type: "u16", scale: 0.1 }, [2332])).to.deep.equal({ skip: false, value: 233.2 });
    });

    it("reads the charge cutoff SOC in 0.1 % (raw 1000 = 100 %), as the device reports it", () => {
        const def = registersById.get("ems.chargeCutoffSoc");
        expect(readValue(def, [1000])).to.deep.equal({ skip: false, value: 100 });
    });

    it("does not publish a command register that reads 0xFFFF (no command pending) as true", () => {
        const def = registersById.get("ems.offGridSwitch");
        expect(readValue(def, [0xffff])).to.deep.equal({ skip: true });
        expect(readValue(def, [1])).to.deep.equal({ skip: false, value: true });
        expect(readValue(def, [0])).to.deep.equal({ skip: false, value: false });
    });

    it("decodes 32-bit values with the high word first (AC power -3601 W)", () => {
        expect(readValue({ type: "s32" }, [0xffff, 0xf1ef])).to.deep.equal({ skip: false, value: -3601 });
    });
});

describe("toRawValue", () => {
    it("checks min/max in the unit of the state, BEFORE scaling back to raw (regression: 50 kW was compared as raw 500 against max 100)", () => {
        const def = { type: "u16", scale: 0.1, min: 0, max: 100 };
        expect(toRawValue(def, 50)).to.equal(500);
        expect(() => toRawValue(def, 101)).to.throw(/above maximum 100/);
        expect(() => toRawValue(def, -1)).to.throw(/below minimum 0/);
    });

    it("writes the charge cutoff SOC in whole percent although it is read in 0.1 %", () => {
        const def = registersById.get("ems.chargeCutoffSoc");
        expect(toRawValue(def, 90)).to.equal(90);
        expect(() => toRawValue(def, 99)).to.throw(/above maximum 98/);
        expect(() => toRawValue(def, 5)).to.throw(/below minimum 10/);
    });

    it("passes booleans through untouched", () => {
        expect(toRawValue({ type: "bool" }, true)).to.equal(true);
    });

    it("scales a negative value for a signed register (EMS phase power -3.5 kW -> -350)", () => {
        const def = registersById.get("ems.acCtrlPhaseAPower");
        expect(toRawValue(def, -3.5)).to.equal(-350);
    });
});

describe("firmware register", () => {
    it("decodes the 4 words of the real device to V10.6.4.4-3.10.13.0", () => {
        expect(ModbusClient.decode([2566, 1028, 778, 3328], "fw")).to.equal("V10.6.4.4-3.10.13.0");
    });
});

describe("register map integrity", () => {
    it("has unique ids and unique addresses", () => {
        const ids = registers.map(r => r.id);
        expect(new Set(ids).size).to.equal(ids.length);
        const addrs = registers.map(r => r.address);
        expect(new Set(addrs).size).to.equal(addrs.length);
    });

    it("gives every writable numeric register a min and max in the unit of the state", () => {
        for (const r of registers) {
            if (r.write && (r.type === "u16" || r.type === "s16" || r.type === "u32" || r.type === "s32")) {
                expect(r, r.id).to.have.property("min");
                expect(r, r.id).to.have.property("max");
            }
        }
    });

    it("covers the registers found on the real inverter on 2026-10-05", () => {
        for (const id of ["energy.acGenerationToday", "diag.temperatureR", "diag.operationFlags", "grid.backupPower", "meter.gridExportToday"]) {
            expect(registersById.has(id), id).to.equal(true);
        }
    });
});
