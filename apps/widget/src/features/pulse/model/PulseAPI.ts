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

  private checkoutCartPayload(): {
    currency: string;
    source: string;
    total: number;
    items: Array<{ sku: string; name: string; price: number; quantity: number }>;
  } {
    if (!this._initialCart) {
      return { currency: this.currency, source: 'storefront', total: 0, items: [] };
    }
    const { product, qty } = this._initialCart;
    const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
    return {
      currency: this.currency,
      source: 'storefront',
      total: Math.round(product.price * quantity * 100) / 100,
      items: [{
        sku: product.id,
        name: product.title,
        price: product.price,
        quantity
      }]
    };
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
            cart: this.checkoutCartPayload(),
            customer: this._initialCustomer ?? {}
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
            price?: number;
            unit_price?: number;
            price_cents?: number;
            tags?: string[];
            category?: string;
          }>;
          if (products.length > 0) {
            return products.map((p) => ({
              id: p.sku,
              title: p.name,
              subtitle: p.description ?? p.category ?? '',
              price: p.unit_price ?? p.price ?? ((p.price_cents ?? 0) / 100),
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
    if (!this._cachedExperience && this.sessionToken && this.baseUrl) {
      await this.ensureSession();
    }
    // Check cached experience first
    if (this._cachedExperience?.suggestedProducts?.length) {
      const sug = this._cachedExperience.suggestedProducts[0];
      if (sug.unit_price > 0 && sug.name) {
        return {
          id: sug.sku,
          title: sug.name,
          subtitle: sug.description ?? '',
          price: sug.unit_price,
          was: sug.unit_price
        };
      }
    }
    // Call /embed/cross-sell/suggest endpoint for dynamic recommendations
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/cross-sell/suggest`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          const suggestions = data.suggestions ?? data.products ?? [];
          if (suggestions.length > 0) {
            const sug = suggestions[0];
            const price = sug.unit_price ?? sug.price ?? 0;
            if (price > 0 && (sug.name || sug.title)) {
              return {
                id: sug.sku ?? sug.id ?? 'cross-sell',
                title: sug.name ?? sug.title ?? '',
                subtitle: sug.description ?? sug.subtitle ?? '',
                price,
                was: price
              };
            }
          }
        }
      } catch { /* fall through */ }
    }
    // Safe fallback: empty bundle won't be shown
    return {
      id: 'bundle-empty',
      title: '',
      subtitle: '',
      price: 0,
      was: 0
    };
  }

  async getBestCoupon(productPrice: number, discount?: TenantDiscount): Promise<Coupon> {
    // Try real API coupon application first
    if (productPrice > 0 && this.sessionToken && this.baseUrl) {
      try {
        const sessionId = await this.ensureSession();
        // Try to apply ZYON10 coupon via embed/coupons/apply endpoint
        const couponCode = this._cachedExperience?.rules?.couponBoxEnabled !== false ? 'ZYON10' : '';
        if (couponCode) {
          const r = await fetch(`${this.baseUrl}/embed/coupons/apply`, {
            method: 'POST',
            headers: this._headers(),
            body: JSON.stringify({
              session_id: sessionId,
              merchant_id: this.merchantId,
              code: couponCode,
              cart: {
                currency: 'BRL',
                total: productPrice,
                items: this._cachedExperience?.items ?? [{ sku: 'UNKNOWN', name: 'Produto', price: productPrice, quantity: 1 }],
              },
            }),
          });
          if (r.ok) {
            const data = await r.json() as any;
            const discountApplied = data.discount_applied ?? 0;
            if (discountApplied > 0) {
              const pct = Math.round((discountApplied / productPrice) * 100);
              return {
                code: couponCode,
                amount: -discountApplied,
                displayAmount: -discountApplied,
                label: `${pct}% de desconto`,
                appliedPercent: pct,
                pendingPercent: 0,
                pendingAmount: 0,
                urgencyMinutes: 5,
                totalPercent: pct,
              };
            }
          }
        }
      } catch { /* fall through to tenant discount or empty */ }
    }
    // Fallback: use tenant discount if configured
    if (productPrice <= 0) {
      return { code: '', amount: 0, displayAmount: 0, label: '', appliedPercent: 0, pendingPercent: 0, pendingAmount: 0, urgencyMinutes: 0, totalPercent: 0 };
    }
    if (discount) {
      const d = resolveTenantDiscount({ discount });
      return this._wait(buildCouponFromTenant(productPrice, d));
    }
    // No coupon available from API and no tenant discount
    return { code: '', amount: 0, displayAmount: 0, label: '', appliedPercent: 0, pendingPercent: 0, pendingAmount: 0, urgencyMinutes: 0, totalPercent: 0 };
  }

  async updateCustomer(customer: { name: string; email: string; cpf: string; phone?: string }): Promise<{ ok: boolean }> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/customer/update`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            session_id: sessionId,
            customer: {
              fullName: customer.name,
              email: customer.email,
              cpf: customer.cpf,
              phone: customer.phone,
            },
          }),
        });
        if (r.ok) {
          return (await r.json()) as { ok: boolean };
        }
      } catch {
        // fall through
      }
    }
    return { ok: true };
  }

  async getShipping(customer?: { cep?: string; number?: string; complement?: string }): Promise<ShippingOption[]> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/shipping/quote`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            session_id: sessionId,
            destination_zip: customer?.cep ?? '',
          }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          const opts = (data.results ?? data.options ?? []) as Array<any>;
          if (opts.length > 0) {
            return opts.map((o) => ({
              key: o.carrier_key ?? o.key ?? 'shipping',
              label: o.label ?? o.carrier_name ?? 'Frete',
              tag: o.is_free ? 'Grátis' : (o.eta_days <= 2 ? 'Mais rápido' : o.eta_days <= 5 ? 'Rápido' : 'Econômico'),
              sub: o.eta_days ? `Chega em ${o.eta_days} dias úteis` : 'Prazo a confirmar',
              cost: o.is_free ? 0 : (o.price ?? o.price_cents ?? 0) / 100,
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

  async selectShipping(carrierKey: string, _sessionId?: string): Promise<{ ok: boolean }> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = _sessionId ?? await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/shipping/select`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({ session_id: sessionId, carrier_key: carrierKey }),
        });
        if (r.ok) return { ok: true };
        const errorText = await r.text().catch(() => '');
        throw new Error(errorText || `shipping_select_failed_${r.status}`);
      } catch (error) {
        throw error instanceof Error ? error : new Error('shipping_select_failed');
      }
    }
    return { ok: true };
  }

  async createOrder(payMethod: string = 'pix', _sessionId?: string, installments?: number): Promise<{ id: string; pixQrCode?: string; pixCopyPaste?: string; pixExpiresAt?: string; clientSecret?: string; stripePublishableKey?: string }> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = _sessionId ?? await this.ensureSession();
        // Map widget pay method to API method field
        const methodMap: Record<string, string> = { pix: 'pix', credito: 'card', debito: 'card', crypto: 'crypto' };
        const method = methodMap[payMethod] ?? payMethod;
        const r = await fetch(`${this.baseUrl}/embed/payment/intents`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            session_id: sessionId,
            idempotency_key: `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            method,
            ...(installments ? { installments } : {}),
          }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          const id = data.id ?? data.order_id ?? data.intent_id ?? `ORD-${Date.now()}`;
          // API returns PaymentIntentSnapshot with buyerFacing containing PIX data
          const bf = data.buyerFacing ?? data.buyer_facing ?? {};
          return {
            id,
            pixQrCode: bf.encodedQrImage ? `data:image/png;base64,${bf.encodedQrImage}` : undefined,
            pixCopyPaste: bf.qrCodeCopyPaste ?? bf.pix_copy_paste ?? data.pix_copy_paste,
            pixExpiresAt: bf.quoteExpiresAt ?? bf.expiresAt ?? bf.expires_at ?? data.pix_expires_at ?? data.expires_at ?? new Date(Date.now() + 15 * 60000).toISOString(),
            clientSecret: bf.clientSecret ?? bf.client_secret ?? data.clientSecret ?? data.client_secret,
            stripePublishableKey: bf.stripePublishableKey ?? bf.stripe_publishable_key ?? data.stripePublishableKey ?? data.stripe_publishable_key,
          };
        }
        const errorText = await r.text().catch(() => '');
        throw new Error(errorText || `payment_intent_failed_${r.status}`);
      } catch (error) {
        throw error instanceof Error ? error : new Error('payment_intent_failed');
      }
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

  async confirmStripePayment(intentId: string, _sessionId?: string): Promise<{ status: string; intent_id: string }> {
    if (this.sessionToken && this.baseUrl) {
      const sessionId = _sessionId ?? await this.ensureSession();
      const r = await fetch(`${this.baseUrl}/embed/payment/intents/${encodeURIComponent(intentId)}/stripe/confirm`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (r.ok) return (await r.json()) as { status: string; intent_id: string };
      const errorText = await r.text().catch(() => '');
      throw new Error(errorText || `stripe_confirm_failed_${r.status}`);
    }
    return { status: 'approved', intent_id: intentId };
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
