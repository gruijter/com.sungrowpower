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

const Homey = require('homey');
const { OAuth2App } = require('homey-oauth2app');
const SungrowOAuth2Client = require('./lib/SungrowOAuth2Client');

const REDIRECT_URL = 'https://callback.athom.com/oauth2/callback/';

// iSolarCloud runs parallel regional stacks, each with its own API gateway + web authorization
// host and a numeric cloudId that the authorization page uses to route to the correct cloud.
// Gateways come from the iSolarCloud OpenAPI server list; auth hosts + cloudIds are confirmed
// against the working Home Assistant iSolarCloud integration (China=1, International=2, EU=3,
// Australia=7).
//
// applicationId identifies the *registered developer app* on that region's portal and is unique
// per registration. EU uses 1162 (Robin's app, from the v1.0.2 release). For other regions it
// must be supplied via env.json (e.g. APPLICATION_ID_AU), together with that region's appkey
// (CLIENT_ID_AU / CLIENT_SECRET_AU) if it differs from the default.
//
// The auto-registered `default` config mirrors EU so devices paired with v1.0.2 keep working.
const REGIONS = [
  {
    configId: 'eu', name: 'Europe', apiUrl: 'https://gateway.isolarcloud.eu', authHost: 'web3.isolarcloud.eu', cloudId: '3', applicationId: '1162',
  },
  {
    configId: 'au', name: 'Australia', apiUrl: 'https://augateway.isolarcloud.com', authHost: 'auweb3.isolarcloud.com', cloudId: '7',
  },
  {
    configId: 'intl', name: 'International', apiUrl: 'https://gateway.isolarcloud.com.hk', authHost: 'web3.isolarcloud.com.hk', cloudId: '2',
  },
];

module.exports = class SungrowApp extends OAuth2App {

  static OAUTH2_CLIENT = SungrowOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = true; // Default: false
  static OAUTH2_MULTI_SESSION = false; // Default: false
  // static OAUTH2_DRIVERS = ['inverter', 'battery']; // Default: all drivers

  async onOAuth2Init() {
    this.registerRegionConfigs();
    this.everyXminutes(5); // start time trigger emitter
    this.log('Sungrow app has been initialized with OAuth2');
  }

  // Register one OAuth2 config per iSolarCloud region. The driver's pick_region pair step
  // selects which configId a new pairing uses, swapping gateway + authorization host together.
  //
  // IMPORTANT (homey-oauth2app@3.7.2 quirk): setOAuth2Config()'s duplicate-check passes a bare
  // string to hasConfig(), which JS resolves to the 'default' key. The practical effect is that
  // once a 'default' config exists, every further setOAuth2Config() throws "Duplicate Config ID".
  // So: the client leaves API_URL/TOKEN_URL null (suppressing the library's automatic 'default'
  // registration at init), we register every regional config FIRST, and register 'default' LAST.
  // 'default' mirrors EU so devices paired on v1.0.2 (which stored OAuth2ConfigId 'default') keep
  // working.
  registerRegionConfigs() {
    const buildConfig = (region) => {
      const suffix = region.configId.toUpperCase();
      const cloudId = Homey.env[`CLOUD_ID_${suffix}`] || region.cloudId;
      const applicationId = Homey.env[`APPLICATION_ID_${suffix}`] || region.applicationId || Homey.env.APPLICATION_ID || Homey.env.APPLICATION_ID_EU;
      return {
        clientId: Homey.env[`CLIENT_ID_${suffix}`] || Homey.env.CLIENT_ID || Homey.env.CLIENT_ID_EU,
        clientSecret: Homey.env[`CLIENT_SECRET_${suffix}`] || Homey.env.CLIENT_SECRET || Homey.env.CLIENT_SECRET_EU,
        apiUrl: region.apiUrl,
        tokenUrl: `${region.apiUrl}/openapi/apiManage/token`,
        authorizationUrl: `https://${region.authHost}/#/authorized-app?cloudId=${cloudId}&applicationId=${applicationId}&redirectUrl=${REDIRECT_URL}`,
        redirectUrl: REDIRECT_URL,
      };
    };

    const register = (configId, region) => {
      if (this.hasConfig({ configId })) return; // idempotent if init runs twice
      this.setOAuth2Config({ configId, ...buildConfig(region) });
      this.log(`Registered OAuth2 config '${configId}' (${region.apiUrl})`);
    };

    // Regional configs first...
    for (const region of REGIONS) register(region.configId, region);

    // ...then 'default' (EU) LAST, for backward compatibility with v1.0.2 devices.
    const eu = REGIONS.find((r) => r.configId === 'eu');
    register('default', eu);
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
