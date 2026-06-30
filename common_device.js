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
const util = require('util');
const { OAuth2Device } = require('homey-oauth2app');

const sungrowPointMap = require('./lib/sungrowPointMap');

const setTimeoutPromise = util.promisify(setTimeout);

module.exports = class MyDevice extends OAuth2Device {

  async onOAuth2Init() {
    try {
      this.restarting = false;
      await this.setAvailable();
      this.startListeners();

      this.psId = this.getData().id;
      this.psKey = this.getSettings().psKey;
      this.deviceType = this.getSettings().deviceType;
      this.pointIdList = sungrowPointMap[`${this.driver.id}Points`][this.deviceType];
      // poll once
      await this.eventListenerEveryXminutes().catch((error) => this.error(error));
      this.log(this.getName(), 'has been initialized');
    } catch (error) {
      const msg = error.message && error.message.includes('"msg":') ? JSON.parse(error.message).msg : error;
      this.error(error);
      this.setUnavailable(msg).catch(this.error);
      this.restarting = false;
      this.restartDevice(60 * 1000).catch((error) => this.error(error));
    }
  }

  async onOAuth2Deleted() {
    this.destroyListeners();
    this.log('Device was deleted', this.getName());
  }

  async onUninit() {
    this.log('unInit', this.getName());
    this.destroyListeners();
    await setTimeoutPromise(2000).catch((error) => this.error(error)); // wait 2 secs
  }

  async onAdded() {
    this.log('added', this.getName());
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed', this.getName(), newSettings);
    this.restartDevice(1000).catch((error) => this.error(error));
  }

  async onRenamed(name) {
    this.log('Device was renamed', name);
  }

  async restartDevice(delay) {
    this.destroyListeners();
    if (this.restarting) return;
    this.restarting = true;
    const dly = delay || 1000 * 5;
    this.log(`Device will restart in ${dly / 1000} seconds`);
    await setTimeoutPromise(dly);
    this.onOAuth2Init().catch((error) => this.error(error));
  }

  async setCapability(capability, value) {
    if (this.hasCapability(capability) && value !== undefined) {
      await this.setCapabilityValue(capability, value).catch((error) => {
        this.log(error, capability, value);
      });
    }
  }

  setSetting(setting, value) {
    const settings = this.getSettings();
    if (value !== undefined && settings && settings[setting] !== value) {
      const newSettings = {};
      newSettings[setting] = value;
      this.log('New setting:', newSettings);
      this.setSettings(newSettings).catch((error) => {
        this.log(error, setting, value);
      });
    }
  }

  async handleData(data) {
    await this.setAvailable();
    this.lastPoll = Date.now();
    // map the data to homey capabilities
    const capFuncs = sungrowPointMap[`${this.driver.id}Map`][this.deviceType];
    for (const [cap, func] of Object.entries(capFuncs)) this.setCapability(cap, func(data)).catch((error) => this.error(error));
    // set settings that have changed
    // const newSettings = {
    //   plantName: data.ps_name,
    // };
    // for (const [key, value] of Object.entries(newSettings)) this.setSetting(key, value);
  }

  // start listeners
  startListeners() {
    this.destroyListeners();
    this.log('starting listeners', this.getName());
    this.eventListenerEveryXminutes = async () => {
      try {
        // poll plant data
        if (this.deviceType === 'plant') {
          const plantInfo = await this.driver.pollPlants({
            client: this.oAuth2Client, psIdList: [this.psId], pointIdList: this.pointIdList,
          });
          if (plantInfo && plantInfo.length > 0) {
            this.handleData(plantInfo[0]).catch((error) => this.error(error));
          }
        }
        // poll device data
        if (this.deviceType !== 'plant') {
          const devicesInfo = await this.driver.pollDeviceType({
            client: this.oAuth2Client, psKeyList: [this.psKey], pointIdList: this.pointIdList, deviceType: this.deviceType,
          });
          const deviceInfo = devicesInfo.find((info) => info.device_point.ps_key === this.psKey);
          if (deviceInfo) {
            this.handleData(deviceInfo.device_point).catch((error) => this.error(error));
          }
        }
        // check if data is very old
        if ((Date.now() - this.lastPoll) > 61 * 60 * 1000) this.setUnavailable('No updates from device').catch((error) => this.error(error));
      } catch (error) {
        this.error(error);
        // check if data is very old
        if ((Date.now() - this.lastPoll) > 61 * 60 * 1000) this.setUnavailable('No updates from device').catch((error) => this.error(error));
      }
    };
    this.homey.on('everyXminutes', this.eventListenerEveryXminutes);
  }

  // remove listeners
  destroyListeners() {
    this.log('removing listeners', this.getName());
    if (this.eventListenerEveryXminutes) this.homey.removeListener('everyXminutes', this.eventListenerEveryXminutes);
  }

};
