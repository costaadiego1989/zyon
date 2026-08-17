import React from "react";
import { Wallet, Check } from "lucide-react";
import type { CryptoWalletState } from "../usePaymentConnectionsPage.js";

interface WalletSectionProps {
  crypto: CryptoWalletState;
  setCrypto: React.Dispatch<React.SetStateAction<CryptoWalletState>>;
  tokenAddress: string;
  saveCryptoWallet: () => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`wallet-toggle${checked ? " on" : ""}`}
    >
      <span className="wallet-toggle__thumb" />
    </button>
  );
}

export function WalletSection({ crypto, setCrypto, tokenAddress, saveCryptoWallet }: WalletSectionProps) {
  const { config, saving, saved } = crypto;

  function updateConfig(partial: Partial<typeof config>) {
    setCrypto((prev) => ({ ...prev, config: { ...prev.config, ...partial } }));
  }

  return (
    <div className="wallet-section">
      <div className="wallet-section__header">
        <div className="wallet-section__title-group">
          <div className="wallet-section__icon">
            <Wallet size={16} />
          </div>
          <div>
            <h3 className="wallet-section__title">Carteira Crypto</h3>
            <p className="wallet-section__subtitle">Receba USDC direto na sua wallet</p>
          </div>
        </div>
        <Toggle checked={config.enabled} onChange={(v) => updateConfig({ enabled: v })} />
      </div>

      {config.enabled && (
        <div className="wallet-section__body">
          <div className="wallet-section__grid">
            <div className="wallet-section__form-group">
              <label className="wallet-section__label">Rede</label>
              <select
                value={config.chain}
                onChange={(e) => updateConfig({ chain: e.target.value as "polygon" | "base" })}
                className="wallet-section__select"
              >
                <option value="polygon">Polygon</option>
                <option value="base">Base</option>
              </select>
            </div>
            <div className="wallet-section__form-group" style={{ gridColumn: "span 2" }}>
              <label className="wallet-section__label">Endereço da Wallet</label>
              <input
                type="text"
                value={config.treasuryAddress}
                onChange={(e) => updateConfig({ treasuryAddress: e.target.value })}
                placeholder="0x..."
                className="wallet-section__input"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="wallet-section__footer">
            <span className="wallet-section__token-info">
              USDC · {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-4)}
            </span>
            <div className="wallet-section__actions">
              {saved && (
                <span className="wallet-section__saved-text">
                  <Check size={12} /> Salvo
                </span>
              )}
              <button
                type="button"
                disabled={!config.treasuryAddress.trim() || saving}
                onClick={() => void saveCryptoWallet()}
                className="wallet-section__save-btn"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
