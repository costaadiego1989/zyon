import { useState } from "react";
import { Wallet, Loader2 } from "lucide-react";
import type { CryptoPaymentPanelModel } from "../../presentation/models/crypto-payment-panel.model.js";
import { useCryptoWallet } from "../../hooks/use-crypto-wallet.js";

function truncateAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function CryptoPaymentPanel({ model }: { model: CryptoPaymentPanelModel }) {
  const wallet = useCryptoWallet();
  const [paying, setPaying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const quote = model.quote;

  async function handlePay() {
    if (model.expired || paying) return;
    setPaying(true);
    setStatus(null);
    try {
      const account = wallet.address ?? (await wallet.connectMetaMask());
      setStatus("Enviando USDC...");
      const txHash = await wallet.sendUsdcTransfer(quote, account);
      setStatus("Confirmando na blockchain...");
      await model.onConfirmPayment(model.intentId, txHash, account);
      model.onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Não foi possível concluir o pagamento crypto.";
      wallet.setError(message);
      setStatus(null);
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="aacp-crypto-panel" role="region" aria-label="Pagamento com crypto">
      <div className="aacp-crypto-panel-head">
        <Wallet size={18} aria-hidden />
        <div>
          <strong>Pagar com USDC</strong>
          <small>
            Rede {quote.chainLabel}
            {quote.evmNetwork === "testnet" ? " (testnet)" : ""}
          </small>
        </div>
      </div>

      <dl className="aacp-crypto-quote">
        {model.orderTotalLabel ? (
          <>
            <dt>Total do pedido</dt>
            <dd>{model.orderTotalLabel}</dd>
          </>
        ) : null}
        <dt>Valor em crypto</dt>
        <dd>{quote.amountDisplay}</dd>
        <dt>Destino</dt>
        <dd className="aacp-crypto-mono">{truncateAddress(quote.destinationAddress)}</dd>
        <dt>Cotação válida até</dt>
        <dd>{new Date(quote.quoteExpiresAt).toLocaleTimeString("pt-BR")}</dd>
      </dl>

      {model.expired ? (
        <p className="aacp-crypto-error" role="alert">
          Cotação expirada. Escolha pagar com crypto novamente para gerar um novo valor.
        </p>
      ) : null}

      {wallet.error ? (
        <p className="aacp-crypto-error" role="alert">
          {wallet.error}
        </p>
      ) : null}

      {wallet.address ? (
        <p className="aacp-crypto-wallet">
          Carteira conectada:{" "}
          <span className="aacp-crypto-mono">{truncateAddress(wallet.address)}</span>
        </p>
      ) : null}

      <div className="aacp-crypto-actions">
        {!wallet.address ? (
          <>
            <button
              type="button"
              className="aacp-chip aacp-crypto-btn"
              disabled={wallet.connecting || model.expired}
              onClick={() => void wallet.connectMetaMask()}
            >
              {wallet.connecting ? <Loader2 size={16} className="aacp-spin" /> : null}
              Conectar MetaMask
            </button>
            <button
              type="button"
              className="aacp-chip aacp-crypto-btn aacp-crypto-btn--ghost"
              disabled={wallet.connecting || model.expired}
              onClick={() => void wallet.connectMetaMask()}
            >
              Conectar Trust Wallet
            </button>
          </>
        ) : (
          <button
            type="button"
            className="aacp-cta aacp-crypto-pay"
            disabled={paying || model.expired}
            onClick={() => void handlePay()}
          >
            {paying ? <Loader2 size={16} className="aacp-spin" /> : null}
            Pagar agora
          </button>
        )}
      </div>

      {status ? <p className="aacp-crypto-status">{status}</p> : null}

      <p className="aacp-crypto-footnote">
        Envie exatamente {quote.amountDisplay} na rede {quote.chainLabel}. Nunca compartilhe sua
        seed phrase.
      </p>
    </div>
  );
}
