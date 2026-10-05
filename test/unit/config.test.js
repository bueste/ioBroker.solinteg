"use strict";

const { expect } = require("chai");
const { parseUnitId } = require("../../lib/config");

describe("parseUnitId", () => {
    it("accepts the whole Modbus TCP range 0-255, including 255 and 0", () => {
        expect(parseUnitId(255)).to.equal(255);
        expect(parseUnitId(247)).to.equal(247);
        expect(parseUnitId(1)).to.equal(1);
        expect(parseUnitId(0)).to.equal(0);
    });

    it("accepts numeric strings as the admin may store them", () => {
        expect(parseUnitId("255")).to.equal(255);
        expect(parseUnitId("0")).to.equal(0);
    });

    it("falls back to the default 255 when unset or empty", () => {
        expect(parseUnitId(undefined)).to.equal(255);
        expect(parseUnitId(null)).to.equal(255);
        expect(parseUnitId("")).to.equal(255);
    });

    it("falls back to the default 255 for out-of-range or non-integer values", () => {
        expect(parseUnitId(256)).to.equal(255);
        expect(parseUnitId(-1)).to.equal(255);
        expect(parseUnitId(1.5)).to.equal(255);
        expect(parseUnitId("abc")).to.equal(255);
    });
});
