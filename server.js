'use strict';
const path = require('node:path');
const { loadEnvFile, readConfig } = require('./lib/config');
const { createApp } = require('./lib/app');

loadEnvFile(path.join(__dirname, '.env'));
const config = readConfig();
if (!config.sessionSecret || config.sessionSecret.length < 32) {
  console.error('SESSION_SECRET must be set to at least 32 characters (openssl rand -hex 32).');
  process.exit(1);
}
if (!config.passcode && !config.invites.length) console.warn('No PASSCODE or INVITES set: the album is open to anyone who reaches it. Only do this behind Cloudflare Access.');
createApp(config).listen(config.port, () => console.log(`Family album listening on port ${config.port} (${config.albums.length} albums, ${config.invites.length} invites)`));
