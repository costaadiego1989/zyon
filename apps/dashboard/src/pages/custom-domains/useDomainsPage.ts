import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/index.js";
import { showToast } from "../../components/Toast.js";
import type { DomainEntry, RegisterDomainOutput, VerifyDomainOutput } from "../../api/endpoints/merchants.js";

export interface DomainsPageState {
  domains: DomainEntry[];
  loading: boolean;
  adding: boolean;
  verifying: string | null;
  newDomain: string;
  error: string | null;
}

export function useDomainsPage() {
  const api = useApi();
  const [state, setState] = useState<DomainsPageState>({
    domains: [],
    loading: true,
    adding: false,
    verifying: null,
    newDomain: "",
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const domains = await api.listDomains();
        if (cancelled) return;
        setState((p) => ({ ...p, domains, loading: false }));
      } catch {
        if (!cancelled) setState((p) => ({ ...p, domains: [], loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function addDomain() {
    const domain = state.newDomain.trim().toLowerCase();
    if (!domain) {
      showToast("error", "Digite um domínio válido");
      return;
    }

    setState((p) => ({ ...p, adding: true, error: null }));
    try {
      const result = await api.addDomain(domain);
      setState((p) => ({
        ...p,
        domains: [...p.domains, {
          id: result.domain_id,
          domain: result.domain,
          verified: false,
          cname_target: result.cname_target,
        }],
        newDomain: "",
        adding: false,
      }));
      showToast("success", `Domínio adicionado. Configure o CNAME para: ${result.cname_target}`);
    } catch (e) {
      const raw = e instanceof DashboardHttpError ? e.responseBody : e instanceof Error ? e.message : "Erro desconhecido";
      const msg = raw.includes("merchant_not_found") ? "Erro de autenticação. Recarregue a página."
        : raw.includes("domain_already_registered") ? "Domínio já registrado por outra loja."
        : raw.includes("invalid_domain") ? "Formato de domínio inválido. Ex: meusite.com.br"
        : "Erro ao adicionar domínio. Tente novamente.";
      setState((p) => ({ ...p, adding: false, error: null }));
      showToast("error", msg);
    }
  }

  async function verifyDomain(domainId: string) {
    setState((p) => ({ ...p, verifying: domainId, error: null }));
    try {
      const result = await api.verifyDomain(domainId);
      setState((p) => ({
        ...p,
        domains: p.domains.map((d) =>
          d.id === domainId
            ? { ...d, verified: result.verified, verified_at: result.verified_at }
            : d
        ),
        verifying: null,
      }));
      if (result.verified) {
        showToast("success", `${result.domain} verificado com sucesso`);
      } else {
        showToast("error", `CNAME não encontrado para ${result.domain}. Verifique sua configuração DNS.`);
      }
    } catch (e) {
      const msg = e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : "Erro ao verificar domínio";
      setState((p) => ({ ...p, verifying: null, error: msg }));
      showToast("error", msg);
    }
  }

  async function removeDomain(domainId: string) {
    if (!window.confirm("Tem certeza que deseja remover este domínio? Isso não pode ser desfeito.")) {
      return;
    }

    setState((p) => ({ ...p, error: null }));
    try {
      await api.removeDomain(domainId);
      setState((p) => ({
        ...p,
        domains: p.domains.filter((d) => d.id !== domainId),
      }));
      showToast("success", "Domínio removido");
    } catch (e) {
      const msg = e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : "Erro ao remover domínio";
      setState((p) => ({ ...p, error: msg }));
      showToast("error", msg);
    }
  }

  return {
    state,
    setNewDomain: (domain: string) => setState((p) => ({ ...p, newDomain: domain })),
    addDomain,
    verifyDomain,
    removeDomain,
    dismiss: () => setState((p) => ({ ...p, error: null })),
  };
}
