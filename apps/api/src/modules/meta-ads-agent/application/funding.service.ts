import type { MetaAdsFundingDiagnosis, MetaAdsFundingSnapshot } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsRepository, type Clock } from '../domain/types.js';
import type { MetaFundingPort } from '../domain/funding.port.js';
import type { BillingService } from './billing.service.js';
import type { ConnectionService } from './connection.service.js';

const separate = 'A verba dos anúncios é paga diretamente à Meta. Ela não está incluída na assinatura nem nos créditos de imagens da Zyon.';
const amount = (value: unknown) => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function validEvidence(value: MetaAdsFundingSnapshot): boolean {
  return amount(value.amountDueCents) && amount(value.prepaidAvailableCents) &&
    ['prepaid', 'postpaid', 'unknown'].includes(value.billingType) && ['present', 'missing', 'unknown'].includes(value.paymentMethod) &&
    typeof value.confirmedBlock === 'boolean' && typeof value.source === 'string' && value.source.length > 0 &&
    (value.currency === null || typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency));
}
export function diagnoseMetaFunding(snapshot: MetaAdsFundingSnapshot): MetaAdsFundingDiagnosis {
  const nextSteps = [`Confira a conta ${snapshot.accountName} (${snapshot.accountId}) em Cobrança e pagamentos na Meta.`, separate];
  if (snapshot.confirmedBlock || snapshot.paymentMethod === 'missing' || snapshot.billingType === 'prepaid' && snapshot.prepaidAvailableCents === 0) {
    nextSteps.unshift(snapshot.paymentMethod === 'missing' ? 'Adicione uma forma de pagamento válida na Meta e use Verificar novamente.' : snapshot.billingType === 'prepaid' && snapshot.prepaidAvailableCents === 0 ? 'Adicione fundos na Meta e use Verificar novamente.' : 'Resolva a pendência informada pela Meta e use Verificar novamente.');
    return { snapshot, status: 'blocked', message: 'Há uma pendência financeira confirmada que impede a publicação. Confira os pagamentos na Meta.', nextSteps, error: 'meta_funding_blocked' };
  }
  if (snapshot.billingType === 'prepaid') {
    if (snapshot.prepaidAvailableCents === null) {
      nextSteps.unshift('Confira os fundos disponíveis na Meta. O valor devido não representa saldo para anunciar.');
      return { snapshot, status: 'unknown', message: 'Sua conta é pré-paga e precisa de fundos para veicular. Não conseguimos confirmar o saldo disponível nesta consulta.', nextSteps, error: null };
    }
    return { snapshot, status: 'ready', message: 'A consulta confirmou fundos na sua conta pré-paga. A entrega dos anúncios também depende da aprovação e das condições da Meta.', nextSteps, error: null };
  }
  if (snapshot.billingType === 'postpaid') {
    if (snapshot.paymentMethod !== 'present') return { snapshot, status: 'unknown', message: 'Sua conta usa cobrança pós-paga, mas não conseguimos confirmar a forma de pagamento. Confira essa informação na Meta.', nextSteps, error: null };
    return { snapshot, status: 'ready', message: 'Sua conta usa cobrança pós-paga. Mantenha uma forma de pagamento válida na Meta e acompanhe o ciclo de cobrança.', nextSteps, error: null };
  }
  return { snapshot, status: 'unknown', message: 'Não conseguimos confirmar o tipo de cobrança desta conta. Confira na Meta antes de definir como pagar os anúncios.', nextSteps, error: null };
}

export class FundingService {
  constructor(private readonly repo: MetaAdsRepository, private readonly billing: Pick<BillingService, 'requireAccess'>,
    private readonly connection: Pick<ConnectionService, 'access'>, private readonly funding: MetaFundingPort, private readonly clock: Clock = () => new Date()) {}
  async describe(merchantId: string): Promise<MetaAdsFundingDiagnosis> {
    await this.billing.requireAccess(merchantId); const access = await this.connection.access(merchantId);
    let snapshot: MetaAdsFundingSnapshot | null = null;
    try { snapshot = await this.funding.read(access); }
    catch (error) { if (error instanceof MetaAdsError && error.code === 'meta_asset_forbidden') throw error; }
    await this.billing.requireAccess(merchantId);
    await this.repo.mutate(merchantId, [], state => {
      if (state.connection.epoch !== access.connectionEpoch || state.connection.account?.id !== access.accountId || !state.connection.encryptedAccessToken) throw new MetaAdsError('meta_connection_changed', 409);
      state.connection.clientConversationId = access.clientConversationId; return { result: null };
    });
    if (snapshot && snapshot.accountId !== access.accountId) throw new MetaAdsError('meta_asset_forbidden', 403);
    const checked = snapshot ? Date.parse(snapshot.checkedAt) : NaN;
    if (!snapshot || !validEvidence(snapshot) || !Number.isFinite(checked) || checked > this.clock().getTime() + 30000 || this.clock().getTime() - checked > 300000) {
      return { snapshot: null, status: 'unknown', message: 'Não foi possível confirmar os dados financeiros da conta nesta consulta.',
        nextSteps: [`Confira a conta ${access.accountId} em Cobrança e pagamentos na Meta e tente Verificar novamente.`, separate], error: 'meta_funding_unavailable' };
    }
    return diagnoseMetaFunding(structuredClone(snapshot));
  }
  /** Unknown evidence never becomes a fictitious zero balance. Confirmed blockers stop writes. */
  async assertPublishable(merchantId: string): Promise<MetaAdsFundingDiagnosis> {
    const diagnosis = await this.describe(merchantId);
    if (diagnosis.status === 'blocked') throw new MetaAdsError('meta_funding_blocked', 409);
    return diagnosis;
  }
}
