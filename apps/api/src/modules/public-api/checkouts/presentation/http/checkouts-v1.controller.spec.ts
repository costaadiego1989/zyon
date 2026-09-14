import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { CheckoutsV1Controller } from './checkouts-v1.controller.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';

async function authorize(method: 'start' | 'get' | 'complete', request: any, scopes: string[] = []) {
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