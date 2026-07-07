import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this repo at https://<user>.github.io/Knowbase/,
  // so all asset URLs must be prefixed with the repo name.
  base: '/Knowbase/',
})
