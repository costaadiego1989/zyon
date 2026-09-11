import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BILLING_PLANS, BILLING_PLAN_PRESENTATION, BILLING_FEATURE_LABELS, billingLimitHighlights } from '../../../packages/shared-types/dist/billing-plans.js';

const file = fileURLToPath(new URL('../index.html', import.meta.url));
const html = fs.readFileSync(file, 'utf8');
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const list = items => items.map(item => `                <li>${escape(item)}</li>`).join('\n');
const cards = Object.entries(BILLING_PLANS).map(([key,plan]) => {
  const copy = BILLING_PLAN_PRESENTATION[key];
  const limits = billingLimitHighlights(plan.limits);
  const features = Object.entries(plan.features).filter(([,on]) => on).map(([feature]) => {
    if (!BILLING_FEATURE_LABELS[feature]) throw Error('Missing feature label: '+feature);
    return BILLING_FEATURE_LABELS[feature];
  });
  const visible = [...limits.slice(0,4),...features.slice(0,3)];
  const additional = [...limits.slice(4),...features.slice(3)];
  const fee = (plan.transactionFeeCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  return `            <article class="plan${key === 'growth' ? ' plan--featured' : ''}" data-plan="${key}">
              <div class="plan-label">${copy.eyebrow} <span>${copy.badge}</span></div>
              <h3>${plan.name}</h3>
              <p class="plan-description">${copy.description}</p>
              <div class="plan-price">R$ ${plan.monthlyPriceBrl} <small>/mês</small></div>
              <p class="plan-fee">${key === 'starter' ? `Após os 14 dias iniciais: ${fee} por transação.` : `${fee} por transação. Assinatura mensal.`}</p>
              <span class="plan-includes">${copy.includes}</span>
              <ul class="plan-list">
${list(visible)}
              </ul>
              <details class="plan-details"><summary>Todos os recursos e limites <span aria-hidden="true">+</span></summary><ul class="plan-list">
${list(additional)}
              </ul></details>
              <a class="button ${key === 'growth' ? 'button--primary' : 'plan--plain-button'}" href="https://app.zyon-payments.com.br/?mode=signup&amp;plan=${key}">${key === 'starter' ? 'Começar no Free' : 'Assinar '+plan.name}</a>
            </article>`;
});
const start = html.indexOf('          <div class="pricing-grid">');
const end = html.indexOf('          <p class="pricing-note">',start);
if (start < 0 || end < 0) throw Error('Pricing block not found');
const next = html.slice(0,start)+'          <div class="pricing-grid">\n'+cards.join('\n')+'\n          </div>\n'+html.slice(end);
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('Site billing catalog is stale. Run the sync script after building shared-types.'); process.exit(1); }
  console.log('Site plans match the shared billing catalog.');
} else { fs.writeFileSync(file,next); console.log('Site plans synchronized.'); }
