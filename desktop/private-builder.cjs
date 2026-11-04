'use strict';
const config = require('../electron-builder.cjs');
const path = require('node:path');
if (!process.env.AFTERHOURS_CONTENT_PACK)
  throw new Error('Use npm run desktop:dist:private to select private content.');
module.exports = {
  ...config,
  mac: {...config.mac, icon: path.join(process.env.AFTERHOURS_CONTENT_PACK, 'desktop/icon.png')},
  directories: {...config.directories, output: '.context/desktop-dist/private'},
  extraResources: config.extraResources.map(resource =>
    resource.to === 'backend' ? {...resource, from: '.context/desktop-backend/private/afterhours-server'} : resource,
  ),
};
