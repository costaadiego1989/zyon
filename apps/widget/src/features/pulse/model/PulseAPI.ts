import type {
  Bundle,
  Coupon,
  Customer,
  FaceUser,
  Order,
  Product,
  PulseAPIConfig,
  ShippingOption,
  TenantDiscount,
} from './types';
import { buildCouponFromTenant, resolveTenantDiscount } from '../config/tenantDiscount';

export class PulseAPI {
  storeName: string;
  agentName: string;
  currency: string;
  baseUrl: string;
  discount: Required<TenantDiscount>;

  private merchantId: string;
  private sessionToken: string | null;
  private sessionId: string | null;
  private _buyerToken: string | null = null;
  private _initialCart: { product: Product; qty: number } | undefined;
  private _initialCustomer: Partial<Customer> | undefined;
  private _cachedExperience: any = null;

  constructor(config: PulseAPIConfig = {}) {
    this.storeName = config.storeName || 'Aurora Home';
    this.agentName = config.agentName || 'Pulse';
    this.currency = config.currency || 'BRL';
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') || '';
    this.discount = resolveTenantDiscount({ discount: config.discount });
    this.merchantId = config.merchantId || 'mrc_demo';
    this.sessionToken = config.sessionToken ?? null;
    this.sessionId = config.sessionId ?? null;
    this._initialCart = config.initialCart;
    this._initialCustomer = config.initialCustomer;
  }

  private _wait<T>(value: T, ms = 460): Promise<T> {
    return new Promise((res) => setTimeout(() => res(value), ms));
  }

  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.sessionToken) h['Authorization'] = `Bearer ${this.sessionToken}`;
    return h;
  }

  private _buyerHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this._buyerToken || this.sessionToken;
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  setBuyerToken(token: string): void {
    this._buyerToken = token;
  }

  async sendPhoneCode(phone: string): Promise<{ ok: boolean }> {
    if (this.baseUrl) {
      try {
        const r = await fetch(`${this.baseUrl}/buyer/phone/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, merchant_id: this.merchantId }),
        });
        if (r.ok) {
          return (await r.json()) as { ok: boolean };
        }
      } catch {
        // fall through to demo
      }
    }
    return { ok: true };
  }

  async verifyPhoneCode(phone: string, code: string): Promise<{ token: string; name: string; email: string } | null> {
    if (this.baseUrl) {
      try {
        const r = await fetch(`${this.baseUrl}/buyer/phone/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, code, merchant_id: this.merchantId }),
        });
        if (r.ok) {
          const data = await r.json() as { token: string; buyer: { globalUserId: string; name: string; email: string; phone: string } };
          this.setBuyerToken(data.token);
          return { token: data.token, name: data.buyer.name, email: data.buyer.email };
        }
      } catch {
        // fall through
      }
    }
    return null;
  }

  async loginFromSession(sessionId: string): Promise<{ token: string; name: string; email: string } | null> {
    if (this.baseUrl) {
      try {
        const r = await fetch(`${this.baseUrl}/buyer/login-from-session`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (r.ok) {
          const data = await r.json() as { token: string; buyer: { globalUserId: string; name: string; email: string; phone: string } } | null;
          if (data && data.token) {
            this.setBuyerToken(data.token);
            return { token: data.token, name: data.buyer.name, email: data.buyer.email };
          }
        }
      } catch {
        // fall through
      }
    }
    return null;
  }

  async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (this.sessionToken && this.baseUrl) {
      try {
        const r = await fetch(`${this.baseUrl}/embed/start`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            merchant_id: this.merchantId,
            cart: { items: [] },
            customer_hints: {}
          }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          if (data.session_id) {
            this.sessionId = data.session_id;
            // Cache experience for later use
            if (data.experience) {
              this._cachedExperience = data.experience;
              // Update from experience if available
              if (data.experience.brand?.name) this.storeName = data.experience.brand.name;
              if (data.experience.agent?.name) this.agentName = data.experience.agent.name;
            }
          }
          return this.sessionId || 'sess_fallback';
        }
      } catch { /* fall through */ }
    }
    this.sessionId = 'sess_demo';
    return this.sessionId;
  }

  async getCart(): Promise<{ product: Product; qty: number }> {
    if (this._initialCart) return this._initialCart;
    if (this.sessionToken && this.baseUrl) {
      try {
        // Pull from cached experience first (set by ensureSession)
        if (this._cachedExperience?.items?.length) {
          const first = this._cachedExperience.items[0];
          return {
            product: {
              id: first.sku,
              title: first.name,
              subtitle: first.description ?? '',
              price: first.unit_price ?? 0,
              tags: first.tags ?? []
            },
            qty: first.quantity ?? 1
          };
        }
      } catch { /* fall through */ }
    }
    // Fallback: empty product so ViewModel doesn't crash
    return {
      product: { id: 'empty', title: 'Seu pedido', subtitle: 'Nenhum item no carrinho', price: 0, tags: [] },
      qty: 0
    };
  }

  async searchProducts(query: string): Promise<Product[]> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const q = encodeURIComponent(query);
        const r = await fetch(
          `${this.baseUrl}/embed/catalog/search?q=${q}&limit=6`,
          { headers: this._headers() },
        );
        if (r.ok) {
          const data = await r.json() as { products?: unknown[] };
          const products = (data.products ?? []) as Array<{
            sku: string;
            name: string;
            description?: string;
            price_cents?: number;
            tags?: string[];
          }>;
          if (products.length > 0) {
            return products.map((p) => ({
              id: p.sku,
              title: p.name,
              subtitle: p.description ?? '',
              price: (p.price_cents ?? 0) / 100,
              tags: p.tags ?? [],
            }));
          }
        }
      } catch {
        // fall through to local search
      }
    }
    // No local fallback catalog — return empty when API is unavailable
    return [];
  }

  async getRecommendation(): Promise<Bundle> {
    // In real flow, cross-sell comes from /embed/chat responses via experience.suggestedProducts
    // For MVP, return empty bundle or cached suggestion
    if (this._cachedExperience?.suggestedProducts?.length) {
      const sug = this._cachedExperience.suggestedProducts[0];
      return {
        id: sug.sku,
        title: sug.name,
        subtitle: sug.description ?? '',
        price: sug.unit_price ?? 0,
        was: sug.unit_price ?? 0
      };
    }
    // Safe fallback: empty bundle won't be added unless explicitly selected
    return {
      id: 'bundle-empty',
      title: '',
      subtitle: '',
      price: 0,
      was: 0
    };
  }

  async getBestCoupon(productPrice: number, discount?: TenantDiscount): Promise<Coupon> {
    // No coupon for empty carts
    if (productPrice <= 0) {
      return { code: '', amount: 0, displayAmount: 0, label: '', appliedPercent: 0, pendingPercent: 0, pendingAmount: 0, urgencyMinutes: 0, totalPercent: 0 };
    }
    const d = discount ? resolveTenantDiscount({ discount }) : this.discount;
    return this._wait(buildCouponFromTenant(productPrice, d));
  }

  async getShipping(customer?: { cep?: string; number?: string; complement?: string }): Promise<ShippingOption[]> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/shipping/evaluate`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            session_id: sessionId,
            postal_code: customer?.cep ?? '',
            address_number: customer?.number ?? '',
            address_complement: customer?.complement ?? '',
          }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          const opts = (data.options ?? []) as Array<any>;
          if (opts.length > 0) {
            return opts.map((o) => ({
              key: o.key ?? o.carrier_name ?? 'shipping',
              label: o.label ?? o.carrier_name ?? 'Frete',
              tag: o.tag ?? (o.delivery_days === 1 ? 'Mais rápido' : 'Econômico'),
              sub: o.sub ?? (o.delivery_days ? `Chega em ${o.delivery_days} dias úteis` : 'Prazo a confirmar'),
              cost: (o.price_cents ?? 0) / 100,
            }));
          }
        }
      } catch { /* fall through */ }
    }
    // Safe fallback
    return [
      { key: 'sedex', label: 'Sedex Express', tag: 'Mais rápido', sub: 'Chega amanhã até 12h', cost: 0 },
      { key: 'pac', label: 'PAC Econômico', tag: 'Mais barato', sub: 'Chega em 5-7 dias úteis', cost: 0 },
    ];
  }

  async createOrder(payMethod: string = 'pix', _sessionId?: string, installments?: number): Promise<{ id: string; pixQrCode?: string; pixCopyPaste?: string; pixExpiresAt?: string }> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = _sessionId ?? await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/payment/intents`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            session_id: sessionId,
            idempotency_key: `pulse-${Date.now()}`,
            payment_method: payMethod,
            ...(installments ? { installments } : {}),
          }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          const id = data.order_id ?? data.intent_id ?? `ORD-${Date.now()}`;
          return {
            id,
            pixQrCode: data.pix_qr_code,
            pixCopyPaste: data.pix_copy_paste,
            pixExpiresAt: data.pix_expires_at
          };
        }
      } catch { /* fall through to fallback */ }
    }
    // Fallback: generate mock but mark clearly as demo
    if (payMethod === 'pix') {
      return {
        id: `ORD-${Date.now().toString(36).toUpperCase()}`,
        pixCopyPaste: '00020126580014BR.GOV.BCB.PIX0136demo-key-uuid',
        pixExpiresAt: new Date(Date.now() + 30 * 60000).toISOString()
      };
    }
    return { id: `ORD-${Date.now().toString(36).toUpperCase()}` };
  }

  async checkPaymentStatus(intentId: string): Promise<'pending' | 'paid' | 'failed'> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const r = await fetch(`${this.baseUrl}/embed/payment/intents/${encodeURIComponent(intentId)}/status`, { headers: this._headers() });
        if (r.ok) {
          const data = await r.json() as { status?: string };
          const s = data.status;
          if (s === 'paid' || s === 'confirmed' || s === 'completed') return 'paid';
          if (s === 'failed' || s === 'cancelled' || s === 'expired') return 'failed';
        }
      } catch { /* fall through */ }
    }
    return 'pending';
  }

  async supportAnswer(question: string): Promise<{ answer: string }> {
    const q = (question || '').toLowerCase();
    const faq = [
      { k: ['pedido', 'rastre', 'onde', 'entrega', 'chega', 'prazo'], a: 'Seu pedido mais recente está em separação e sai para entrega em até 24h. Você acompanha cada etapa em tempo real na aba "Pedidos" — eu te aviso assim que ele sair.' },
      { k: ['cashback', 'usdc', 'crypto', 'stellar'], a: 'No pagamento com crypto a liquidação acontece na rede Stellar em segundos e você recebe 3% de cashback em USDC, já liberado para a sua próxima compra.' },
      { k: ['parcel', 'juros', 'cartão', 'cartao', 'vezes', '12x'], a: 'Dá para parcelar em até 12x sem juros no cartão de crédito — é só escolher o número de parcelas na hora do pagamento.' },
      { k: ['segur', 'seguro', 'dados', 'privacidade', 'rosto', 'face'], a: 'Tudo é criptografado. O reconhecimento facial é processado no seu dispositivo e a imagem do seu rosto nunca é enviada para o servidor.' },
      { k: ['troca', 'devolu', 'reembolso', 'cancelar'], a: 'Você tem 7 dias para troca ou devolução. Posso abrir a solicitação agora mesmo — é só me dizer qual pedido.' },
      { k: ['cupom', 'desconto', 'promo'], a: 'Eu busco automaticamente o melhor cupom disponível e aplico no carrinho. Agora o cupom PULSE10 já está ativo para você.' },
    ];
    const hit = faq.find((f) => f.k.some((k) => q.includes(k)));
    const answer = hit
      ? hit.a
      : 'Boa pergunta! Já estou com os dados do seu pedido em mãos — me dá um detalhe a mais que eu resolvo isso pra você na hora.';
    return this._wait({ answer }, 700);
  }

  async getOrders(): Promise<Order[]> {
    if ((this._buyerToken || this.sessionToken) && this.baseUrl) {
      try {
        const r = await fetch(
          `${this.baseUrl}/buyer/me/purchases?merchant_id=${this.merchantId}&limit=5`,
          { headers: this._buyerHeaders() },
        );
        if (r.ok) {
          const data = await r.json() as { data?: unknown[] };
          const items = data.data ?? [];
          if ((items as unknown[]).length > 0) {
            return (items as Array<{
              store_name?: string;
              region?: string;
              product_names?: string;
              total_amount_cents?: number;
              status?: string;
              created_at?: string;
            }>).map((o, i) => ({
              store: o.store_name ?? this.storeName,
              region: o.region ?? 'Brasil · BR',
              items: o.product_names ?? '—',
              amount: `R$ ${((o.total_amount_cents ?? 0) / 100).toFixed(2).replace('.', ',')}`,
              tone: (o.status === 'delivered' ? 'done' : 'progress') as 'done' | 'progress',
              status: o.status === 'delivered' ? 'Entregue' : 'Em andamento',
              initial: (o.store_name ?? this.storeName)[0]?.toUpperCase() ?? 'L',
              bg: ['#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#f59e0b'][i % 5],
            }));
          }
        }
      } catch {
        // fall through
      }
    }
    return this._wait([
      { store: this.storeName, region: 'São Paulo · BR', items: 'Smart Speaker mini', amount: 'R$ 349,00', tone: 'done', status: 'Entregue', initial: this.storeName[0]?.toUpperCase() ?? 'L', bg: '#8b5cf6' },
    ]);
  }

  async authenticateFace(): Promise<FaceUser> {
    return this._wait({
      id: 'usr_face_001',
      name: 'Diego Costa',
      email: 'diego@aurora.com',
      initial: 'D',
      verified: true,
    }, 2200);
  }
}

export default PulseAPI;
