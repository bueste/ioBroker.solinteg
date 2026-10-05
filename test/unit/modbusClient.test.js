"use strict";

const { expect } = require("chai");
const { ModbusClient } = require("../../lib/modbusClient");

describe("ModbusClient decode/encode", () => {
    it("decodes u16", () => {
        expect(ModbusClient.decode([1234], "u16")).to.equal(1234);
    });

    it("decodes s16 (positive and negative)", () => {
        expect(ModbusClient.decode([100], "s16")).to.equal(100);
        expect(ModbusClient.decode([0xff9c], "s16")).to.equal(-100);
    });

    it("decodes u32 from two big-endian words", () => {
        // 0x0001_0000 = 65536
        expect(ModbusClient.decode([0x0001, 0x0000], "u32")).to.equal(65536);
    });

    it("decodes s32 (negative)", () => {
        // -1 as u32 is 0xFFFFFFFF
        expect(ModbusClient.decode([0xffff, 0xffff], "s32")).to.equal(-1);
    });

    it("decodes s32 (positive)", () => {
        expect(ModbusClient.decode([0x0000, 0x2710], "s32")).to.equal(10000);
    });

    it("decodes an ASCII string packed 2 chars/register, trimming NUL padding", () => {
        // "AB" = 0x4142, "C\0" = 0x4300
        const words = [0x4142, 0x4300];
        expect(ModbusClient.decode(words, "str")).to.equal("ABC");
    });

    it("decodes map type as the raw register value", () => {
        expect(ModbusClient.decode([2], "map")).to.equal(2);
    });

    it("decodes bool (0/1) as false/true", () => {
        expect(ModbusClient.decode([0], "bool")).to.equal(false);
        expect(ModbusClient.decode([1], "bool")).to.equal(true);
    });

    it("encodes bool (false/true) as 0/1", () => {
        expect(ModbusClient.encode(false, "bool")).to.deep.equal([0]);
        expect(ModbusClient.encode(true, "bool")).to.deep.equal([1]);
    });

    it("round-trips u16 encode/decode", () => {
        const words = ModbusClient.encode(4321, "u16");
        expect(ModbusClient.decode(words, "u16")).to.equal(4321);
    });

    it("round-trips s16 encode/decode for a negative value", () => {
        const words = ModbusClient.encode(-150, "s16");
        expect(ModbusClient.decode(words, "s16")).to.equal(-150);
    });

    it("round-trips u32 encode/decode", () => {
        const words = ModbusClient.encode(123456789, "u32");
        expect(ModbusClient.decode(words, "u32")).to.equal(123456789);
    });

    it("round-trips s32 encode/decode for a negative value", () => {
        const words = ModbusClient.encode(-123456, "s32");
        expect(ModbusClient.decode(words, "s32")).to.equal(-123456);
    });

    it("throws for an unknown decode type", () => {
        // @ts-expect-error deliberately invalid type
        expect(() => ModbusClient.decode([1], "bogus")).to.throw();
    });

    it("throws when encoding a non-writable type (str)", () => {
        // @ts-expect-error deliberately invalid value
        expect(() => ModbusClient.encode("x", "str")).to.throw();
    });
});

describe("ModbusClient.registerLength", () => {
    it("returns 1 for u16/s16", () => {
        expect(ModbusClient.registerLength({ type: "u16" })).to.equal(1);
        expect(ModbusClient.registerLength({ type: "s16" })).to.equal(1);
    });

    it("returns 2 for u32/s32", () => {
        expect(ModbusClient.registerLength({ type: "u32" })).to.equal(2);
        expect(ModbusClient.registerLength({ type: "s32" })).to.equal(2);
    });

    it("honors an explicit length override (e.g. for strings)", () => {
        expect(ModbusClient.registerLength({ type: "str", length: 8 })).to.equal(8);
    });
});
