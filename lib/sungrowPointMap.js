/*
Copyright 2025 - 2026, Robin de Gruijter (rmdegruijter@gmail.com)

This file is part of com.sungrowpower.

com.sungrowpower is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.sungrowpower is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.sungrowpower.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

// https://developer-api.isolarcloud.com/#/document/md?id=12135&project_id=1&version=V2

const batteryMap = {
  14: {
    measure_power: (data) => Number(data.p13126) - Number(data.p13150), // Battery Charging Power - Battery Discharging Power
    measure_battery: (data) => Number(data.p13141) * 100, // Battery Level (SOC) %
    'meter_power.charged': (data) => Number(data.p13034) / 1000, // Total Battery Charging Energy Wh
    'meter_power.discharged': (data) => Number(data.p13035) / 1000, // Battery Discharging Energy Wh
    measure_temperature: (data) => Number(data.p13143), // Battery Temperature °C
  },
  43: {
    measure_power: (data) => Math.round(-Number(data.p58601) * Number(data.p58602)), // -Battery Voltage V *  Battery Current A
    measure_battery: (data) => Number(data.p58604) * 100, // Battery Level (SOC) %
    'meter_power.charged': (data) => Number(data.p58606) / 1000, // Total Battery Charging Energy Wh
    'meter_power.discharged': (data) => Number(data.p58607) / 1000, // Battery Discharging Energy Wh
    measure_temperature: (data) => Number(data.p58603), // Battery Temperature °C
  },
};

const batteryPoints = {
  // Battery Charging Power W, Battery Discharging Power W, Battery Level (SOC) %, Total Battery Charging Energy Wh, Battery Discharging Energy Wh, Battery Temperature °C
  14: ['13126', '13150', '13141', '13034', '13035', '13143'],
  // Battery Voltage V, Battery Current A, Battery Level (SOC) %, Total Battery Charging Energy Wh, Battery Discharging Energy Wh, Battery Temperature °C
  43: ['58601', '58602', '58604', '58606', '58607', '58603'],
};

const chargerMap = {
  51: {
    measure_power: (data) => Number(data.p33708), // Charging Power W
    evcharger_charging: (data) => (Number(data.p33716) === 3), // Charging State 3 = Charging
    evcharger_charging_state: (data) => {
      const status = Number(data.p33716);
      switch (status) {
        case 1: return 'plugged_out'; // Idle (not plugged in)
        case 2: return 'plugged_in'; // Standby (plugged in)
        case 3: return 'plugged_in_charging'; // Charging
        case 4: return 'plugged_in_paused'; // Charging paused (station)
        case 5: return 'plugged_in_paused'; // Charging paused (vehicle)
        case 6: return 'plugged_in'; // Charging completed
        case 7: return 'plugged_out'; // Reserved
        case 8: return 'plugged_out'; // Disabled
        case 9: return 'plugged_out'; // Fault
        default: return 'plugged_out'; // Unknown status
      }
    },
  },
};

const chargerPoints = {
  51: ['33708', '33716'], // Charging Power W, Charging Status
};

const inverterMap = {
  // plant: {
  //   measure_power: (data) => Number(data.p83033), // Plant Power W
  //   meter_power: (data) => Number(data.p83024) / 1000, // Plant total yield
  //   'meter_power.today': (data) => Number(data.p83022) / 1000, // Plant daily yield
  // },
  1: {
    measure_power: (data) => Number(data.p24), // Total Active Power W
    meter_power: (data) => Number(data.p2) / 1000, // Total Yield Wh
    'meter_power.today': (data) => Number(data.p1) / 1000, // Yield Today Wh
    measure_temperature: (data) => Number(data.p4), // Internal Air Temperature °C
  },
  14: {
    measure_power: (data) => Number(data.p13003), // Total DC Power W
    meter_power: (data) => Number(data.p13134) / 1000, // Total PV Yield Wh
    'meter_power.today': (data) => Number(data.p13112) / 1000, // Daily PV yield Wh
    measure_temperature: (data) => Number(data.p13019), // Internal Air Temperature °C
  },
  55: {
    measure_power: (data) => Number(data.p51305), // Total DC Power W
    meter_power: (data) => Number(data.p51302) / 1000, // Total PV Yield Wh
    'meter_power.today': (data) => Number(data.p51346) / 1000, // Daily PV yield Wh
  },
};

const inverterPoints = {
  // plant: ['83033', '83024', '83022'], // Plant Power W, Plant total yield Wh, Plant daily yield Wh
  1: ['24', '2', '1', '4'], // Total Active Power W, Total Yield Wh, Yield Today Wh, Internal Air Temperature °C
  14: ['13003', '13134', '13112', '13019'], // Total DC Power W, Total PV Yield Wh, Daily PV yield Wh, Internal Air Temperature °C
  55: ['51305', '51302', '51346'], // Total DC Power W, Total PV Yield Wh, Daily PV yield Wh
};

const meterMap = {
  7: {
    measure_power: (data) => Number(data.p8018), // Power W
    meter_power: (data) => Number(data.p8085) / 1000, // Total Energy consumed Wh
    measure_frequency: (data) => Number(data.p8064), // Frequency
    'measure_voltage.1': (data) => Number(data.p8000), // Voltage Phase 1 Hz
    'measure_voltage.2': (data) => Number(data.p8001), // Voltage Phase 2 Hz
    'measure_voltage.3': (data) => Number(data.p8002), // Voltage Phase 3 Hz
    'meter_power.imported': (data) => Number(data.p8030) / 1000, // Imported Energy Wh
    'meter_power.exported': (data) => Number(data.p8031) / 1000, // Exported Energy Wh
  },
  14: {
    measure_power: (data) => Number(data.p13149) - Number(data.p13121), // Power W
    meter_power: (data) => (Number(data.p13148) - Number(data.p13125)) / 1000, // Total Energy consumed Wh ??????
    measure_frequency: (data) => Number(data.p13007), // Frequency
    'measure_voltage.1': (data) => Number(data.p18108), // Voltage Phase 1 Hz
    'measure_voltage.2': (data) => Number(data.p18109), // Voltage Phase 2 Hz
    'measure_voltage.3': (data) => Number(data.p18110), // Voltage Phase 3 Hz
    'meter_power.imported': (data) => Number(data.p13148) / 1000, // Imported Energy Wh
    'meter_power.exported': (data) => Number(data.p13125) / 1000, // Exported Energy Wh
  },
};

const meterPoints = {
  // Power W, Total Energy consumed Wh, Frequency, Voltage Phase 1 Hz, Voltage Phase 2 Hz, Voltage Phase 3 Hz, Imported Energy Wh, Exported Energy Wh
  7: ['8018', '8085', '8064', '8000', '8001', '8002', '8030', '8031'],
  // Power W, Total Energy consumed Wh, Frequency, Voltage Phase 1 Hz, Voltage Phase 2 Hz, Voltage Phase 3 Hz, Imported Energy Wh, Exported Energy Wh
  14: ['13149', '13121', '13148', '13125', '13007', '18108', '18109', '18110', '13148', '13125'],
};

module.exports = {
  inverterMap, inverterPoints, meterMap, meterPoints, chargerMap, chargerPoints, batteryMap, batteryPoints,
};
