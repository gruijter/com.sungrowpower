/* eslint-disable camelcase */

'use strict';

const Homey = require('homey');
const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
const SungrowOAuth2Token = require('./SungrowOAuth2Token');

const getEnv = (key) => {
  return (Homey.env && key in Homey.env) ? Homey.env[key] : undefined;
};

module.exports = class MyBrandOAuth2Client extends OAuth2Client {

  static CLIENT_ID = getEnv('CLIENT_ID') || getEnv('CLIENT_ID_EU');
  static CLIENT_SECRET = getEnv('CLIENT_SECRET') || getEnv('CLIENT_SECRET_EU');
  static API_URL = null;
  static TOKEN_URL = null;
  static AUTHORIZATION_URL = null;
  static REDIRECT_URL = 'https://gruijter.github.io/sungrow-oauth-redirect/';
  // static SCOPES = [] // Optional:
  static TOKEN = SungrowOAuth2Token;

  constructor(...args) {
    super(...args);
    this._deviceBatchQueue = [];
    this._deviceBatchTimer = null;
    this._plantBatchQueue = [];
    this._plantBatchTimer = null;
  }

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

  // Override onRequestResponse to implement an automatic retry mechanism when encountering 429 Rate Limit
  async onRequestResponse({ req, url, opts, response, didRefreshToken }) {
    if (response.status === 429) {
      req.retryCount = (req.retryCount || 0) + 1;
      if (req.retryCount <= 3) {
        this.log(`Request is rate limited (429). Retry attempt ${req.retryCount}/3 in 15 seconds...`);
        await new Promise((resolve) => this.homey.setTimeout(resolve, 15000));
        return this._executeRequest(req, didRefreshToken);
      }
      this.error('Request was rate limited 3 times, giving up.');
    }
    return super.onRequestResponse({ req, url, opts, response, didRefreshToken });
  }

  async onHandleGetTokenByCodeResponse({ response }) {
    const json = await response.json();
    this.log('onHandleGetTokenByCodeResponse raw json:', JSON.stringify(json));
    const hasAccessToken = json.access_token || json.result_data?.access_token;
    if (!hasAccessToken && json.result_code !== '1' && json.result_code !== 1) {
      throw new Error(json.result_msg || 'Failed to exchange token');
    }
    return new this._tokenConstructor({
      access_token: json.result_data?.access_token || json.access_token,
      expires_in: json.result_data?.expires_in || json.expires_in,
      refresh_token: json.result_data?.refresh_token || json.refresh_token || null,
      auth_ps_list: json.result_data?.auth_ps_list || json.auth_ps_list || null,
    });
  }

  async onHandleRefreshTokenResponse({ response }) {
    const json = await response.json();
    this.log('onHandleRefreshTokenResponse raw json:', JSON.stringify(json));
    const hasAccessToken = json.access_token || json.result_data?.access_token;
    if (!hasAccessToken && json.result_code !== '1' && json.result_code !== 1) {
      throw new Error(json.result_msg || 'Failed to refresh token');
    }
    return new this._tokenConstructor({
      access_token: json.result_data?.access_token || json.access_token,
      expires_in: json.result_data?.expires_in || json.expires_in,
      refresh_token: json.result_data?.refresh_token || json.refresh_token || null,
      auth_ps_list: json.result_data?.auth_ps_list || json.auth_ps_list || null,
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
    this.log('onGetTokenByCode tokenUrl:', this.tokenUrl, 'options:', JSON.stringify(options));
    const response = await fetch(this.tokenUrl, options);
    this.log('onGetTokenByCode response status:', response.status, 'statusText:', response.statusText);
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
    this.log('onRefreshToken refreshUrl:', this.refreshUrl, 'options:', JSON.stringify(options));
    const response = await fetch(this.refreshUrl, options);
    this.log('onRefreshToken response status:', response.status, 'statusText:', response.statusText);
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

  getPlantRealTimeData({ psIdList, pointIdList }) {
    return new Promise((resolve, reject) => {
      this._plantBatchQueue.push({
        psIdList,
        pointIdList,
        resolve,
        reject,
      });

      if (!this._plantBatchTimer) {
        this._plantBatchTimer = setTimeout(() => {
          this._plantBatchTimer = null;
          this._processPlantBatch().catch((err) => this.error('processPlantBatch error', err));
        }, 50);
      }
    });
  }

  async _processPlantBatch() {
    const queue = this._plantBatchQueue;
    this._plantBatchQueue = [];

    const allIds = [];
    const allPoints = [];

    for (const item of queue) {
      if (item.psIdList) allIds.push(...item.psIdList);
      if (item.pointIdList) allPoints.push(...item.pointIdList);
    }

    const uniqueIds = [...new Set(allIds)];
    const uniquePoints = [...new Set(allPoints)];

    try {
      const response = await this.post({
        path: '/openapi/platform/getPowerStationRealTimeData',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': this._clientSecret,
        },
        body: JSON.stringify({
          appkey: this._clientId,
          lang: '_en_US',
          ps_id_list: uniqueIds,
          point_id_list: uniquePoints,
        }),
      });

      for (const item of queue) {
        item.resolve(response);
      }
    } catch (err) {
      for (const item of queue) {
        item.reject(err);
      }
    }
  }

  getDeviceRealTimeData({
    psKeyList, snList, deviceType, pointIdList,
  }) {
    return new Promise((resolve, reject) => {
      this._deviceBatchQueue.push({
        psKeyList,
        snList,
        deviceType,
        pointIdList,
        resolve,
        reject,
      });

      if (!this._deviceBatchTimer) {
        this._deviceBatchTimer = setTimeout(() => {
          this._deviceBatchTimer = null;
          this._processDeviceBatch().catch((err) => this.error('processDeviceBatch error', err));
        }, 50);
      }
    });
  }

  async _processDeviceBatch() {
    const queue = this._deviceBatchQueue;
    this._deviceBatchQueue = [];

    // Group items by deviceType
    const groups = {};
    for (const item of queue) {
      const typeKey = String(item.deviceType);
      if (!groups[typeKey]) {
        groups[typeKey] = [];
      }
      groups[typeKey].push(item);
    }

    // Process each group
    for (const [deviceTypeStr, items] of Object.entries(groups)) {
      const deviceType = Number(deviceTypeStr);
      const allKeys = [];
      const allPoints = [];

      for (const item of items) {
        if (item.psKeyList) allKeys.push(...item.psKeyList);
        if (item.pointIdList) allPoints.push(...item.pointIdList);
      }

      const uniqueKeys = [...new Set(allKeys)];
      const uniquePoints = [...new Set(allPoints)];

      try {
        const response = await this.post({
          path: '/openapi/platform/getDeviceRealTimeData',
          headers: {
            'Content-Type': 'application/json',
            'x-access-key': this._clientSecret,
          },
          body: JSON.stringify({
            appkey: this._clientId,
            lang: '_en_US',
            ps_key_list: uniqueKeys,
            point_id_list: uniquePoints,
            device_type: deviceType,
          }),
        });

        // Resolve all requests in this group with the combined response
        for (const item of items) {
          item.resolve(response);
        }
      } catch (err) {
        for (const item of items) {
          item.reject(err);
        }
      }
    }
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
