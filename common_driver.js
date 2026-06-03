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

const { OAuth2Driver } = require('homey-oauth2app');

const sungrowPointMap = require('./lib/sungrowPointMap');

module.exports = class MyBrandDriver extends OAuth2Driver {

  async onOAuth2Init() {
    this.log('Inverter driver has been initialized with OAuth2');
  }

  /**
   * Custom pair flow with a region picker.
   *
   * The stock OAuth2Driver.onPair() captures the configId and builds the pair client up-front,
   * so it can't switch regions mid-flow. We reimplement the (single-session) OAuth2 code flow
   * here and add a `set_region` handler that rebuilds the pair client against the chosen config
   * before the login_oauth2 view requests an authorization URL.
   * @param {PairSession} socket
   */
  onPair(socket) {
    let configId = this.getOAuth2ConfigId(); // 'default' (EU) until the user picks a region
    let sessionId = null;
    let client;

    const newPairClient = () => {
      if (client) {
        try {
          client.destroy();
        } catch (err) {
          this.error(err);
        }
      }
      client = this.homey.app.createOAuth2Client({
        sessionId: `pair-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        configId,
      });
    };
    newPairClient();

    const onSetRegion = async (regionId) => {
      if (!this.homey.app.hasConfig({ configId: regionId })) {
        throw new Error(`Unknown region: ${regionId}`);
      }
      configId = regionId;
      this.log(`Pairing region selected: ${configId}`);
      newPairClient();
      return true;
    };

    const onShowViewLoginOAuth2 = async () => {
      try {
        const authorizationUrl = client.getAuthorizationUrl();
        const oAuth2Callback = await this.homey.cloud.createOAuth2Callback(authorizationUrl);
        oAuth2Callback
          .on('url', (url) => socket.emit('url', url).catch(this.error))
          .on('code', (code) => {
            client.getTokenByCode({ code })
              .then(async () => {
                const session = await client.onGetOAuth2SessionInformation();
                const token = client.getToken();
                const { title } = session;
                sessionId = session.id;

                // Swap the temporary pair client for the final, persistable one
                client.destroy();
                client = this.homey.app.createOAuth2Client({ sessionId, configId });
                client.setTitle({ title });
                client.setToken({ token });

                socket.emit('authorized').catch(this.error);
              })
              .catch((err) => socket.emit('error', err.message || err.toString()).catch(this.error));
          });
      } catch (err) {
        socket.emit('error', err.message || err.toString()).catch(this.error);
      }
    };

    const onShowView = async (viewId) => {
      if (viewId === 'login_oauth2') await onShowViewLoginOAuth2();
    };

    const onListDevices = async () => {
      const devices = await this.onPairListDevices({ oAuth2Client: client });
      return devices.map((device) => ({
        ...device,
        store: {
          ...device.store,
          OAuth2SessionId: sessionId,
          OAuth2ConfigId: configId,
        },
      }));
    };

    const onAddDevice = async () => {
      this.log(`At least one device has been added, saving the '${configId}' client...`);
      client.save();
    };

    socket
      .setHandler('set_region', onSetRegion)
      .setHandler('showView', onShowView)
      .setHandler('list_devices', onListDevices)
      .setHandler('add_device', onAddDevice)
      .setHandler('disconnect', async () => this.log('Pair session disconnected'));
  }

  async onPairListDevices({ oAuth2Client }) {
    const devices = [];
    const result = await oAuth2Client.getPlantList().catch(this.error);
    if (!result || !result.result_data || !result.result_data.pageList) return devices;
    const validTypes = Object.keys(sungrowPointMap[`${this.id}Points`]);
    const sites = result.result_data.pageList;
    const plantPointIdList = sungrowPointMap[`${this.id}Points`]['plant'];
    for (const site of sites) {
      // get plant data
      if (plantPointIdList) {
        const data = await oAuth2Client.getPlantRealTimeData({ psIdList: [site.ps_id], pointIdList: plantPointIdList }).catch(this.error);
        const plantInfo = data?.result_data?.device_point_list?.[0];
        // console.dir(plantInfo, { depth: null });
        // add plant as Homey device when it is a valid type and contains desired data
        const hasDesiredData = plantInfo && plantPointIdList.every((pointId) => plantInfo[`p${pointId}`] !== null);
        if (hasDesiredData && validTypes.includes('plant')) {
          const capabilities = Object.keys(sungrowPointMap[`${this.id}Map`]['plant']);
          const device = {
            name: site.ps_name,
            data: {
              id: site.ps_id,
            },
            capabilities,
            settings: {
              plantId: site.ps_id.toString(),
              plantName: site.ps_name,
              deviceName: '', // dev.device_name,
              psKey: plantInfo.ps_key,
              deviceSn: '', // dev.device_sn || '',
              deviceType: 'plant', // dev.device_type,
              deviceModelCode: '', // dev.device_model_code || '',
            },
          };
          devices.push(device);
        }
      }
      // get device data
      const deviceList = await oAuth2Client.getDeviceList({ psId: site.ps_id }).catch(this.error);
      // console.dir(deviceList, { depth: null });
      const list = deviceList?.result_data?.pageList;
      if (!list || !Array.isArray(list)) continue;
      // add devices as Homey device when it is a valid type
      for (const dev of list) {
        if (validTypes.includes(dev.device_type.toString())) {
          const capabilities = Object.keys(sungrowPointMap[`${this.id}Map`][dev.device_type]);
          const device = {
            name: `${site.ps_name} ${dev.device_name}`,
            data: {
              id: dev.ps_key,
            },
            capabilities,
            settings: {
              plantId: site.ps_id.toString(),
              plantName: site.ps_name,
              deviceName: dev.device_name,
              psKey: dev.ps_key,
              deviceSn: dev.device_sn || '',
              deviceType: dev.device_type,
              deviceModelCode: dev.device_model_code || '',
            },
          };
          devices.push(device);
        }
      }
    }
    this.log(devices);
    return Promise.all(devices);
  }

  // poll one or multiple plants from one client
  async pollPlants({ client, psIdList, pointIdList }) {
    try {
      // console.log('pollPlants called', psIdList, pointIdList);
      const data = await client.getPlantRealTimeData({ psIdList, pointIdList });
      const plantInfo = data?.result_data?.device_point_list || [];
      return Promise.resolve(plantInfo);
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  // poll one or multiple devices from one client
  async pollDeviceType({
    client,
    psKeyList,
    pointIdList,
    deviceType,
  }) {
    try {
      if (deviceType === 'plant') throw new Error('Device type "plant" should not be used in pollDeviceType, use pollPlants instead');
      // console.log('pollDevices called', deviceType, psKeyList, pointIdList);
      // deviceData
      const data = await client.getDeviceRealTimeData({ deviceType, psKeyList, pointIdList });
      const deviceInfo = data?.result_data?.device_point_list || [];
      return Promise.resolve(deviceInfo);
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

};
