import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative base: works at the domain root and on GitHub Pages (/musette/).
  base: './',
  plugins: [svelte()],
  build: { target: 'es2022' },
});
