"use strict";

const { expect } = require("chai");
const { channelPaths, channelName } = require("../../lib/channels");
const { registers } = require("../../lib/registers");

describe("channelPaths", () => {
    it("returns every intermediate path, parents first, without the state ids themselves", () => {
        expect(channelPaths(["pv.string1.voltage", "pv.totalPower", "info.connection"])).to.deep.equal([
            "info",
            "pv",
            "pv.string1",
        ]);
    });

    it("gives every state of the register map all of its parent objects (regression: pv.string1 etc. were missing)", () => {
        const paths = new Set(channelPaths(registers.map((r) => r.id)));
        for (const { id } of registers) {
            const parts = id.split(".");
            for (let i = 1; i < parts.length; i++) {
                expect(paths.has(parts.slice(0, i).join(".")), `${id}: ${parts.slice(0, i).join(".")}`).to.equal(true);
            }
        }
        for (let i = 1; i <= 4; i++) {
            expect(paths.has(`pv.string${i}`)).to.equal(true);
        }
    });

    it("lists a parent before any of its children", () => {
        const paths = channelPaths(registers.map((r) => r.id));
        for (const p of paths) {
            const parent = p.split(".").slice(0, -1).join(".");
            if (parent) {
                expect(paths.indexOf(parent), p).to.be.lessThan(paths.indexOf(p));
            }
        }
    });
});

describe("channelName", () => {
    it("uses fixed names for the top-level groups", () => {
        expect(channelName("pv")).to.equal("PV");
        expect(channelName("ems")).to.equal("EMS control");
    });

    it("splits the number off a sub-channel name", () => {
        expect(channelName("pv.string3")).to.equal("String 3");
    });
});
