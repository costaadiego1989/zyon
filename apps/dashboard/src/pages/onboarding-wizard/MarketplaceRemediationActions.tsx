import React from "react";
import { Button } from "../../components/Button.js";
import "./marketplace-remediation-actions.css";

type Action = { id: string; label: string; onSelect: () => void };
type Props = { visible: boolean; actions: readonly Action[] };

/** Recovery navigation only. It never changes a subscription or runs an action
 * on render; the existing dedicated pages still enforce their own access. */
export function MarketplaceRemediationActions({ visible, actions }: Props) {
  if (!visible) return null;
  return <details className="marketplace-remediation-actions">
    <summary>Gerenciar operações existentes</summary>
    <p>Acompanhe cobranças, remessas e outros registros já criados pela sua loja.</p>
    <nav aria-label="Operações existentes do marketplace">
      {actions.map(action => <Button key={action.id} variant="outline" onClick={action.onSelect}>{action.label}</Button>)}
    </nav>
  </details>;
}
