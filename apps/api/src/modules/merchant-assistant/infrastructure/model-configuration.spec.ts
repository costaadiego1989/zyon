import assert from 'node:assert/strict';
import { test } from 'node:test';
import { merchantAssistantModelConfiguration } from './runtime.js';

const providers = { OPENAI_API_KEY: 'openai-key', OPENROUTER_API_KEY: 'router-key', DEEPSEEK_API_KEY: 'deepseek-key' };

test('assistant explicit DeepSeek selection uses its own key despite other configured providers', () => {
  assert.deepEqual(merchantAssistantModelConfiguration({ ...providers, MERCHANT_ASSISTANT_PROVIDER: 'deepseek' }), {
    apiKey: 'deepseek-key', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1',
  });
});

test('assistant explicit provider and model remain scoped to the selected credential and endpoint', () => {
  for (const [provider, apiKey, baseUrl] of [
    ['deepseek', 'deepseek-key', 'https://api.deepseek.com/v1'],
    ['openai', 'openai-key', 'https://api.openai.com/v1'],
    ['openrouter', 'router-key', 'https://openrouter.ai/api/v1'],
  ]) assert.deepEqual(merchantAssistantModelConfiguration({ ...providers, MERCHANT_ASSISTANT_PROVIDER: provider, MERCHANT_ASSISTANT_MODEL: 'selected-model' }), { apiKey, model: 'selected-model', baseUrl });
});

test('assistant missing explicitly selected key does not borrow another provider credential', () => {
  assert.deepEqual(merchantAssistantModelConfiguration({ OPENAI_API_KEY: 'openai-key', MERCHANT_ASSISTANT_PROVIDER: 'deepseek' }), {
    apiKey: '', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1',
  });
});

test('assistant invalid explicit provider fails closed rather than choosing a different paid route', () => {
  assert.throws(() => merchantAssistantModelConfiguration({ ...providers, MERCHANT_ASSISTANT_PROVIDER: 'typo-provider' }), { code: 'assistant_provider_invalid' });
});

test('assistant unselected deployment preserves provider precedence and configured model', () => {
  assert.deepEqual(merchantAssistantModelConfiguration(providers), { apiKey: 'router-key', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' });
  assert.deepEqual(merchantAssistantModelConfiguration({ OPENAI_API_KEY: 'openai-key', DEEPSEEK_API_KEY: 'deepseek-key', OPENAI_MODEL: 'existing-model' }), { apiKey: 'openai-key', model: 'existing-model', baseUrl: 'https://api.openai.com/v1' });
  assert.deepEqual(merchantAssistantModelConfiguration({ DEEPSEEK_API_KEY: 'deepseek-key' }), { apiKey: 'deepseek-key', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' });
});

test('assistant explicit provider retains its configured endpoint and provider model', () => {
  assert.deepEqual(merchantAssistantModelConfiguration({ ...providers, MERCHANT_ASSISTANT_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-v4-pro', DEEPSEEK_BASE_URL: 'https://api.deepseek.com' }), {
    apiKey: 'deepseek-key', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com',
  });
});
