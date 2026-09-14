import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const repo = path.join(projectRoot, 'apps/dashboard');
const require = createRequire(repo + '/package.json');
const { createServer } = await import(pathToFileURL(require.resolve('vite')));
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')))).default;
const server = await createServer({
  configFile: false, root: repo, cacheDir: path.join(here, '.artifacts/vite-cache'),
  plugins: [react(), { name: 'local-recovery-qa', configureServer(server) {
    server.middlewares.use('/__qa', async (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/__qa', '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/' + here.replaceAll('\\', '/') + '/qa-view.tsx"></script></body></html>'));
    });
  }}],
  resolve: { alias: { react: repo + '/node_modules/react', 'react-dom': repo + '/node_modules/react-dom', 'lucide-react': repo + '/node_modules/lucide-react' } },
  server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [repo, path.join(projectRoot, 'packages'), here] } },
});
await server.listen();
console.log('Recovery QA ready at http://127.0.0.1:5198/__qa');
