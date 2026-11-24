import {fileURLToPath} from 'node:url';
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  esbuild: {jsx: 'automatic'},
  test: {environment: 'node', include: ['src/lib/storefront-cross-sell-operation-owner.spec.tsx']},
};
