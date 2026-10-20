import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base: works at the domain root and on GitHub Pages (/musette/).
  base: './',
  plugins: [react()],
  build: { target: 'es2022' },
});
