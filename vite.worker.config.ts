import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: 'dist',
    target: 'es2022',
    lib: {
      entry: path.resolve(__dirname, 'worker/index.ts'),
      formats: ['es'],
      fileName: () => '_worker.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: '_worker.js',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
