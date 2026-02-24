import type { SnapConfig } from '@metamask/snaps-cli';

const config: SnapConfig = {
  bundler: 'webpack',
  input: 'src/index.ts',
  server: {
    port: 8080,
  },
  polyfills: {
    buffer: true,
  },
};

export default config;
