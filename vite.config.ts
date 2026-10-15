/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Publicado em https://drthaleschateaubriand.github.io/chat-livre-ia/ => base com subcaminho.
export default defineConfig({
  base: '/chat-livre-ia/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
