import React, { useState } from "react";
import { Copy, Check, Globe, Settings, Shield, CheckCircle2 } from "lucide-react";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useDomainsPage } from "./useDomainsPage.js";
import { showToast } from "../../components/Toast.js";

export function CustomDomainPage() {
  const vm = useDomainsPage();
  const { state, setNewDomain, addDomain, verifyDomain, removeDomain } = vm;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Carregando domínios...</div>;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast("success", "Copiado!");
  };

  const pendingCount = state.domains.filter((d) => !d.verified).length;

  return (
    <div>
      <SectionHeader
        title="Domínio personalizado"
        subtitle="Use seu próprio endereço (ex: sua-loja.com.br) para a sua loja"
        trailing={
          pendingCount > 0 ? (
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e", padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>
              {pendingCount} pendente{pendingCount !== 1 ? "s" : ""}
            </div>
          ) : null
        }
      />

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "20px 22px" }}>
          {state.error && (
            <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: 12, marginBottom: 16, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#dc2626", flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <strong style={{ color: "#dc2626", fontSize: 13 }}>Erro</strong>
                <p style={{ fontSize: 12, color: "#991b1b", margin: "4px 0 0" }}>{state.error}</p>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <h3 style={{ font: "600 11px var(--mono)", letterSpacing: "0.06em", marginBottom: 14, color: "var(--faint)", textTransform: "uppercase" }}>Adicionar domínio</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="text"
                placeholder="sua-loja.com.br ou www.sua-loja.com.br"
                value={state.newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                disabled={state.adding}
                style={{ flex: 1, height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={addDomain}
                disabled={state.adding || !state.newDomain.trim()}
                loading={state.adding}
              >
                {state.adding ? "Adicionando..." : "Adicionar"}
              </Button>
            </div>
            <p style={{ fontSize: 11, color: "var(--faint)", margin: "10px 0 0" }}>
              Você pode usar o domínio principal (sua-loja.com.br) ou um subdomínio como loja.sua-loja.com.br.
            </p>
          </div>

          {state.domains.length === 0 ? (
            <EmptyState
              icon={Globe}
              title="Nenhum domínio configurado"
              description="Adicione seu domínio acima e siga o passo a passo para ativar sua loja em um endereço próprio."
            />
          ) : (
            <div>
              <h3 style={{ font: "600 13px var(--sans)", letterSpacing: "0.08em", marginBottom: 12, color: "var(--muted)", textTransform: "uppercase" }}>Domínios registrados</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {state.domains.map((domain) => {
                  const isVerifying = state.verifying === domain.id;
                  const verified = domain.verified;

                  return (
                    <div key={domain.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: verified ? "rgba(78, 205, 196, 0.02)" : "transparent" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <strong style={{ fontSize: 13, color: "var(--ink)", fontFamily: "monospace" }}>{domain.domain}</strong>
                            {verified && (
                              <>
                                <span style={{ fontSize: 10, background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: 3, fontWeight: 600 }}>✓ Verificado</span>
                                <span style={{ fontSize: 10, background: "#cffafe", color: "#0c4a6e", padding: "2px 6px", borderRadius: 3, fontWeight: 600 }}>⚡ SSL Ativo</span>
                              </>
                            )}
                          </div>
                          <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                            {domain.verified_at
                              ? `Verificado em ${new Date(domain.verified_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`
                              : "Aguardando configuração no seu provedor"}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          {!verified && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => verifyDomain(domain.id)}
                              disabled={isVerifying}
                              loading={isVerifying}
                            >
                              {isVerifying ? "Verificando..." : "Verificar"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeDomain(domain.id)}
                          >
                            Remover
                          </Button>
                        </div>
                      </div>

                      {!verified && (
                        <div style={{ background: "var(--bg)", borderRadius: 6, padding: 12, fontSize: 12, marginTop: 12 }}>
                          <p style={{ color: "var(--muted)", margin: "0 0 12px", fontWeight: 500 }}>Configure no seu provedor de domínio:</p>
                          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, margin: "0 0 12px", fontSize: 11, fontFamily: "monospace" }}>
                            <div><strong>Tipo:</strong> CNAME</div>
                            <div><strong>Nome:</strong> {domain.domain}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                              <strong>Valor:</strong>
                              <code style={{ flex: 1, color: "var(--accent)" }}>{domain.cname_target}</code>
                              <button
                                onClick={() => copyToClipboard(domain.cname_target, domain.id)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                  padding: 2,
                                  display: "flex",
                                  alignItems: "center",
                                  color: copiedId === domain.id ? "var(--accent)" : "var(--muted)",
                                  transition: "color 0.2s",
                                  fontSize: 12,
                                }}
                                title="Copiar"
                              >
                                {copiedId === domain.id ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                            </div>
                          </div>
                          <ol style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", lineHeight: 1.8 }}>
                            <li>Aguarde alguns minutos para a alteração propagar</li>
                            <li>Volte aqui e clique "Verificar"</li>
                            <li>O certificado de segurança (SSL) é ativado automaticamente</li>
                          </ol>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <SectionHeader
        title="Como funciona"
        subtitle="Em poucos minutos sua loja fica no seu domínio"
        variant="secondary"
      />

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 24 }}>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 16 }}>
          <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft, rgba(15,118,110,0.08))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Globe size={18} style={{ color: "var(--accent, #0f766e)" }} />
            </div>
            <div>
              <strong style={{ fontSize: 13, color: "var(--ink)", display: "block", marginBottom: 2 }}>1. Adicione seu domínio</strong>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
                Digite o endereço que você quer usar. Pode ser o principal (sua-loja.com.br) ou um subdomínio (loja.sua-loja.com.br).
              </p>
            </div>
          </li>
          <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft, rgba(15,118,110,0.08))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Settings size={18} style={{ color: "var(--accent, #0f766e)" }} />
            </div>
            <div>
              <strong style={{ fontSize: 13, color: "var(--ink)", display: "block", marginBottom: 2 }}>2. Configure no seu provedor de domínio</strong>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
                Copie o endereço que mostramos e adicione como um registro CNAME no local onde você comprou o domínio (Registro.br, GoDaddy, Cloudflare, etc.).
              </p>
            </div>
          </li>
          <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft, rgba(15,118,110,0.08))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Shield size={18} style={{ color: "var(--accent, #0f766e)" }} />
            </div>
            <div>
              <strong style={{ fontSize: 13, color: "var(--ink)", display: "block", marginBottom: 2 }}>3. Certificado de segurança (SSL)</strong>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
                Depois da verificação, ativamos o SSL automaticamente. Sua loja passa a usar o cadeado de segurança (https).
              </p>
            </div>
          </li>
          <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft, rgba(15,118,110,0.08))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <CheckCircle2 size={18} style={{ color: "var(--accent, #0f766e)" }} />
            </div>
            <div>
              <strong style={{ fontSize: 13, color: "var(--ink)", display: "block", marginBottom: 2 }}>4. Sua loja no ar!</strong>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
                Pronto. Seu domínio já leva os clientes até sua loja, com segurança e sem perder posicionamento no Google.
              </p>
            </div>
          </li>
        </ol>
      </div>

      <div style={{ padding: 14, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.6 }}>
        <p style={{ margin: "0 0 6px", color: "var(--ink)", fontWeight: 500 }}>Posso usar um subdomínio?</p>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Sim! Você pode adicionar quantos subdomínios quiser, por exemplo <code style={{ background: "var(--card)", padding: "1px 5px", borderRadius: 3, color: "var(--accent)", fontFamily: "monospace", fontSize: 11 }}>loja.seusite.com.br</code> ou <code style={{ background: "var(--card)", padding: "1px 5px", borderRadius: 3, color: "var(--accent)", fontFamily: "monospace", fontSize: 11 }}>www.seusite.com.br</code>. Cada um segue o mesmo passo a passo.
        </p>
      </div>
    </div>
  );
}