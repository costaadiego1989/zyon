import test from 'node:test';
import assert from 'node:assert/strict';
import { contextualProductQuery, contextualSearchGroups } from './contextual-product-search.js';

test('natural needs survive a wildcard search while explicit catalog navigation remains broad', () => {
  assert.equal(contextualProductQuery('*', 'quero um produto para minha pele'), 'quero um produto para minha pele');
  assert.deepEqual(contextualSearchGroups('quero um produto para minha pele'), [['pele', 'facial', 'rosto', 'cutane']]);
  assert.equal(contextualProductQuery('*'), '*');
  assert.equal(contextualProductQuery('hidratante', 'quero um produto para minha pele'), 'hidratante');
  assert.deepEqual(contextualSearchGroups('quero um hidratante para pele sensível'), [['hidrat'], ['pele', 'facial', 'rosto', 'cutane'], ['sensivel', 'sensiv']]);
});

test('negation, product names and specific constraints are retained instead of broadening to all products', () => {
  assert.deepEqual(contextualSearchGroups('pele sem perfume'), [['sem perfume'], ['pele', 'facial', 'rosto', 'cutane']]);
  assert.deepEqual(contextualSearchGroups('Núcleo Sérum de Barreira'), [['nucleo'], ['serum'], ['barreira']]);
  assert.deepEqual(contextualSearchGroups('*'), []);
  assert.deepEqual(contextualSearchGroups('produto'), []);
});
