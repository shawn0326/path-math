import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  outDir: 'dist',
  outExtensions: () => ({
    js: '.js',
    dts: '.d.ts'
  }),
  target: 'es2022',
  clean: true,
  sourcemap: false,
  dts: {
    sourcemap: false
  }
});
