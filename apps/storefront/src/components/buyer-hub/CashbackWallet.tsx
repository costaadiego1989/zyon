"use client";

import { useEffect, useState } from "react";
import type { CashbackPage, CashbackTransaction, CashbackWalletView } from "@zyon/shared-types";
import { fetchCashbackTransactions, fetchCashbackWallet } from "../../lib/services/cashback.service";
import styles from "./CashbackWallet.module.css";
import { CashbackWhatsAppLink } from "./CashbackWhatsAppLink";

const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const date = (value: string) => Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Data indisponível";
const labels: Record<CashbackTransaction["type"], string> = {
  grant: "Crédito da compra", release: "Crédito liberado", reserve: "Reservado no checkout", unreserve: "Reserva liberada",
  redeem: "Cashback utilizado", expire: "Crédito expirado", reverse: "Crédito estornado", restore: "Crédito restituído",
  adjustment: "Ajuste de saldo", loss: "Ajuste da loja",
};

export function CashbackWallet({ merchantId }: { merchantId?: string }) {
  const [wallet, setWallet] = useState<CashbackWalletView | null>(null);
  const [transactions, setTransactions] = useState<CashbackPage<CashbackTransaction> | null>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => { setPage(1); }, [merchantId]);
  useEffect(() => {
    if (!merchantId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(false);
    void Promise.all([fetchCashbackWallet(merchantId, controller.signal), fetchCashbackTransactions(merchantId, page, controller.signal)])
      .then(([nextWallet, nextTransactions]) => {
        if (controller.signal.aborted) return;
        if (nextTransactions.items.some(row => row.merchantId !== merchantId || row.buyerId !== nextWallet.buyerId)) throw new Error("cashback_transaction_scope_mismatch");
        setWallet(nextWallet); setTransactions(nextTransactions);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [merchantId, page, attempt]);

  const currentWallet = wallet?.merchantId === merchantId ? wallet : null;
  return <section className={styles.wallet} aria-label="Seu cashback nesta loja">
    <header className={styles.heading}><div><h2>Seu cashback</h2><p>Crédito para comprar novamente nesta loja, pelo site ou WhatsApp.</p></div>
      {merchantId && <button type="button" data-neu="secondary" className={styles.button} disabled={loading} onClick={() => setAttempt(value => value + 1)}>Atualizar saldo</button>}
    </header>
    <div aria-busy={loading}>
    {!merchantId ? <p>Abra sua conta dentro de uma loja para consultar o cashback dela.</p>
      : loading && !currentWallet ? <div className={styles.loading} role="status" aria-label="Carregando cashback"><div /><div /><span>Consultando seu saldo e extrato…</span></div>
      : error ? <div role="alert"><p>Não foi possível consultar seu cashback. Seu saldo não foi alterado.</p><button data-neu="secondary" type="button" className={styles.button} onClick={() => setAttempt(value => value + 1)}>Tentar novamente</button></div>
      : currentWallet && <>
        <dl className={styles.balances}>
          <div><dt>Disponível</dt><dd>{brl(currentWallet.balance.availableCents)}</dd></div>
          <div><dt>A liberar</dt><dd>{brl(currentWallet.balance.pendingCents)}</dd></div>
          <div><dt>Reservado em compras</dt><dd>{brl(currentWallet.balance.reservedCents)}</dd></div>
        </dl>
        {currentWallet.balance.nextExpiryAt && <p className={styles.expiry}>{brl(currentWallet.balance.nextExpiryCents)} disponíveis vencem em {date(currentWallet.balance.nextExpiryAt)}.</p>}
        {currentWallet.program.status !== "active" && <p className={styles.notice}>{currentWallet.program.status === "disabled" ? "Esta loja ainda não ativou novos ganhos de cashback." : "Novos ganhos de cashback estão pausados nesta loja."} O saldo já concedido segue as condições de cada crédito.</p>}
        {currentWallet.balance.pendingCents > 0 && <p className={styles.notice}>Créditos a liberar ainda não podem ser utilizados. A liberação segue as condições da compra.</p>}
        {currentWallet.program.published?.terms && <details className={styles.terms}><summary>Condições do cashback</summary><p>{currentWallet.program.published.terms}</p></details>}
        <div className={styles.statementHeading}><h3>Extrato</h3><span>{transactions?.total ?? 0} movimentações</span></div>
        {loading && <p role="status" className={styles.notice}>Atualizando saldo e extrato…</p>}
        {!transactions?.items.length ? <p className={styles.notice}>Você ainda não tem movimentações de cashback nesta loja. As compras elegíveis aparecerão aqui.</p> : <ol className={styles.transactions}>
          {transactions.items.map(row => <li key={row.id}>
            <div><strong>{labels[row.type]}</strong><p>{row.reason}</p><span>{date(row.occurredAt)}{row.orderId ? ` · Pedido ${row.orderId}` : ""}</span></div>
            <span className={styles.amount}>{row.amountCents < 0 || ["redeem", "expire", "reverse"].includes(row.type) ? "−" : ""}{brl(Math.abs(row.amountCents))}</span>
          </li>)}
        </ol>}
        {transactions && transactions.total > transactions.pageSize && <nav className={styles.pagination} aria-label="Páginas do extrato de cashback">
          <button data-neu="secondary" type="button" className={styles.button} disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
          <span>Página {transactions.page} de {Math.ceil(transactions.total / transactions.pageSize)}</span>
          <button data-neu="secondary" type="button" className={styles.button} disabled={loading || page * transactions.pageSize >= transactions.total} onClick={() => setPage(value => value + 1)}>Próxima</button>
        </nav>}
      </>}
    </div>
    <CashbackWhatsAppLink onLinked={() => { setPage(1); setAttempt(value => value + 1); }} />
  </section>;
}
