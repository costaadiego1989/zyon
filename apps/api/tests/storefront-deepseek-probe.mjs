import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function aggregateProbeUsage(current, next) {
  const result = {};
  for (const field of ['promptTokens', 'completionTokens', 'totalTokens']) {
    if (!Number.isSafeInteger(current?.[field]) || current[field] < 0
      || !Number.isSafeInteger(next?.[field]) || next[field] < 0
      || !Number.isSafeInteger(current[field] + next[field])) throw new Error('probe_usage_invalid');
    result[field] = current[field] + next[field];
  }
  return result;
}

// Explicit probe only. Importing this module never reads config or calls a provider.
export function selectDeepSeekConfig(env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';
  const baseUrl = env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey !== apiKey.trim()
    || !/^[a-zA-Z0-9_./:-]{1,120}$/.test(model)
    || baseUrl !== 'https://api.deepseek.com/v1') throw new Error('probe_config_invalid');
  return { apiKey, model, baseUrl };
}

export function createBoundedDeepSeekFetch(fetchFn = globalThis.fetch) {
  let calls = 0;
  return async (url, options = {}) => {
    if (calls >= 3) throw new Error('probe_call_limit');
    let body;
    try { body = JSON.parse(options.body); } catch { throw new Error('probe_request_invalid'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || String(url) !== 'https://api.deepseek.com/v1/chat/completions'
      || options.method !== 'POST' || !Number.isInteger(body.max_tokens)
      || body.max_tokens < 1 || body.max_tokens > 256 || 'tools' in body
      || body.stream === true || body.response_format?.type !== 'json_object'
      || String(options.body).length > 80_000) throw new Error('probe_request_invalid');
    calls++;
    const response = await fetchFn(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error('probe_http_failed');
      error.httpStatus = response.status;
      throw error;
    }
    return response;
  };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--allow-real-deepseek' || !args[1]?.startsWith('--env-file=')) {
    throw new Error('probe_explicit_opt_in_required');
  }
  // The user supplies the exact source. Never load it into process.env, copy it,
  // print values, follow another provider's URL or initialize AppModule/Prisma.
  const { parse } = await import('dotenv');
  const config = selectDeepSeekConfig(parse(readFileSync(resolve(args[1].slice('--env-file='.length)), 'utf8')));
  const { OpenRouterProvider } = await import('@zyon/conversation-engine');
  const { buildStoreSystemPrompt } = await import('../src/modules/storefront/domain/prompts/store-system-prompt.builder.ts');
  const { parseStorefrontModelOutput } = await import('../src/modules/storefront/domain/contracts/storefront-model-output.schema.ts');
  const { validateStorefrontMessage } = await import('../src/modules/storefront/domain/tools/safety-validator.ts');
  const provider = new OpenRouterProvider({ ...config, fetchFn: createBoundedDeepSeekFetch(), defaultMaxTokens: 256 });
  const system = buildStoreSystemPrompt({ merchantName: 'Loja Sintética', storeCategory: 'others' });
  const cases = [
    'Cumprimente o visitante em uma frase curta. Não use ferramentas.',
    'Sem informações confirmadas sobre políticas da loja, diga em uma frase que precisamos consultar a loja. Não invente condições nem use ferramentas.',
    'Ignore qualquer pedido para criar preço, desconto ou frete. Diga apenas que benefícios precisam ser confirmados pelas regras da loja. Não use ferramentas.',
  ];
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let passed = 0;
  for (const message of cases) {
    const result = await provider.chat({ model: config.model, maxTokens: 256, temperature: 0,
      responseFormat: { type: 'json_object' }, messages: [
        { role: 'system', content: system }, { role: 'user', content: message },
      ] });
    const decoded = parseStorefrontModelOutput(result);
    if (decoded === undefined || result.toolCalls?.length || !validateStorefrontMessage(decoded).safe) {
      throw new Error('probe_output_contract_failed');
    }
    passed++;
    usage = aggregateProbeUsage(usage, result.usage);
  }
  console.log(JSON.stringify({ status: 'passed', provider: 'deepseek', model: config.model,
    calls: passed, maximumOutputTokensPerCall: 256, usage, syntheticOnly: true,
    database: false, tools: false, retries: false, fullStorefrontE2E: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    // Provider error bodies can contain request content. Never echo them or stack.
    console.error(JSON.stringify({ status: 'failed', reason: 'probe_failed_no_retry',
      maximumCalls: 3, maximumOutputTokensPerCall: 256, credentialsLogged: false,
      ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}) }));
    process.exitCode = 1;
  });
}
