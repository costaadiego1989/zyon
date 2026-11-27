import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('./',import.meta.url)),envDir:false,cacheDir:fileURLToPath(new URL('../../.audit/ads-workspace-native/cache',import.meta.url)),plugins:[react()],optimizeDeps:{include:['react','react-dom/client','lucide-react']},server:{host:'127.0.0.1',port:5207,strictPort:true}});
