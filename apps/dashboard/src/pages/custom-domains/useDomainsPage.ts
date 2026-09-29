import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { DomainEntry } from "../../api/endpoints/merchants.js";
import { domainErrorMessage } from "./domain-errors.js";

export interface DomainsPageState {
  domains: DomainEntry[];
  loading: boolean;
  adding: boolean;
  verifying: string | null;
  removing: string | null;
  newDomain: string;
  error: string | null;
  loadFailed: boolean;
}

export function useDomainsPage() {
  const api = useApi();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const mutating = useRef(false);
  const [state, setState] = useState<DomainsPageState>({
    domains: [],
    loading: true,
    adding: false,
    verifying: null,
    removing: null,
    newDomain: "",
    error: null,
    loadFailed: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState(p => ({ ...p, loading: true, error: null, loadFailed: false }));
    (async () => {
      try {
        const domains = await api.listDomains();
        if (cancelled) return;
        setState((p) => ({ ...p, domains, loading: false }));
      } catch (error) {
        if (!cancelled) setState((p) => ({ ...p, loading: false, loadFailed: true, error: domainErrorMessage(error, "load") }));
      }
    })();
    return () => { cancelled = true; };
  }, [api, loadAttempt]);

  async function addDomain() {
    if (mutating.current || state.loading || state.loadFailed) return;
    const domain = state.newDomain.trim().toLowerCase();
    if (!domain) {
      showToast("error", "Digite um domínio válido");
      return;
    }

    mutating.current = true;
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
          txt_name: result.txt_name,
          txt_value: result.txt_value,
        }],
        newDomain: "",
        adding: false,
      }));
      showToast("success", `Domínio adicionado. Configure os registros CNAME e TXT indicados.`);
    } catch (e) {
      const msg = domainErrorMessage(e, "add");
      setState((p) => ({ ...p, adding: false, error: msg }));
      showToast("error", msg);
    } finally { mutating.current = false; }
  }

  async function verifyDomain(domainId: string) {
    if (mutating.current || state.loading || state.loadFailed) return;
    mutating.current = true;
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
        const message = `Ainda não confirmamos os registros CNAME e TXT de ${result.domain}. Confira os dois no provedor e tente verificar novamente.`;
        setState(p => ({ ...p, error: message }));
        showToast("error", message);
      }
    } catch (e) {
      const msg = domainErrorMessage(e, "verify");
      setState((p) => ({ ...p, verifying: null, error: msg }));
      showToast("error", msg);
    } finally { mutating.current = false; }
  }

  async function removeDomain(domainId: string) {
    if (mutating.current || state.loading || state.loadFailed) return false;
    mutating.current = true;
    setState((p) => ({ ...p, error: null, removing: domainId }));
    try {
      await api.removeDomain(domainId);
      setState((p) => ({
        ...p,
        domains: p.domains.filter((d) => d.id !== domainId),
      }));
      showToast("success", "Domínio removido");
      return true;
    } catch (e) {
      const msg = domainErrorMessage(e, "remove");
      setState((p) => ({ ...p, error: msg }));
      showToast("error", msg);
      return false;
    } finally { mutating.current = false; setState(p => ({ ...p, removing: null })); }
  }

  return {
    state,
    reload: () => setLoadAttempt(value => value + 1),
    setNewDomain: (domain: string) => setState((p) => ({ ...p, newDomain: domain })),
    addDomain,
    verifyDomain,
    removeDomain,
    dismiss: () => setState((p) => ({ ...p, error: null })),
  };
}
