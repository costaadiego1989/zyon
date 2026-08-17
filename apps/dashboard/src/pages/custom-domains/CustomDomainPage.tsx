import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
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

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div>
            <span className="eyebrow">LOJA</span>
            <h1 style={{ marginBottom: 4 }}>Domínio</h1>
          </div>
          {state.domains.some((d) => !d.verified) && (
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e", padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>
              {state.domains.filter((d) => !d.verified).length} pendente{state.domains.filter((d) => !d.verified).length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <p className="page-lead">Configure um domínio personalizado para sua loja (ex: athom.com.br)</p>
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "24px 22px" }}>
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
            <h3 style={{ font: "600 13px var(--sans)", letterSpacing: "0.08em", marginBottom: 12, color: "var(--muted)", textTransform: "uppercase" }}>Adicionar domínio</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
              <FormField
                label="Domínio"
                placeholder="athom.com.br ou www.athom.com.br"
                value={state.newDomain}
                onChange={setNewDomain}
                disabled={state.adding}
              />
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
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
            </div>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
              Suporte para CNAME (recomendado) e ANAME. Apex domains funcionam com ANAME no seu provedor.
            </p>
          </div>

          {state.domains.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)", fontSize: 13 }}>
              <div style={{ marginBottom: 12, fontSize: 28 }}>🌐</div>
              <p style={{ margin: 0, fontWeight: 500 }}>Nenhum domínio configurado</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>Adicione seu domínio customizado acima para começar</p>
            </div>
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
                              : "Aguardando verificação DNS"}
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
                          <p style={{ color: "var(--muted)", margin: "0 0 12px", fontWeight: 500 }}>Próximas etapas:</p>
                          <ol style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", lineHeight: 1.8 }}>
                            <li><strong>Configure no seu provedor DNS:</strong></li>
                          </ol>
                          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, margin: "12px 0", fontSize: 11, fontFamily: "monospace" }}>
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
                            <li style={{ marginTop: 4 }}>Aguarde propagação DNS (normalmente 1-15 minutos)</li>
                            <li style={{ marginTop: 4 }}>Volte aqui e clique "Verificar"</li>
                            <li style={{ marginTop: 4 }}>SSL será ativado automaticamente após verificação</li>
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

      <div style={{ marginTop: 28, padding: 16, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7 }}>
        <p style={{ margin: "0 0 8px" }}>
          <strong>💡 Como funciona:</strong>
        </p>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Ao configurar o CNAME, sua loja fica acessível em <code style={{ background: "var(--card)", padding: "2px 4px", borderRadius: 2, color: "var(--accent)", fontFamily: "monospace", fontSize: 11 }}>athom.com.br</code>.
          SSL é provisionado automaticamente (Let's Encrypt), sem penalidade SEO. Google indexará seu domínio customizado normalmente.
        </p>
      </div>
    </div>
  );
}
