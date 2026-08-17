import React from "react";
import type { CryptoWalletState } from "../usePaymentConnectionsPage.js";

interface WalletSectionProps {
  crypto: CryptoWalletState;
  setCrypto: React.Dispatch<React.SetStateAction<CryptoWalletState>>;
  tokenAddress: string;
  saveCryptoWallet: () => void;
}

export function WalletSection({
  crypto,
  setCrypto,
  tokenAddress,
  saveCryptoWallet,
}: WalletSectionProps) {
  const { config, saving, saved } = crypto;

  function updateConfig(partial: Partial<typeof config>) {
    setCrypto((prev) => ({
      ...prev,
      config: { ...prev.config, ...partial },
    }));
  }

  return (
    <div className="wallet-section">
      <div className="wallet-section__header">
        <div className="wallet-section__icon">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="#627EEA"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v12M6 12h12" />
          </svg>
        </div>
        <div>
          <h3 className="wallet-section__title">Carteira Crypto (USDC)</h3>
          <p className="wallet-section__subtitle">
            Receba pagamentos em USDC diretamente na sua wallet
          </p>
        </div>
      </div>
      <div className="wallet-section__grid">
        <label className="wallet-section__checkbox-label">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
          />
          Habilitar crypto
        </label>
        <div className="wallet-section__form-group">
          <label className="wallet-section__label">Chain</label>
          <select
            value={config.chain}
            onChange={(e) => updateConfig({ chain: e.target.value === "base" ? "base" : "polygon" })}
            className="wallet-section__select"
          >
            <option value="polygon">Polygon</option>
            <option value="base">Base</option>
          </select>
        </div>
        <div className="wallet-section__form-group">
          <label className="wallet-section__label">Network</label>
          <select
            value={config.network}
            onChange={(e) =>
              updateConfig({ network: e.target.value === "mainnet" ? "mainnet" : "testnet" })
            }
            className="wallet-section__select"
          >
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </div>
        <div className="wallet-section__form-group">
          <label className="wallet-section__label">Treasury Address</label>
          <input
            type="text"
            value={config.treasuryAddress}
            onChange={(e) => updateConfig({ treasuryAddress: e.target.value })}
            placeholder="0x1234...abcd"
            className="wallet-section__input"
          />
        </div>
        <div className="wallet-section__form-group">
          <label className="wallet-section__label">Token</label>
          <input
            type="text"
            value={`USDC · ${tokenAddress}`}
            readOnly
            className="wallet-section__input"
          />
        </div>
      </div>
      <div className="wallet-section__actions">
        <button
          type="button"
          disabled={(config.enabled && !config.treasuryAddress.trim()) || saving}
          onClick={() => void saveCryptoWallet()}
          className="wallet-section__save-btn"
        >
          {saving ? "Salvando..." : "Salvar wallet"}
        </button>
        {saved ? <span className="wallet-section__saved-text">✓ Wallet salva</span> : null}
      </div>
    </div>
  );
}
