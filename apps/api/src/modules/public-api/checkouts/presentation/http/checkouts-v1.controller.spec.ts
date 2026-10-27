import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { CheckoutsV1Controller } from './checkouts-v1.controller.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { SendCheckoutMessageDto, ReconcileCheckoutMessageDto } from './dtos/checkout.dtos.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

async function authorize(method: 'start' | 'get' | 'complete' | 'sendMessage' | 'reconcileMessage', request: any, scopes: string[] = []) {
  const context = {
    getClass: () => CheckoutsV1Controller,
    getHandler: () => CheckoutsV1Controller.prototype[method],
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const credential = new TenantCredentialGuard(
    { authenticate: async () => ({ merchantId: 'merchant_a', userId: 'owner_a', email: 'owner@example.test', role: 'owner' }) } as never,
    { read: (cookie?: string) => cookie === 'session=valid' ? 'valid' : undefined } as never,
    { execute: async () => ({ merchantId: 'merchant_a', id: 'key_a', environment: 'test', scopes }) } as never,
  );
  const access = new TenantAccessGuard(new Reflector());
  const guards = Reflect.getMetadata(GUARDS_METADATA, CheckoutsV1Controller) ?? [];
  assert.deepEqual(guards, [TenantCredentialGuard, TenantAccessGuard]);
  for (const guard of guards) await (guard === TenantCredentialGuard ? credential : access).canActivate(context);
}

test('checkout resolves the authenticated owner before idempotency and dispatches to that tenant', async () => {
  const request: any = { headers: { cookie: 'session=valid' } };
  await authorize('start', request);
  assert.equal(request.tenantPrincipal.tenantId, 'merchant_a');
  let received: any;
  const controller = new CheckoutsV1Controller({ execute: async (input: unknown) => { received = input; return { session_id: 'test-session' }; } } as never, ...Array(7).fill({}) as [never, never, never, never, never, never, never]);
  await controller.start(request, { merchant_id: 'other_merchant', cart: [{ sku: 'TEST-SKU', name: 'Test', price: 100, quantity: 1 }] } as any);
  assert.equal(received.merchant_id, 'merchant_a');
});

test('checkout rejects an unauthenticated request', async () => {
  await assert.rejects(authorize('start', { headers: {} }), /missing_tenant_credential/);
});

test('a read-only checkout key cannot create or complete an order', async () => {
  const req = () => ({ headers: { 'x-aacp-api-key': 'aacp_test' } });
  await authorize('get', req(), ['checkout:read']);
  await assert.rejects(authorize('start', req(), ['checkout:read']), /missing_api_key_scope/);
  await assert.rejects(authorize('complete', req(), ['checkout:write']), /missing_api_key_scope/);
  await authorize('complete', req(), ['checkout:write', 'orders:write']);
});

test('public chat carries the message identity and receipt without trusting body tenant or losing response text', async () => {
  const request: any = { headers: { 'x-aacp-api-key': 'aacp_test' } };
  await authorize('sendMessage', request, ['checkout:write']);
  let received: any;
  const messageId = '28cf679a-d140-442f-9d89-5a6d045e8831';
  const receipt = { message_id: messageId, status: 'completed' };
  const controller = new CheckoutsV1Controller({} as never, {} as never, {} as never, {
    async execute(input: unknown) { received = input; return { message: 'Resposta do checkout', chat_request: receipt, turns: [] }; },
  } as never, ...Array(4).fill({}) as [never, never, never, never]);
  const response = await controller.sendMessage(request, 'server-session', { conversation_id: 'conversation', user_message: 'Olá',
    message_id: messageId, merchant_id: 'forged', session_id: 'forged' } as any);
  assert.equal(received.merchant_id, 'merchant_a');
  assert.equal(received.session_id, 'server-session');
  assert.equal(received.message_id, messageId);
  assert.equal(response.content, 'Resposta do checkout');
  assert.equal(response.session_id, 'server-session');
  assert.equal(response.conversation_id, 'conversation');
  assert.deepEqual(response.chat_request, receipt);
});

test('public chat DTO retains a valid key under whitelist validation and rejects malformed keys', async () => {
  const body = { conversation_id: 'conversation', user_message: 'Olá', message_id: 'message_00000001' };
  const dto = plainToInstance(SendCheckoutMessageDto, { ...body, forged: 'ignored' });
  assert.deepEqual(await validate(dto, { whitelist: true }), []);
  assert.equal(dto.message_id, body.message_id);
  assert.equal((dto as any).forged, undefined);
  for (const message_id of ['short', 'a'.repeat(129), 'invalid key with spaces']) {
    const errors = await validate(plainToInstance(SendCheckoutMessageDto, { ...body, message_id }));
    assert.ok(errors.some(error => error.property === 'message_id'));
  }
});

test('recovery requires write scope and derives tenant, session and message from authenticated transport', async () => {
  const req = () => ({ headers: { 'x-aacp-api-key': 'aacp_test' } });
  await assert.rejects(authorize('reconcileMessage', req(), ['checkout:read']), /missing_api_key_scope/);
  await assert.rejects(authorize('reconcileMessage', { headers: {} }), /missing_tenant_credential/);
  const request: any = req(); await authorize('reconcileMessage', request, ['checkout:write']);
  let seen: any;
  const receipt = { chat_request: { message_id: 'message_00000001', status: 'reconciled', next_action: 'refresh_session' } };
  const controller = new CheckoutsV1Controller({} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, { execute(input: unknown) { seen = input; return receipt; } } as never);
  assert.deepEqual(await controller.reconcileMessage(request, 'server-session', 'message_00000001', {
    conversation_id: 'conversation', merchant_id: 'forged', session_id: 'forged', message_id: 'forged',
  } as any), receipt);
  assert.deepEqual(seen, { merchant_id: 'merchant_a', session_id: 'server-session', message_id: 'message_00000001', conversation_id: 'conversation' });
});

test('recovery DTO preserves only a bounded conversation reference', async () => {
  const dto = plainToInstance(ReconcileCheckoutMessageDto, { conversation_id: 'conversation', user_message: 'must not replay' });
  assert.deepEqual(await validate(dto, { whitelist: true }), []);
  assert.equal((dto as any).user_message, undefined);
  assert.ok((await validate(plainToInstance(ReconcileCheckoutMessageDto, { conversation_id: 'x'.repeat(201) }))).length);
});
