import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import bancEssai from './scripts/banc/plugin.mjs'
import apiDoc from './scripts/api-doc-plugin.mjs'
import cacheAssets from './scripts/cache-assets-plugin.mjs'

export default defineConfig({
  // bancEssai : données figées pour /.netlify/functions/* en développement seulement (apply: "serve")
  // apiDoc : documentation publique de l'API des pharmacies (/api/openapi.yaml et la police de public/api/index.html)
  // cacheAssets : dist/_headers, fichiers à empreinte de /assets gardés un an par le navigateur (build seulement, docs/cache.md)
  plugins: [react(), bancEssai(), apiDoc(), cacheAssets()],
})
