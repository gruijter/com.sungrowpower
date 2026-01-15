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

// const Homey = require('homey');
const { OAuth2App } = require('homey-oauth2app');
const SungrowOAuth2Client = require('./lib/SungrowOAuth2Client');

module.exports = class SungrowApp extends OAuth2App {

  static OAUTH2_CLIENT = SungrowOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = true; // Default: false
  static OAUTH2_MULTI_SESSION = false; // Default: false
  // static OAUTH2_DRIVERS = ['inverter', 'battery']; // Default: all drivers

  async onOAuth2Init() {
    this.everyXminutes(1); // start time trigger emitter
    this.log('Sungrow app has been initialized with OAuth2');
  }

  async onOAuth2Uninit() {
    this.log('app onUninit called');
    this.homey.clearTimeout(this.everyXminutesHandler); // Clear the timeout if it exists
  }

  everyXminutes(interval) {
    let timeoutId;
    const scheduleNextXminutes = () => {
      if (timeoutId) {
        this.homey.clearTimeout(timeoutId); // Clear any existing timeout
      }
      const now = new Date();
      const nextXminutes = new Date(now);
      const currentMinutes = now.getMinutes();
      const nextMultipleOfX = currentMinutes % interval === 0 ? currentMinutes + interval : Math.ceil(currentMinutes / interval) * interval;
      nextXminutes.setMinutes(nextMultipleOfX, 0, 0);
      const timeToNextXminutes = nextXminutes - now;
      // console.log('everyXminutes starts in', timeToNextXminutes / 1000);
      timeoutId = this.homey.setTimeout(() => {
        this.everyXminutesHandler().catch((error) => this.error(error));
        scheduleNextXminutes(); // Schedule the next X minutes
      }, timeToNextXminutes);
    };
    scheduleNextXminutes();
    this.log('everyXminutes job started');
  }

  async everyXminutesHandler() {
    this.homey.emit('everyXminutes'); // emit trigger to homey devices
  }

};
