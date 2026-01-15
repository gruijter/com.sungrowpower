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

  async onPairListDevices({ oAuth2Client }) {
    const devices = [];
    const result = await oAuth2Client.getPlantList().catch(this.error);
    // console.dir(result, { depth: null });
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
