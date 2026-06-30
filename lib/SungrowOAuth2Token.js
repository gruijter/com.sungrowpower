/* eslint-disable camelcase */

'use strict';

const { OAuth2Token } = require('homey-oauth2app');

class SungrowOAuth2Token extends OAuth2Token {

  constructor({
    access_token, refresh_token, token_type, expires_in, auth_ps_list,
  }) {
    super({
      access_token, refresh_token, token_type, expires_in,
    });
    this.auth_ps_list = auth_ps_list || null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      auth_ps_list: this.auth_ps_list,
    };
  }

}

module.exports = SungrowOAuth2Token;
