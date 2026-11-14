// Full compiled Nest graph against a dedicated local QA database. No dotenv or providers.
await import('./cashback-release-candidate-environment.mjs');
await import('reflect-metadata');
const { NestFactory } = await import('@nestjs/core');
const { ValidationPipe } = await import('@nestjs/common');
const { AppModule } = await import('../dist/app.module.js');
const { apiVersioningMiddleware } = await import('../dist/shared/http/api-versioning.js');
const { initMetrics, initDomainMetrics } = await import('../dist/shared/http/metrics.middleware.js');
initMetrics();
initDomainMetrics();
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], abortOnError: false });
app.use(apiVersioningMiddleware);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.enableCors({ origin: ['http://127.0.0.1:5193', 'http://127.0.0.1:5194', 'http://127.0.0.1:13150', 'http://127.0.0.1:13151'], credentials: true });
await app.listen(13150, '127.0.0.1');
console.log(JSON.stringify({ event: 'cashback_qa_compiled_ready', url: 'http://127.0.0.1:13150', database: 'cashback_seed_qa_candidate', graph: 'AppModule', realProviderCalls: 0 }));
process.once('SIGINT', async () => { await app.close(); process.exit(0); });
process.once('SIGTERM', async () => { await app.close(); process.exit(0); });
