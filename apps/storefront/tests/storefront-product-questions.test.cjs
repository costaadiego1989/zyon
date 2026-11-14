const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relative) {
  const filename = path.join(__dirname, '../src', relative);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const localRequire = id => id.startsWith('.')
    ? load(path.relative(path.join(__dirname, '../src'), path.resolve(path.dirname(filename), id + '.ts')))
    : require(id);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}
const Component = load('components/blocks/ProductQuestionsBlock.tsx').default;
const render = block => renderToStaticMarkup(React.createElement(Component, { block }));

test('public answers remain escaped text and do not claim personal ownership', () => {
  const html = render({ type: 'product_questions', data: { productId: 'qa', productName: 'Produto QA',
    scope: 'public_answered', filter: 'answered', questions: [{ id: 'faq', question: '<script>bad()</script>', answer: 'Resposta pública' }], totalCount: 1 } });
  assert.match(html, /Resposta pública/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|Suas perguntas/);
});
test('own history shows protocol and unlinked status without inventing an answer', () => {
  const html = render({ type: 'buyer_product_questions', data: { productId: 'qa', productName: 'Produto QA',
    scope: 'buyer_history', filter: 'mine', questions: [{ id: 'q1', ticketId: 'ticket-qa', question: 'Minha dúvida', date: '2026-10-29', answerState: 'not_linked' }],
    returnedCount: 1, hasMore: true, historyLimited: true } });
  assert.match(html, /ticket-qa/); assert.match(html, /Resposta não vinculada/); assert.match(html, /apenas as perguntas recentes/);
  assert.match(html, /Há outras perguntas/); assert.doesNotMatch(html, /Resposta pública/);
});
test('receipts distinguish registration, moderation and publication', () => {
  const question = render({ type: 'question_submission', data: { ticketId: 'ticket-qa', productId: 'qa', status: 'awaiting_answer' } });
  assert.match(question, /Aguardando resposta/); assert.match(question, /ticket-qa/);
  const review = render({ type: 'review_submission', data: { reviewId: 'review-qa', productId: 'qa', status: 'pending_moderation' } });
  assert.match(review, /aguarda moderação/); assert.doesNotMatch(review, /foi publicada/);
});
test('a suggested catalog read never becomes a question write or private history request', () => {
  const parse = load('lib/storefront-suggested-read-actions.ts').parseSuggestedReadActions;
  for (const action of [{ tool: 'create_question', args: { productId: 'qa', question: 'Dúvida' } },
    { tool: 'get_product_questions', args: { productId: 'qa', filter: 'mine' } }]) {
    assert.equal(parse({ version: 1, items: [{ id: 'suggestion', label: 'Sugestão', action }] }), null);
  }
});
test('question action validates exact args and cannot use text fallback when not advertised', () => {
  const a = load('lib/storefront-read-ui-action.ts');
  const command = { tool: 'create_question', args: { productId: 'qa', question: 'Dúvida real' } };
  assert.equal(a.isStorefrontReadUiAction({ ...command, args: { ...command.args, buyerId: 'foreign' } }), false);
  assert.equal(a.isStorefrontReadUiAction({ ...command, args: { ...command.args, question: ' ' } }), false);
  assert.throws(() => a.storefrontReadUiActionRequest('conv', 'merchant', command), /question_submission_unavailable/);
  a.rememberStorefrontReadUiActionCapability('conv', 'merchant', { version: 1, tools: ['get_product_details','search_products','get_product_questions','ask_product_question','create_question'] });
  assert.equal(a.storefrontReadUiActionRequest('conv', 'merchant', command).ui_action.args.question, 'Dúvida real');
  assert.throws(() => a.storefrontReadUiActionRequest('conv', 'foreign', command), /question_submission_unavailable/);
});
