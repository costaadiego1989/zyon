import { useState, useRef, useEffect } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { AgentAvatar } from "./AgentAvatar";
import { PulseAgentOrb } from "./PulseAgentOrb";
import type { ChatBlock } from "@/api/checkout-session";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

function translateShippingLabel(label: string): string {
  const translations: Record<string, string> = {
    own_delivery_flat: "Entrega própria",
    own_delivery: "Entrega própria",
    correios_pac: "PAC",
    correios_sedex: "Sedex",
    jadlog_package: "Jadlog",
    free_shipping: "Frete grátis",
  };
  if (label.includes("_")) {
    return translations[label] ?? label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return label;
}

/* ─── Block Renderers ─── */

function CartSummaryBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  const items = (data.items as Array<{ name: string; qty?: number; quantity?: number; total?: string; price?: number }>) ?? [];
  const total = data.total as number | undefined;
  const discount = data.discount as number | undefined;

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Resumo do carrinho</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--mut)", padding: "4px 0" }}>
          <span>{item.name} x{item.qty ?? item.quantity ?? 1}</span>
          <span>{item.total ?? (item.price != null ? formatPrice(item.price) : "")}</span>
        </div>
      ))}
      {discount != null && discount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--aacp-accent, #0f766e)", padding: "4px 0" }}>
          <span>Desconto</span>
          <span>-{formatPrice(discount)}</span>
        </div>
      )}
      {total != null && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 600, borderTop: "1px solid var(--bd)", paddingTop: "8px", marginTop: "8px" }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      )}
    </div>
  );
}

function ShippingOptionsBlock({ options }: { options?: unknown }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const selectShipping = useCheckoutStore((s) => s.selectShipping);
  const opts = (options as Array<{ key: string; label: string; tag?: string; sub?: string; cost?: number }>) ?? [];

  const handleSelect = async (opt: (typeof opts)[0]) => {
    await selectShipping(opt.key);
    void sendMessage(`Entrega · ${translateShippingLabel(opt.label)}`);
  };

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Escolha o frete:</div>
      {opts.map((opt) => (
        <button
          key={opt.key}
          onClick={() => void handleSelect(opt)}
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>{translateShippingLabel(opt.label)}</span>
            <span style={{ fontSize: "12px", color: "var(--aacp-accent, #0f766e)" }}>
              {opt.cost === 0 ? "Grátis" : opt.cost != null ? formatPrice(opt.cost / 100) : ""}
            </span>
          </div>
          {opt.sub && <div style={{ fontSize: "11px", color: "var(--mut)", marginTop: "2px" }}>{opt.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function PaymentMethodsBlock({ methods }: { methods?: unknown }) {
  const pay = useCheckoutStore((s) => s.pay);
  const meths = (methods as Array<{ key: string; label: string; sub?: string }>) ?? [];

  const handleSelect = (method: (typeof meths)[0]) => {
    void pay(method.key as "pix" | "credito" | "debito" | "crypto");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Forma de pagamento:</div>
      {meths.map((m) => (
        <button
          key={m.key}
          onClick={() => handleSelect(m)}
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: 600 }}>{m.label}</div>
          {m.sub && <div style={{ fontSize: "11px", color: "var(--mut)" }}>{m.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function PixPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    pollPayment();
  }, [pollPayment]);

  if (!data) return null;

  const handleCopy = async () => {
    const code = String(data.pix_code ?? "");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for iframe/insecure context
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>Pague com Pix</div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 8px", lineHeight: 1.4 }}>
        Escaneie o QR Code no app do seu banco. Pedido confirmado assim que o pagamento cai.
      </p>
      {data.pix_qr_url ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
          <img src={String(data.pix_qr_url)} alt="QR Code Pix" style={{ width: "160px", height: "160px", borderRadius: "8px" }} />
        </div>
      ) : null}
      {data.pix_code != null && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          <code style={{ flex: 1, minWidth: 0, background: "var(--chip, var(--card))", padding: "8px 10px", borderRadius: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", fontFamily: "var(--aacp-font, inherit)" }}>
            {String(data.pix_code).slice(0, 50)}...
          </code>
          <button
            onClick={handleCopy}
            style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "13px", fontWeight: 600, fontFamily: "var(--aacp-font, inherit)", cursor: "pointer", flex: "none", transition: "opacity 0.2s" }}
          >
            {copied ? "✓ Copiado" : "Copiar Pix"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px" }}>
        <PulseAgentOrb placement="chatLoading" active />
        <p style={{ fontSize: "13px", color: "var(--mut)", margin: 0, textAlign: "center" }}>
          Aguardando pagamento...
        </p>
      </div>
    </div>
  );
}

function StripeCardBlockForm({
  clientSecret,
  intentId
}: {
  clientSecret: string;
  intentId: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Select each slice individually — returning a new object literal from the
  // selector causes an infinite render loop (getSnapshot not cached).
  const api = useCheckoutStore((s) => s.api);
  const pollPayment = useCheckoutStore((s) => s.pollPayment);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) {
      setError("Stripe não carregou corretamente");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Confirm payment with Stripe Elements (card data never touches our server)
      const { paymentIntent, error: confirmError } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: elements.getElement(CardElement)!,
          },
        }
      );

      if (confirmError) {
        setError(confirmError.message || "Erro ao processar cartão");
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "requires_action") {
        // Confirm the payment server-side (marks as approved in DB)
        if (api) {
          try {
            await api.confirmStripePayment(intentId);
          } catch (confirmErr) {
            // Server confirm failed, but Stripe payment succeeded — poll anyway
            console.error("Server confirm failed:", confirmErr);
          }
        }
        // Start polling for approved status
        pollPayment();
      } else {
        setError(`Payment failed: ${paymentIntent?.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: "12px" }}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                color: "var(--tx)",
                "::placeholder": {
                  color: "var(--mut)",
                },
              },
              invalid: {
                color: "#c92a2a",
              },
            },
          }}
        />
      </div>
      {error && (
        <div style={{ padding: "8px 10px", borderRadius: "6px", background: "#fee", color: "#c92a2a", fontSize: "12px", marginBottom: "12px" }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || loading}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: "8px",
          background: loading || !stripe ? "var(--bd)" : "var(--aacp-accent, #0f766e)",
          color: "#fff",
          border: "none",
          fontSize: "13px",
          fontWeight: 600,
          fontFamily: "var(--aacp-font, inherit)",
          cursor: loading || !stripe ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Processando..." : "Pagar"}
      </button>
    </form>
  );
}

// Cache Stripe.js promise per publishable key — loadStripe() must NOT run on
// every render (a new Promise each render re-mounts <Elements> → infinite loop).
const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(publishableKey: string) {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

function StripeCardBlock({ data }: { data?: Record<string, unknown> }) {
  const clientSecret = data?.stripe_client_secret as string | undefined;
  const publishableKey = data?.stripe_publishable_key as string | undefined;
  const intentId = data?.intent_id as string | undefined;

  if (!clientSecret || !publishableKey || !intentId) {
    return (
      <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
        <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>Erro: dados de pagamento incompletos</p>
      </div>
    );
  }

  const stripePromise = getStripePromise(publishableKey);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Pague com Cartão de Crédito</div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 12px", lineHeight: 1.4 }}>
        Seus dados do cartão são seguros e encriptados.
      </p>
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <StripeCardBlockForm clientSecret={clientSecret} intentId={intentId} />
      </Elements>
    </div>
  );
}

function OrderConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  return (
    <div style={{ padding: "16px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
        <div style={{ animation: "bounce 0.6s ease infinite alternate" }}>
          <PulseAgentOrb placement="chatBubble" active />
        </div>
      </div>
      <div style={{ fontSize: "28px", marginBottom: "6px" }}>✓</div>
      <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--tx)" }}>
        {(data.title as string) || "Pedido confirmado!"}
      </div>
      {data.order_id ? (
        <div style={{ fontSize: "12px", color: "var(--mut)", marginTop: "4px" }}>
          Pedido #{String(data.order_id)}
        </div>
      ) : null}
      {data.message ? (
        <div style={{ fontSize: "13px", color: "var(--mut)", marginTop: "8px", lineHeight: 1.4 }}>
          {String(data.message)}
        </div>
      ) : null}
    </div>
  );
}

function CrossSellBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const products = (data.products as Array<{ name: string; price?: number }>) ?? [];
  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>Você também pode gostar:</div>
      {products.map((p, i) => (
        <button
          key={i}
          onClick={() => void sendMessage(`Adicionar ${p.name}`)}
          style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: "12px", marginBottom: "6px", textAlign: "left" }}
        >
          <span>{p.name}</span>
          {p.price != null && <span style={{ color: "var(--aacp-accent, #0f766e)", fontWeight: 600 }}>{formatPrice(p.price)}</span>}
        </button>
      ))}
    </div>
  );
}

function OfferCouponBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const code = (data.code as string) || "";
  const description = (data.description as string) || "";

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px", color: "var(--aacp-accent, #0f766e)" }}>Cupom disponivel</div>
      {description && <div style={{ fontSize: "12px", color: "var(--mut)", marginBottom: "6px" }}>{description}</div>}
      <button
        onClick={() => void sendMessage(`Aplicar cupom ${code}`)}
        style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
      >
        Aplicar {code}
      </button>
    </div>
  );
}

function AddressConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const formatted = (data.formatted as string) || "";

  const handleYes = () => {
    void sendMessage("Sim");
  };

  const handleNo = () => {
    void sendMessage("Não");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {formatted && (
        <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--chip)", fontSize: "13px", color: "var(--tx)" }}>
          {formatted}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleYes}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "8px",
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sim
        </button>
        <button
          onClick={handleNo}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Não
        </button>
      </div>
    </div>
  );
}

function FormFieldBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const [value, setValue] = useState("");
  if (!data) return null;
  const label = (data.label as string) || (data.field as string) || "";
  const placeholder = (data.placeholder as string) || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      void sendMessage(value.trim());
      setValue("");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {label && <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>{label}</label>}
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--bd)", background: "var(--chip)", color: "var(--tx)", fontSize: "13px", fontFamily: "inherit" }}
        />
        <button
          type="submit"
          disabled={!value.trim()}
          style={{ padding: "8px 12px", borderRadius: "8px", background: value.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: value.trim() ? "pointer" : "not-allowed" }}
        >
          Enviar
        </button>
      </div>
    </form>
  );
}

function CryptoPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const api = useCheckoutStore((s) => s.api);

  type CryptoStep = "idle" | "connected" | "sending" | "confirming" | "error";
  const [step, setStep] = useState<CryptoStep>("idle");
  const [wallet, setWallet] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Keep fallback polling active
  useEffect(() => { pollPayment(); }, [pollPayment]);

  if (!data) return null;

  const intentId = String(data.intent_id || "");
  const chainLabel = String(data.crypto_chain_label || "Polygon");
  const network = String(data.crypto_network || "testnet");
  const tokenSymbol = String(data.crypto_token_symbol || "USDC");
  const amountDisplay = String(data.crypto_amount_display || "?.?? USDC");
  const amountAtomic = String(data.crypto_amount_atomic || "0");
  const destination = String(data.crypto_destination_address || "");
  const tokenAddress = String(data.crypto_token_address || "");
  const chainId = Number(data.crypto_chain_id || 80002);

  const chainIdHex = "0x" + chainId.toString(16);

  // Encode ERC20 transfer(address,uint256) calldata manually
  function encodeTransferData(to: string, value: string): string {
    const selector = "0xa9059cbb";
    const addrPadded = to.toLowerCase().replace("0x", "").padStart(64, "0");
    const valHex = BigInt(value).toString(16).padStart(64, "0");
    return selector + addrPadded + valHex;
  }

  const handleConnect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      setError("no_metamask");
      return;
    }
    try {
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        setWallet(accounts[0]);
        setStep("connected");
        setError("");
      }
    } catch {
      setError("Conexão rejeitada");
    }
  };

  const switchOrAddChain = async (eth: any) => {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (switchErr: any) {
      // 4902 = chain not added
      if (switchErr?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainIdHex,
            chainName: `${chainLabel} ${network}`,
            nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
            rpcUrls: [`https://rpc-amoy.polygon.technology`],
            blockExplorerUrls: [`https://amoy.polygonscan.com`],
          }],
        });
      } else {
        throw switchErr;
      }
    }
  };

  const handlePay = async () => {
    const eth = (window as any).ethereum;
    if (!eth || !wallet) return;
    setStep("sending");
    setError("");
    try {
      // Ensure correct chain
      const currentChainId: string = await eth.request({ method: "eth_chainId" });
      if (currentChainId.toLowerCase() !== chainIdHex.toLowerCase()) {
        await switchOrAddChain(eth);
      }

      const calldata = encodeTransferData(destination, amountAtomic);
      const txHash: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: tokenAddress,
          data: calldata,
        }],
      });

      // tx sent — confirm on backend
      setStep("confirming");
      if (api) {
        await fetch(`${api.apiBaseUrl}/embed/payment/intents/${intentId}/crypto/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.authToken}` },
          body: JSON.stringify({ session_id: api.currentSessionId, tx_hash: txHash, wallet_address: wallet }),
        });
      }
      pollPayment();
    } catch (e: any) {
      if (e?.code === 4001) {
        setError("Transação cancelada");
        setStep("connected");
      } else {
        setError(e?.message || "Erro ao enviar transação");
        setStep("connected");
      }
    }
  };

  const btnBase: React.CSSProperties = {
    padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)",
    color: "#fff", border: "none", fontSize: "13px", fontWeight: 600,
    fontFamily: "var(--aacp-font, inherit)", cursor: "pointer", width: "100%",
  };

  // No MetaMask installed
  if (error === "no_metamask") {
    return (
      <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
        <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 8px" }}>Instale MetaMask para pagar com crypto</p>
        <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: "12px", color: "var(--aacp-accent, #0f766e)", textDecoration: "underline" }}>
          Baixar MetaMask
        </a>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
        Pague com {tokenSymbol} ({chainLabel} {network !== "mainnet" ? network : ""})
      </div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 10px", lineHeight: 1.4 }}>
        <strong>{amountDisplay}</strong>
      </p>

      {step === "idle" && (
        <button onClick={handleConnect} style={btnBase}>Conectar carteira</button>
      )}

      {step === "connected" && (
        <>
          <div style={{ fontSize: "11px", color: "var(--mut)", marginBottom: "8px", wordBreak: "break-all" }}>
            Carteira: {wallet.slice(0, 6)}...{wallet.slice(-4)}
          </div>
          <button onClick={handlePay} style={btnBase}>Pagar {amountDisplay}</button>
        </>
      )}

      {step === "sending" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "8px 0" }}>
          <PulseAgentOrb placement="chatLoading" active />
          <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>Confirme no MetaMask...</p>
        </div>
      )}

      {step === "confirming" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "8px 0" }}>
          <PulseAgentOrb placement="chatLoading" active />
          <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>Transação enviada! Verificando on-chain...</p>
        </div>
      )}

      {error && error !== "no_metamask" && (
        <div style={{ padding: "6px 10px", borderRadius: "6px", background: "#fee", color: "#c92a2a", fontSize: "12px", marginTop: "8px" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function BlockRenderer({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "text":
    case "message":
      return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data?.content || block.text || "")}</p>;
    case "cart_summary":
      return <CartSummaryBlock data={block.data} />;
    case "address_confirmation":
      return <AddressConfirmationBlock data={block.data} />;
    case "shipping_options":
      return <ShippingOptionsBlock options={block.data?.options} />;
    case "payment_methods":
      return <PaymentMethodsBlock methods={block.data?.methods} />;
    case "pix_payment":
      return <PixPaymentBlock data={block.data} />;
    case "crypto_payment":
      return <CryptoPaymentBlock data={block.data} />;
    case "stripe_card":
      return <StripeCardBlock data={block.data} />;
    case "order_confirmation":
      return <OrderConfirmationBlock data={block.data} />;
    case "order_summary":
      return <CartSummaryBlock data={block.data} />;
    case "cross_sell":
      return <CrossSellBlock data={block.data} />;
    case "offer_coupon":
      return <OfferCouponBlock data={block.data} />;
    case "form_field":
      return <FormFieldBlock data={block.data} />;
    default:
      // Fallback: render text content if available
      if (block.text) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{block.text}</p>;
      if (block.data?.text || block.data?.content) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data.text || block.data.content)}</p>;
      return null;
  }
}

/* ─── Main ChatPanel Component ─── */

export function ChatPanel() {
  const messages = useCheckoutStore((s) => s.messages);
  const isTyping = useCheckoutStore((s) => s.isTyping);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    void sendMessage(input.trim());
    setInput("");
  };

  const handleQuickReply = (text: string) => {
    void sendMessage(text);
  };

  // Find quick replies from the last agent message
  const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
  const activeQuickReplies = lastAgentMsg?.quickReplies ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Messages area */}
      <div
        style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}
        role="log"
        aria-label="Mensagens do chat"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              width: "100%",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            {msg.role === "agent" && (
              <AgentAvatar active />
            )}

            <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
              {msg.text && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    background: msg.role === "user" ? "var(--aacp-accent, #0f766e)" : "var(--card)",
                    color: msg.role === "user" ? "#fff" : "var(--tx)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    wordBreak: "break-word",
                    border: msg.role === "agent" ? "1px solid var(--bd)" : "none",
                  }}
                >
                  {msg.text}
                </div>
              )}
              {msg.blocks?.map((block, j) => (
                <div key={j} style={{ padding: "10px 12px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--bd)" }}>
                  <BlockRenderer block={block} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Quick Replies — rendered below last agent message */}
        {activeQuickReplies.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "36px" }}>
            {activeQuickReplies.map((qr) => (
              <button
                key={qr}
                onClick={() => handleQuickReply(qr)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "20px",
                  border: "1px solid var(--bd)",
                  background: "var(--chip)",
                  color: "var(--tx)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-accent, #0f766e)";
                  e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent, #0f766e) 10%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--bd)";
                  e.currentTarget.style.background = "var(--chip)";
                }}
              >
                {qr}
              </button>
            ))}
          </div>
        )}

        {isTyping && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <AgentAvatar active />
            <div style={{ padding: "10px 12px", borderRadius: "12px", background: "var(--card)", color: "var(--mut)", border: "1px solid var(--bd)" }}>
              <span style={{ animation: "dot-pulse 1.2s infinite" }}>●</span>
              <span style={{ animation: "dot-pulse 1.2s infinite", animationDelay: "0.2s" }}>●</span>
              <span style={{ animation: "dot-pulse 1.2s infinite", animationDelay: "0.4s" }}>●</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          padding: "10px 0 0",
          borderTop: "1px solid var(--bd)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem..."
          aria-label="Mensagem"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            fontSize: "13px",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Enviar mensagem"
          style={{
            padding: "10px 16px",
            borderRadius: "10px",
            background: input.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)",
            color: "#fff",
            border: "none",
            fontSize: "12px",
            fontWeight: 600,
            cursor: input.trim() ? "pointer" : "not-allowed",
            flex: "none",
          }}
        >
          Enviar
        </button>
      </form>

      <style>{`
        @keyframes bubble-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dot-pulse { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }
        @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
      `}</style>
    </div>
  );
}
