import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 支持导入 JSON 文件（量表数据）
  assetsInclude: ['**/*.json'],
  // 强制预购所有 React 相关依赖，防止多个 React 副本
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'react-dom/server',
      'antd',
      'react-router-dom',
      'echarts',
      'echarts-for-react',
    ],
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    // 代理 API 请求到后端（FastAPI 运行在 8000 端口）
    proxy: {
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/uploads/, '/knowledge'),
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
