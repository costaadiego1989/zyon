import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProspectStage, ProspectingBlocker } from "@zyon/shared-types";
import { PlatformApiError } from "../../lib/api.js";
import { ProspectCommandRecorded, ProspectCommandUnresolved, type ProspectingApi } from "../../lib/prospecting-api.js";
import { ProspectingState, type ProspectRoute } from "./ProspectingShell.js";

export const blockers: Record<ProspectingBlocker, string> = {
  no_opt_in: "Sem opt-in do destinatário",
  provider_policy_blocked: "Envio impedido pela política do provedor",
  sender_unavailable: "Remetente indisponível",
  sender_identity_mismatch: "Vínculo do remetente alterado",
  permission_unavailable: "Permissão do canal indisponível",
  quality_restricted: "Qualidade do canal restrita",
  template_unavailable: "Template indisponível",
  template_binding_mismatch: "Template incompatível com o remetente",
  portfolio_limit: "Limite do portfólio atingido",
  cost_unknown: "Custo desconhecido",
  suppressed: "Contato bloqueado",
  approval_stale: "Revisão desatualizada",
  limits_missing: "Limites obrigatórios ausentes",
  human_owned: "Atendimento humano",
  outside_send_window: "Fora da janela de envio",
};
export type PageProps = {
  api: ProspectingApi;
  operatorId: string;
  onSessionExpired: () => void;
  navigate: (route: ProspectRoute) => void;
};
export const stages: Record<ProspectStage, string> = {
  new: "Novo",
  contacted: "Contatado",
  responded: "Respondeu",
  qualified: "Qualificado",
  proposal: "Proposta",
  converted: "Convertido",
  lost: "Perdido",
  do_not_contact: "Não contatar",
};
export const dateTime = (value?: string | null) => (value ? new Date(value).toLocaleString("pt-BR") : "Sem registro");
export function money(cents: string | number, currency = "BRL") {
  const raw = BigInt(cents);
  const abs = raw < 0n ? -raw : raw;
  return (
    (raw < 0n ? "−" : "") +
    (currency === "BRL" ? "R$" : currency) +
    " " +
    (abs / 100n).toLocaleString("pt-BR") +
    "," +
    (abs % 100n).toString().padStart(2, "0")
  );
}
export function cents(value: string) {
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(value.trim());
  if (!match) throw Error("Informe o valor com até duas casas decimais.");
  return BigInt(match[1] + (match[2] ?? "").padEnd(2, "0")).toString();
}
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, expired: () => void) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; version: number; data?: T; error?: unknown }>();
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setResult({ load, version, data });
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        if (error instanceof PlatformApiError && error.status === 401) expired();
        setResult({ load, version, error });
      });
    return () => abort.abort();
  }, [load, version, expired]);
  const current = result?.load === load && result.version === version ? result : undefined;
  return { data: current?.data, error: current?.error, reload: useCallback(() => setVersion((v) => v + 1), []) };
}
export function ReadState({ error, reload }: { error?: unknown; reload: () => void }) {
  if (!error) return <ProspectingState state="loading" />;
  if (error instanceof PlatformApiError && [401, 403].includes(error.status))
    return <ProspectingState state="forbidden" />;
  return <ProspectingState state="error" retry={reload} />;
}
export function Button({
  children,
  onClick,
  disabled = false,
  primary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={primary ? "button button--primary" : "button button--secondary"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function useAction({ api, operatorId, onSessionExpired }: PageProps, scope: string, refresh: () => void) {
  const storage = "zyon.prospect.action." + operatorId + "." + scope;
  const [pending, setPending] = useState(() => sessionStorage.getItem(storage)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [denied, setDenied] = useState(false);
  const lock = useRef(false);
  function remember(id: string | null) {
    if (id) sessionStorage.setItem(storage, id);
    else sessionStorage.removeItem(storage);
    setPending(id);
  }
  function failure(e: unknown) {
    if (e instanceof PlatformApiError && [401, 403].includes(e.status)) {
      setDenied(true);
      if (e.status === 401) onSessionExpired();
      return;
    }
    const reason = e instanceof PlatformApiError ? e.code ?? e.message : "";
    if (Object.hasOwn(blockers, reason)) {
      setMessage(blockers[reason as ProspectingBlocker]);
      return;
    }
    setMessage(
      e instanceof PlatformApiError && e.status === 409
        ? "A revisão mudou ou a ação foi impedida. Atualize os dados. " + (e.code ?? "")
        : "Não foi possível concluir a operação." + (e instanceof PlatformApiError && e.code ? " " + e.code : "")
    );
  }
  async function run(work: (id: string) => Promise<string>) {
    if (lock.current || pending || denied) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const id = crypto.randomUUID();
    remember(id);
    try {
      const text = await work(id);
      remember(null);
      setMessage(text);
    } catch (e) {
      if (e instanceof ProspectCommandRecorded) {
        remember(null);
        setMessage("Comando confirmado pelo servidor.");
        refresh();
      } else if (e instanceof ProspectCommandUnresolved) setMessage("A confirmação ainda está pendente.");
      else {
        remember(null);
        failure(e);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function recover() {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const receipt = await api.command(pending);
      if (receipt.clientRequestId !== pending || !["completed", "failed"].includes(receipt.state)) {
        setMessage("Resultado ainda desconhecido.");
        return;
      }
      remember(null);
      setMessage(
        receipt.state === "completed" ? "Comando confirmado pelo servidor." : "O servidor registrou uma falha."
      );
      refresh();
    } catch (e) {
      failure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    run,
    disabled: busy || Boolean(pending) || denied,
    denied,
    feedback: (
      <>
        {message && <p role="status">{message}</p>}
        {pending && !busy && <Button onClick={recover}>Consultar resultado do comando</Button>}
        {denied && <ProspectingState state="forbidden" />}
      </>
    ),
  };
}
