import { defineConfig } from 'vite';
import { wsRelayPlugin } from './src/server/wsRelayPlugin';

export default defineConfig({
  base: '/car_driving/',
  plugins: [wsRelayPlugin()],
  server: { host: true },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
