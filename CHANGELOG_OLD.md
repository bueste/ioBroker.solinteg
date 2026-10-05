# Older changes

### 0.1.3 (2026-10-05)

- The default Modbus unit ID is now 255 (Solinteg MHT over Modbus TCP), not 1.
- Verified against a real MHT-25~50K-100: all 73 registers of the map answer, 32-bit word order and all scales confirmed. Fixes: `ems.chargeCutoffSoc` is read in 0.1 % but written in whole percent; the min/max of writable registers is checked in the unit of the state (before: against the raw register value, which rejected valid writes, e.g. 50 kW for a 0.1 kW register); `ems.offGridSwitch` no longer reports `true` when the register holds 0xFFFF (no command pending); state ranges are no longer published as `common.min/max` (they caused a warning on every poll for values the inverter legitimately reports outside the write range, e.g. import limit 650 kW); `info.firmwareVersion` is now text (`V10.6.4.4-3.10.13.0`).
- New states: `energy.acGenerationToday/Total`, `diag.temperatureR/S/T`, `diag.operationFlags`, `diag.armFaultFlags1/2`, `grid.backupPower`, `meter.gridExportToday/gridImportToday`, and the EMS settings `ems.upsFunction`, `ems.gridUnbalancedOutput`, `ems.batteryProtectionRelax`, `ems.batterySocProtectionOnGrid/OffGrid`, `ems.acCtrlPhaseA/B/CPower` (writable only with EMS write access).

### 0.1.2 (2026-10-05)

- Fix: the Modbus unit ID can now be set to any value from 0 to 255 (the admin field was limited to 1-247 and refused 255; 0 was treated as unset).

### 0.1.1 (2026-10-03)

- Renamed the adapter from "solintec" to "solinteg" (the npm package, repository and instance were misspelled; the manufacturer is Solinteg). The old package `iobroker.solintec` is deprecated. Migration: install `iobroker.solinteg`, create an instance, copy the settings, remove the old `solintec` instance.
- Fix: `info.connection` is only set to true after a real Modbus response, no longer merely because the TCP connection could be opened.

### 0.1.0 (2026-08-15)

- Initial release: reads PV, grid/meter and battery values from a Solinteg MHT-25~50K-100 hybrid inverter (Dyness STACK100 battery via CAN/RS485) over local Modbus TCP. Optional EMS write access is disabled by default.
