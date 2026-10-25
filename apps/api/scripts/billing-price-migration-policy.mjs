// Exact guards for the Growth BRL/month migration. No ambiguous subscriptions.
export function stripeMigrationDecision(subscription, oldIds, newPriceId) {
  if (subscription.items.data.length !== 1) return { skip: 'multiple_items' };
  const item = subscription.items.data[0];
  if (item.price.id === newPriceId) return { skip: 'already_current' };
  if (!oldIds.includes(item.price.id)) return { skip: 'unrecognized_price' };
  if (subscription.status !== 'active') return { skip: 'not_active' };
  if (subscription.cancel_at_period_end || subscription.cancel_at || subscription.schedule || subscription.pending_update || subscription.pause_collection) return { skip: 'pending_lifecycle_change' };
  if (item.quantity !== 1 || item.price.currency !== 'brl' || item.price.recurring?.interval !== 'month' || item.price.recurring.interval_count !== 1) return { skip: 'nonstandard_terms' };
  if (subscription.discounts?.length || item.discounts?.length || subscription.trial_end > Date.now()/1000) return { skip: 'special_terms' };
  return { patch: { items: [{ id: item.id, price: newPriceId, quantity: 1 }], proration_behavior: 'none', billing_cycle_anchor: 'unchanged' }, beforePrice: item.price.id };
}
export function asaasMigrationDecision(subscription, billing, targetValue) {
  if (billing.provider !== 'asaas' || billing.planKey !== 'growth' || billing.asaasSubscriptionId !== subscription.id) return { skip: 'database_mismatch' };
  if (billing.status !== 'active' || subscription.status !== 'ACTIVE') return { skip: 'not_active' };
  if (billing.pendingPlanKey || billing.cancelAtPeriodEnd) return { skip: 'pending_lifecycle_change' };
  if (subscription.value === targetValue) return { skip: 'already_current' };
  if (subscription.value !== 249 || subscription.cycle !== 'MONTHLY') return { skip: 'nonstandard_terms' };
  return { patch: { value: targetValue, updatePendingPayments: false }, beforeValue: subscription.value };
}
