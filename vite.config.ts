import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: {
      overlay: false,   // 出错不盖全屏遮罩（避免某些情况下触发整页 reload）
    },
    watch: {
      // chokidar 语法，忽略这些路径的变动
      ignored: [
        '**/public/units/**',
        '**/public/data/**',
      ],
    },
  },
})
