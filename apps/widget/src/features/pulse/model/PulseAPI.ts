import { embedAuthHeaders } from '../../../lib/embed-client.js';

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

function defaultAllowDemoFallbacks(): boolean {
  if (typeof window !== 'undefined') {
    const el = document.querySelector('zyon-checkout-agent');
    if (el?.getAttribute('allow-demo') === 'true') return true;
  }
  return false;
}

function paymentStatusIsPaid(status?: string): boolean {
  return ['paid', 'confirmed', 'completed', 'approved'].includes(status ?? '');
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stringToBuffer(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function webauthnDisplayName(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || email;
}

type PublicKeyCredentialCreationOptionsJson = {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
};

function pulseIdempotencyKey(sessionId: string, payMethod: string, installments?: number): string {
  return ['pulse', sessionId, payMethod, installments ?? 'none'].join('::');
}

export class PulseAPI {
  storeName: string;
  agentName: string;
  currency: string;
  baseUrl: string;
  discount: Required<TenantDiscount>;

  private merchantId: string;
  private sessionToken: string | null;
  private sessionId: string | null;
  private allowDemoFallbacks: boolean;
  private _buyerToken: string | null = null;
  private _initialCart: { product: Product; qty: number } | undefined;
  private _initialCustomer: Partial<Customer> | undefined;

  private _fallbackCatalog: Product[] = [
    { id: 'sd8', title: 'Smart Display 8', subtitle: 'Controla seu speaker por voz e vídeo.', price: 649, tags: ['display', 'tela', 'casa', 'smart'] },
    { id: 'spk', title: 'Smart Speaker mini', subtitle: 'Som ambiente com assistente integrado.', price: 349, tags: ['speaker', 'som', 'casa', 'smart'] },
    { id: 'bulb', title: 'Lâmpada inteligente RGB', subtitle: 'Mude a cor pelo app ou por voz.', price: 89, tags: ['lampada', 'luz', 'cor', 'smart'] },
    { id: 'cam', title: 'Câmera de segurança HD', subtitle: 'Monitoramento 24h com visão noturna.', price: 299, tags: ['camera', 'segurança', 'hd', 'monitoramento'] },
    { id: 'plug', title: 'Tomada inteligente Wi-Fi', subtitle: 'Automatize qualquer aparelho.', price: 99, tags: ['tomada', 'plug', 'energia'] },
    { id: 'vac', title: 'Robô aspirador Lite', subtitle: 'Limpeza automática com mapeamento.', price: 1299, tags: ['robo', 'aspirador', 'limpeza'] },
  ];

  constructor(config: PulseAPIConfig = {}) {
    this.storeName = config.storeName || 'Aurora Home';
    this.agentName = config.agentName || 'Pulse';
    this.currency = config.currency || 'BRL';
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') || '';
    this.discount = resolveTenantDiscount({ discount: config.discount });
    this.merchantId = config.merchantId || 'mrc_demo';
    this.sessionToken = config.sessionToken ?? null;
    this.sessionId = config.sessionId ?? null;
    this.allowDemoFallbacks = config.allowDemoFallbacks ?? defaultAllowDemoFallbacks();
    this._initialCart = config.initialCart;
    this._initialCustomer = config.initialCustomer;
  }

  private _wait<T>(value: T, ms = 460): Promise<T> {
    return new Promise((res) => setTimeout(() => res(value), ms));
  }

  private _headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...embedAuthHeaders(this.sessionToken ?? undefined) };
  }

  private _buyerHeaders(): Record<string, string> {
    const token = this._buyerToken || this.sessionToken;
    return { 'Content-Type': 'application/json', ...embedAuthHeaders(token ?? undefined) };
  }

  setBuyerToken(token: string): void {
    this._buyerToken = token;
  }

  private emptyBundle(): Bundle {
    return { id: 'bundle-empty', title: '', subtitle: '', price: 0, was: 0 };
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
    if (!this.allowDemoFallbacks) throw new Error('phone_code_send_unavailable');
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
          body: JSON.stringify({ session_id: sessionId, merchant_id: this.merchantId }),
        });
        if (r.ok) {
          const data = await r.json() as {
            access_token?: string;
            accessToken?: string;
            token?: string;
            email?: string;
            display_name?: string;
            buyer?: { globalUserId: string; name: string; email: string; phone: string };
          } | null;
          const token = data?.access_token ?? data?.accessToken ?? data?.token;
          if (token) {
            this.setBuyerToken(token);
            return {
              token,
              name: data?.buyer?.name ?? data?.display_name ?? webauthnDisplayName(data?.email ?? ''),
              email: data?.buyer?.email ?? data?.email ?? '',
            };
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
          body: JSON.stringify({ merchant_id: this.merchantId, cart: { items: [] }, customer_hints: {} }),
        });
        if (r.ok) {
          const data = await r.json() as { session_id?: string };
          if (data.session_id) { this.sessionId = data.session_id; return this.sessionId; }
        }
      } catch { /* fall through */ }
    }
    if (!this.allowDemoFallbacks) throw new Error('embed_session_unavailable');
    this.sessionId = 'sess_demo';
    return this.sessionId;
  }

  async getCart(): Promise<{ product: Product; qty: number }> {
    if (this._initialCart) return this._wait(this._initialCart, 200);
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = await this.ensureSession();
        const r = await fetch(`${this.baseUrl}/embed/cart?session_id=${encodeURIComponent(sessionId)}`, { headers: this._headers() });
        if (r.ok) {
          const data = await r.json() as { items?: unknown[] };
          const items = (data.items ?? []) as Array<{ sku: string; name: string; description?: string; price_cents?: number; quantity?: number; tags?: string[] }>;
          if (items.length > 0) {
            const first = items[0];
            return { product: { id: first.sku, title: first.name, subtitle: first.description ?? '', price: (first.price_cents ?? 0) / 100, tags: first.tags ?? [] }, qty: first.quantity ?? 1 };
          }
        }
      } catch { /* fall through */ }
    }
    if (!this.allowDemoFallbacks) throw new Error('cart_unavailable');
    return this._wait({ product: this._fallbackCatalog[0], qty: 1 });
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
    if (!this.allowDemoFallbacks) return [];
    const q = query.toLowerCase();
    const results = this._fallbackCatalog.filter(
      (p) => p.title.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q)),
    );
    return this._wait(results.length ? results : this._fallbackCatalog.slice(0, 4), 300);
  }

  async getRecommendation(): Promise<Bundle> {
    if (!this.allowDemoFallbacks) return this.emptyBundle();
    return this._wait({
      id: 'bulb-combo',
      title: 'Lâmpadas inteligentes · 2 un',
      subtitle: 'Controle por voz junto com o seu display.',
      price: 159,
      was: 199,
    });
  }

  async getBestCoupon(productPrice: number, discount?: TenantDiscount): Promise<Coupon> {
    if (!this.allowDemoFallbacks && !discount) {
      return { code: '', amount: 0, displayAmount: 0, label: '', appliedPercent: 0, pendingPercent: 0 };
    }
    const d = discount ? resolveTenantDiscount({ discount }) : this.discount;
    return this._wait(buildCouponFromTenant(productPrice, d));
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
          const data = await r.json() as { results?: unknown[]; options?: unknown[] };
          const opts = (data.results ?? data.options ?? []) as Array<{ carrier_key?: string; key?: string; carrier_name?: string; label?: string; tag?: string; sub?: string; price_cents?: number; delivery_days?: number; eta_business_days?: number }>;
          if (opts.length > 0) {
            return opts.map((o) => ({
              key: o.carrier_key ?? o.key ?? o.carrier_name ?? 'shipping',
              label: o.label ?? o.carrier_name ?? 'Frete',
              tag: o.tag ?? ((o.eta_business_days ?? o.delivery_days) === 1 ? 'Mais rápido' : 'Econômico'),
              sub: o.sub ?? ((o.eta_business_days ?? o.delivery_days) ? `Chega em ${o.eta_business_days ?? o.delivery_days} dias úteis` : 'Prazo a confirmar'),
              cost: (o.price_cents ?? 0) / 100,
            }));
          }
        }
      } catch { /* fall through */ }
    }
    if (!this.allowDemoFallbacks) return [];
    return this._wait([
      { key: 'sedex', label: 'Sedex Express', tag: 'Mais rápido', sub: 'Chega amanhã até 12h', cost: 0 },
      { key: 'pac', label: 'PAC Econômico', tag: 'Mais barato', sub: 'Chega em 5-7 dias úteis', cost: 0 },
      { key: 'jadlog', label: 'Jadlog Package', tag: 'Retirada fácil', sub: 'Chega em 3-4 dias úteis', cost: 9.9 },
    ]);
  }

  async createOrder(payMethod: string = 'pix', _sessionId?: string, installments?: number): Promise<{ id: string; pixQrCode?: string; pixCopyPaste?: string; pixExpiresAt?: string; clientSecret?: string; stripePublishableKey?: string }> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const sessionId = _sessionId ?? await this.ensureSession();
        const methodMap: Record<string, string> = { pix: 'pix', credito: 'card', debito: 'card', crypto: 'crypto' };
        const method = methodMap[payMethod] ?? payMethod;
        const r = await fetch(`${this.baseUrl}/embed/payment/intents`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            session_id: sessionId,
            idempotency_key: pulseIdempotencyKey(sessionId, payMethod, installments),
            method,
            ...(installments ? { installments } : {}),
          }),
        });
        if (r.ok) {
          const data = await r.json() as any;
          const id = data.id ?? data.intent_id ?? data.order_id;
          if (!id) throw new Error('payment_intent_id_missing');
          const bf = data.buyerFacing ?? data.buyer_facing ?? {};
          return {
            id,
            pixQrCode: data.pix_qr_code,
            pixCopyPaste: bf.qrCodeCopyPaste ?? bf.pix_copy_paste ?? data.pix_copy_paste,
            pixExpiresAt: bf.expiresAt ?? bf.expires_at ?? data.pix_expires_at,
            clientSecret: bf.clientSecret ?? bf.client_secret ?? data.clientSecret,
            stripePublishableKey: bf.stripePublishableKey ?? bf.stripe_publishable_key ?? data.stripePublishableKey,
          };
        }
        const errorText = await r.text().catch(() => '');
        throw new Error(errorText || `payment_intent_failed_${r.status}`);
      } catch (error) {
        if (!this.allowDemoFallbacks) throw error;
      }
    }
    if (!this.allowDemoFallbacks) throw new Error('payment_provider_unavailable');
    if (payMethod === 'pix') {
      return this._wait({ id: 'ORD-DEMO-PIX', pixCopyPaste: '00020126580014BR.GOV.BCB.PIX0136mock-pix-key-uuid-6304ABCD', pixExpiresAt: new Date(Date.now() + 30 * 60000).toISOString() }, 800);
    }
    return this._wait({ id: `ORD-DEMO-${payMethod.toUpperCase()}` }, 800);
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
    if (!this.allowDemoFallbacks) throw new Error('stripe_confirm_unavailable');
    return { status: 'approved', intent_id: intentId };
  }

  async checkPaymentStatus(intentId: string): Promise<'pending' | 'paid' | 'failed'> {
    if (this.sessionToken && this.baseUrl) {
      try {
        const r = await fetch(`${this.baseUrl}/embed/payment/intents/${encodeURIComponent(intentId)}/status`, { headers: this._headers() });
        if (r.ok) {
          const data = await r.json() as { status?: string };
          const s = data.status;
          if (paymentStatusIsPaid(s)) return 'paid';
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
    if (!this.allowDemoFallbacks) return [];
    return this._wait([
      { store: this.storeName, region: 'São Paulo · BR', items: 'Smart Speaker mini', amount: 'R$ 349,00', tone: 'done', status: 'Entregue', initial: this.storeName[0]?.toUpperCase() ?? 'L', bg: '#8b5cf6' },
    ]);
  }

  async registerFace(customer: Pick<Customer, 'name' | 'email' | 'phone'>): Promise<{ credential_id: string; created_at: string }> {
    if (!this.baseUrl || typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
      if (!this.allowDemoFallbacks) throw new Error('webauthn_register_unavailable');
      return this._wait({ credential_id: 'cred_demo', created_at: new Date().toISOString() }, 900);
    }

    let tokenReady = !!this._buyerToken;
    if (!tokenReady) {
      const sessionId = await this.ensureSession();
      const sessionLogin = await this.loginFromSession(sessionId);
      tokenReady = !!sessionLogin;
    }
    if (!tokenReady) {
      const password = `pulse-${this.merchantId}-${customer.email}`;
      try {
        const r = await fetch(`${this.baseUrl}/buyer/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: customer.email,
            password,
            displayName: customer.name || webauthnDisplayName(customer.email),
            phone: customer.phone,
          }),
        });
        if (r.ok) {
          const data = await r.json() as { access_token?: string; accessToken?: string; token?: string };
          const token = data.access_token ?? data.accessToken ?? data.token;
          if (token) {
            this.setBuyerToken(token);
            tokenReady = true;
          }
        }
      } catch {
        // fall through to unavailable
      }
    }
    if (!tokenReady) {
      if (!this.allowDemoFallbacks) throw new Error('buyer_auth_unavailable_for_webauthn_register');
      return this._wait({ credential_id: 'cred_demo', created_at: new Date().toISOString() }, 900);
    }

    const originHostname = window.location.hostname;
    const optionsResponse = await fetch(`${this.baseUrl}/buyer/webauthn/register/options`, {
      method: 'POST',
      headers: this._buyerHeaders(),
      body: JSON.stringify({ origin_hostname: originHostname }),
    });
    if (!optionsResponse.ok) throw new Error('webauthn_register_options_failed');
    const options = await optionsResponse.json() as PublicKeyCredentialCreationOptionsJson;
    // Override rp.id with the actual page hostname so WebAuthn passes the
    // browser origin check when the widget runs as a Web Component (not iframe).
    const rpId = options.rp?.id && options.rp.id !== 'localhost' ? options.rp.id : originHostname;
    const credential = await navigator.credentials.create({
      publicKey: {
        ...options,
        rp: { ...options.rp, id: rpId },
        challenge: base64UrlToBuffer(options.challenge),
        user: { ...options.user, id: stringToBuffer(options.user.id) },
      },
    });
    if (!credential || credential.type !== 'public-key') throw new Error('webauthn_register_credential_missing');
    const publicKeyCredential = credential as PublicKeyCredential;
    const attestation = publicKeyCredential.response as AuthenticatorAttestationResponse;
    const verifyResponse = await fetch(`${this.baseUrl}/buyer/webauthn/register/verify`, {
      method: 'POST',
      headers: this._buyerHeaders(),
      body: JSON.stringify({
        challenge: options.challenge,
        origin_hostname: rpId,
        credential: {
          id: publicKeyCredential.id,
          rawId: bufferToBase64Url(publicKeyCredential.rawId),
          response: {
            attestationObject: bufferToBase64Url(attestation.attestationObject),
            clientDataJSON: bufferToBase64Url(attestation.clientDataJSON),
          },
          type: 'public-key' as const,
        },
      }),
    });
    if (!verifyResponse.ok) throw new Error('webauthn_register_verify_failed');
    return await verifyResponse.json() as { credential_id: string; created_at: string };
  }

  async authenticateFace(email?: string): Promise<FaceUser> {
    const buyerEmail = email?.trim() || this._initialCustomer?.email?.trim();
    if (this.baseUrl && typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials) {
      try {
        let webauthnBasePath = '/buyer-account/webauthn';
        const optionsResponse = await fetch(`${this.baseUrl}${webauthnBasePath}/login/options`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(buyerEmail ? { email: buyerEmail } : {}),
        });
        const options = optionsResponse.ok
          ? await optionsResponse.json() as {
              challenge: string;
              allowCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
              timeout?: number;
              userVerification?: UserVerificationRequirement;
            }
          : await (async () => {
              webauthnBasePath = '/buyer/webauthn';
              const legacyResponse = await fetch(`${this.baseUrl}${webauthnBasePath}/login/options`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(buyerEmail ? { email: buyerEmail } : {}),
              });
              if (!legacyResponse.ok) throw new Error('webauthn_login_options_failed');
              return await legacyResponse.json() as {
                challenge: string;
                allowCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
                timeout?: number;
                userVerification?: UserVerificationRequirement;
              };
            })();

        const credential = await navigator.credentials.get({
          publicKey: {
            challenge: base64UrlToBuffer(options.challenge),
            allowCredentials: options.allowCredentials?.map((c) => ({
              id: base64UrlToBuffer(c.id),
              type: c.type,
              transports: c.transports,
            })),
            timeout: options.timeout ?? 60_000,
            userVerification: options.userVerification ?? 'required',
          },
        });

        if (!credential || credential.type !== 'public-key') throw new Error('webauthn_credential_missing');
        const publicKeyCredential = credential as PublicKeyCredential;
        const assertion = publicKeyCredential.response as AuthenticatorAssertionResponse;
        const verifyBody = {
          challenge: options.challenge,
          credential: {
            id: publicKeyCredential.id,
            rawId: bufferToBase64Url(publicKeyCredential.rawId),
            response: {
              authenticatorData: bufferToBase64Url(assertion.authenticatorData),
              clientDataJSON: bufferToBase64Url(assertion.clientDataJSON),
              signature: bufferToBase64Url(assertion.signature),
            },
            type: 'public-key' as const,
          },
        };
        const verifyResponse = await fetch(`${this.baseUrl}${webauthnBasePath}/login/verify`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(verifyBody),
        });
        if (!verifyResponse.ok) throw new Error('webauthn_login_verify_failed');
        const data = await verifyResponse.json() as {
          access_token?: string;
          accessToken?: string;
          buyer_id?: string;
          globalUserId?: string;
          email?: string;
          name?: string;
          display_name?: string;
        };
        const token = data.access_token ?? data.accessToken;
        if (token) this.setBuyerToken(token);
        const authedEmail = data.email ?? buyerEmail ?? '';
        const name = data.name ?? data.display_name ?? webauthnDisplayName(authedEmail);
        return {
          id: data.buyer_id ?? data.globalUserId ?? publicKeyCredential.id,
          name,
          email: authedEmail,
          initial: name.slice(0, 1).toUpperCase() || authedEmail.slice(0, 1).toUpperCase() || 'U',
          verified: true,
        };
      } catch (error) {
        if (!this.allowDemoFallbacks) throw error;
      }
    }
    if (!this.allowDemoFallbacks) throw new Error('webauthn_unavailable_or_not_registered');
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
