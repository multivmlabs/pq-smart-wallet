import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '..'), // Load .env from demo/ parent
  server: {
    port: 3001,
    proxy: {
      '/rpc': {
        target: 'http://127.0.0.1:8547',
        rewrite: (path) => path.replace(/^\/rpc/, ''),
        changeOrigin: true,
      },
      '/bundler': {
        target: 'http://127.0.0.1:4337',
        rewrite: (path) => path.replace(/^\/bundler/, ''),
        changeOrigin: true,
      },
    },
  },
})
