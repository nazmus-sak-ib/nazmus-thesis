import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import modelLibraryPlugin from './modelLibraryPlugin.js'

export default defineConfig({
  // Local development stays at /. Pages builds set their repository subpath.
  base: process.env.PAGES_BASE_PATH || '/',
  plugins: [react(), modelLibraryPlugin()],
})
