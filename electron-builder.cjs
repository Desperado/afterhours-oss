'use strict';
module.exports = {
  appId: 'com.afterhours.studio',
  productName: 'AFTERHOURS',
  asar: true,
  directories: {
    output: '.context/desktop-dist/public',
  },
  files: ['desktop/*.cjs', 'package.json'],
  extraResources: [
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY.md',
    {
      from: 'docs/open-source-readiness.md',
      to: 'open-source-readiness.md',
    },
    {
      from: '.context/desktop-backend/public/afterhours-server',
      to: 'backend',
      filter: ['**/*'],
    },
  ],
  mac: {
    category: 'public.app-category.music',
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
    ],
    identity: '-',
    hardenedRuntime: false,
  },
  artifactName: '${productName}-${version}-${arch}.${ext}',
  dmg: {
    title: 'AFTERHOURS',
  },
};
