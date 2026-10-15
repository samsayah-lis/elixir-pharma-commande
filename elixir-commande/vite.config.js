import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import bancEssai from './scripts/banc/plugin.mjs'

export default defineConfig({
  // bancEssai : données figées pour /.netlify/functions/* en développement seulement (apply: "serve")
  plugins: [react(), bancEssai()],
})
