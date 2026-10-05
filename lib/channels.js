"use strict";

/**
 * Helpers for the channel objects of the object tree. ioBroker requires an object for EVERY
 * segment of a state id (`pv.string1.voltage` needs `pv` and `pv.string1`), so the channels
 * are derived from all register ids instead of only their first segment.
 */

const CHANNEL_NAMES = {
    info: "Information",
    diag: "Diagnostics",
    pv: "PV",
    grid: "Grid",
    meter: "Meter",
    battery: "Battery",
    energy: "Energy",
    ems: "EMS control",
};

/**
 * All intermediate paths of the given state ids (every prefix except the id itself), unique,
 * parents before children.
 *
 * @param {string[]} ids state ids without the adapter namespace, e.g. "pv.string1.voltage"
 * @returns {string[]} e.g. ["pv", "pv.string1"]
 */
function channelPaths(ids) {
    const paths = new Set();
    for (const id of ids) {
        const parts = id.split(".");
        for (let i = 1; i < parts.length; i++) {
            paths.add(parts.slice(0, i).join("."));
        }
    }
    return [...paths].sort(
        (a, b) =>
            a.split(".").length - b.split(".").length || a.localeCompare(b),
    );
}

/**
 * Readable name of a channel path: a fixed name for the top-level groups, otherwise the last
 * segment with a number split off ("string1" -> "String 1").
 *
 * @param {string} path
 * @returns {string}
 */
function channelName(path) {
    if (CHANNEL_NAMES[path]) {
        return CHANNEL_NAMES[path];
    }
    const last = path.split(".").pop();
    const match = /^([A-Za-z]+?)(\d+)$/.exec(last);
    const label = match ? `${match[1]} ${match[2]}` : last;
    return label.charAt(0).toUpperCase() + label.slice(1);
}

module.exports = { channelPaths, channelName, CHANNEL_NAMES };
