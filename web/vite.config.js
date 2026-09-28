import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import modelLibraryPlugin from './modelLibraryPlugin.js'

export default defineConfig({
  plugins: [react(), modelLibraryPlugin()],
})
