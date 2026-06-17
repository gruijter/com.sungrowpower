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
const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');

const getEnv = (key) => {
  return (Homey.env && key in Homey.env) ? Homey.env[key] : undefined;
};

module.exports = class MyBrandOAuth2Client extends OAuth2Client {

  static CLIENT_ID = getEnv('CLIENT_ID') || getEnv('CLIENT_ID_EU');
  static CLIENT_SECRET = getEnv('CLIENT_SECRET') || getEnv('CLIENT_SECRET_EU');
  // static APPLICATION_ID = Homey.env.APPLICATION_ID; // '1162'
  // static CLOUD_ID = Homey.env.CLOUD_ID; // '3'
  // API_URL / TOKEN_URL / AUTHORIZATION_URL are intentionally left null so that
  // OAuth2App does NOT auto-register a 'default' config at init. All configs
  // (per-region + a 'default' for backward compatibility) are registered
  // explicitly in app.js -> registerRegionConfigs(). See the note there: the
  // library's duplicate-check is keyed on 'default', so 'default' must be the
  // LAST config registered. Per-region token/refresh URLs are derived from the
  // active config's apiUrl via the getters below.
  static API_URL = null;
  static TOKEN_URL = null;
  static AUTHORIZATION_URL = null;
  static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback/';
  // static SCOPES = [] // Optional:
  // static TOKEN = OAuth2Token; // SungrowAuth2Token; // Default: OAuth2Token

  // Overload what needs to be overloaded here
  async onHandleNotOK({ body }) {
    this.error('OAuth2Client.onHandleNotOK', body);
    throw new OAuth2Error(body.error);
  }

  // Per-region token endpoint, derived from the active config's apiUrl
  get tokenUrl() {
    return `${this._apiUrl}/openapi/apiManage/token`;
  }

  // Per-region refresh endpoint, derived from the active config's apiUrl
  get refreshUrl() {
    return `${this._apiUrl}/openapi/apiManage/refreshToken`;
  }

  async onHandleGetTokenByCodeResponse({ response }) {
    const json = await response.json();
    if (json.result_code !== '1' && json.result_code !== 1) {
      throw new Error(json.result_msg || 'Failed to exchange token');
    }
    return new this._tokenConstructor({
      access_token: json.result_data.token,
      expires_in: json.result_data.expire_time,
      refresh_token: json.result_data.refresh_token || null,
    });
  }

  async onHandleRefreshTokenResponse({ response }) {
    const json = await response.json();
    if (json.result_code !== '1' && json.result_code !== 1) {
      throw new Error(json.result_msg || 'Failed to refresh token');
    }
    return new this._tokenConstructor({
      access_token: json.result_data.token,
      expires_in: json.result_data.expire_time,
      refresh_token: json.result_data.refresh_token || null,
    });
  }

  async onGetTokenByCode({ code }) {
    this.log('got code,', code);
    // Make call to token endpoint with right body / headers
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this._redirectUrl,
      }),
    };
    const response = await fetch(this.tokenUrl, options);
    if (!response.ok) {
      this.log(response);
      return this.onHandleGetTokenByCodeError({ response });
    }
    this._token = await this.onHandleGetTokenByCodeResponse({ response });
    this.log('got token', await this.getToken());
    return this.getToken();
  }

  async onRefreshToken() {
    this.log('refreshing token...');
    // Make call to token endpoint with right body / headers
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        grant_type: 'refresh_token',
        refresh_token: this._token.refresh_token,
      }),
    };
    const response = await fetch(this.refreshUrl, options);
    if (!response.ok) {
      this.error(response);
      return this.onHandleRefreshTokenError({ response });
    }
    this._token = await this.onHandleRefreshTokenResponse({ response });
    this.log('got token', await this.getToken());
    return this.getToken();
  }

  // async onGetTokenByCode({ code }) {
  //   this.log({ code });
  //   const x = super.onGetTokenByCode({ code });
  //   console.log(await this.getToken());
  //   return x.catch(this.error.bind(this));
  // }

  // async onHandleRefreshTokenResponse({ response }) {
  //   const body = await response.text();
  //   console.log({ body });
  // }

  // // force token refresh
  // async onShouldRefreshToken({ status }) {
  //   return true;
  // }

  async getPlantList() {
    return this.post({
      path: '/openapi/platform/queryPowerStationList',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        lang: '_en_US',
        // ps_type: '1,3,4,5,6,7,8',
        ps_name: '',
        valid_flag: '1,2,3',
        page: 1,
        size: 1000,
      }),
    });
  }

  async getBasicPlantInfo({ psId }) {
    return this.post({
      path: '/openapi/platform/getPowerStationDetail',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        lang: '_en_US',
        ps_ids: `${psId}`, // Comma-separated list of power station IDs
      }),
    });
  }

  async getDeviceList({ psId }) {
    return this.post({
      path: '/openapi/platform/getDeviceListByPsId',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        lang: '_en_US',
        ps_id: `${psId}`,
        page: 1,
        size: 1000,
      }),
    });
  }

  async getPlantRealTimeData({ psIdList, pointIdList }) {
    return this.post({
      path: '/openapi/platform/getPowerStationRealTimeData',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        lang: '_en_US',
        ps_id_list: psIdList,
        point_id_list: pointIdList,
        // is_get_point_dict: '1',
      }),
    });
  }

  async getDeviceRealTimeData({
    psKeyList, snList, deviceType, pointIdList,
  }) {
    return this.post({
      path: '/openapi/platform/getDeviceRealTimeData',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        lang: '_en_US',
        ps_key_list: psKeyList,
        // sn_list: snList,
        point_id_list: pointIdList,
        device_type: deviceType, // 1-55 see https://developer-api.isolarcloud.com/#/document/md?id=12135&project_id=1&version=V2
        // is_get_point_dict: '1',
      }),
    });
  }

  async getOpenPointInfo({ deviceType = 1, snList }) {
    return this.post({
      path: '/openapi/platform/getOpenPointInfo',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this._clientSecret,
      },
      body: JSON.stringify({
        appkey: this._clientId,
        // lang: '_en_US',
        // ps_ids: `${psId}`, // Comma-separated list of power station IDs
        device_type: deviceType, // 1-55 see https://developer-api.isolarcloud.com/#/document/md?id=12135&project_id=1&version=V2
        sn_list: snList,
        page: 1,
        size: 1000,
      }),
    });
  }

};
