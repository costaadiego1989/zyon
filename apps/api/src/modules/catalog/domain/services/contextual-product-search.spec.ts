import test from 'node:test';
import assert from 'node:assert/strict';
import { contextualProductQuery, contextualSearchGroups, isCatalogBrowseQuery } from './contextual-product-search.js';

test('catalog questions and availability qualifiers do not become impossible product attributes', () => {
  for (const question of ['quais produtos você tem a venda', 'Quais produtos você tem à venda?', 'O que vocês vendem?', 'Quero ver os produtos disponíveis', 'Quais produtos tem nessa loja?', 'Mostra o catálogo', 'Quais as opções disponíveis?']) {
    assert.equal(isCatalogBrowseQuery(question), true, question);
    assert.equal(contextualProductQuery('*', question), '*');
    assert.equal(contextualProductQuery(question), '*');
  }
  for (const question of ['Quero produtos disponíveis para pele sensível', 'Quero um produto sem perfume', 'Quais cremes vocês vendem?']) {
    assert.equal(isCatalogBrowseQuery(question), false, question);
    assert.ok(contextualSearchGroups(contextualProductQuery('*', question)!).length > 0);
  }
  assert.deepEqual(contextualSearchGroups('Quais cremes vocês vendem?'), [['creme']]);
});

test('natural needs survive a wildcard search while explicit catalog navigation remains broad', () => {
  assert.equal(contextualProductQuery('*', 'quero um produto para minha pele'), 'quero um produto para minha pele');
  assert.deepEqual(contextualSearchGroups('quero um produto para minha pele'), [['pele', 'facial', 'rosto', 'cutane']]);
  assert.equal(contextualProductQuery('*'), '*');
  assert.equal(contextualProductQuery('*', 'Continuar comprando'), '*');
  assert.equal(contextualProductQuery('pele', 'quero um produto para pele sem perfume'), 'pele sem perfume');
  assert.equal(contextualProductQuery('hidratante', 'quero um produto para minha pele'), 'hidratante');
  assert.deepEqual(contextualSearchGroups('quero um hidratante para pele sensível'), [['hidrat'], ['pele', 'facial', 'rosto', 'cutane'], ['sensivel', 'sensiv']]);
});

test('negation, product names and specific constraints are retained instead of broadening to all products', () => {
  assert.deepEqual(contextualSearchGroups('pele sem perfume'), [['sem perfume'], ['pele', 'facial', 'rosto', 'cutane']]);
  assert.deepEqual(contextualSearchGroups('Núcleo Sérum de Barreira'), [['nucleo'], ['serum'], ['barreira']]);
  assert.deepEqual(contextualSearchGroups('*'), []);
  assert.deepEqual(contextualSearchGroups('produto'), []);
});

test('unknown profile answers and absent preferences are not injected as product exclusions', () => {
  for (const answer of ['Não sei meu tipo de pele', 'NÃO  SEI', 'Não tenho outras preferências', 'Sem preferência', 'Sem restrições', 'Não importa']) {
    assert.equal(contextualProductQuery('hidratante textura leve', answer), 'hidratante textura leve', answer);
  }
  assert.equal(contextualProductQuery('hidratante', 'Não sei meu tipo de pele. Sem perfume, até R$ 150'), 'hidratante sem perfume');
  assert.deepEqual(contextualSearchGroups('hidratante sem perfume'), [['sem perfume'], ['hidrat']]);
});
