import { defineConfig } from 'vite'

export default defineConfig({
  // 默认只绑回环；远程调试经 server 单域托管或 Tunnel，不直接暴露 dev server
  server: { host: '127.0.0.1', port: 5174 },
  preview: { host: '127.0.0.1', port: 4174 },
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },
})
