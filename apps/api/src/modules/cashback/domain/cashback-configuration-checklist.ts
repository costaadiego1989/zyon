import type { CashbackConfigurationChecklist, CashbackConfigurationChecklistItem, CashbackDraft } from "@zyon/shared-types";
import { CASHBACK_CONFIGURATION_DECISIONS, cashbackConfigurationValue } from "./cashback-configuration-step.js";

/** A fresh projection of the canonical draft; never a second configuration state. */
export function cashbackConfigurationChecklist(draft: CashbackDraft): CashbackConfigurationChecklist {
  const items: CashbackConfigurationChecklistItem[] = CASHBACK_CONFIGURATION_DECISIONS.map(({ field, label, group, kind, unit }) => {
    const value = cashbackConfigurationValue(draft, field) as CashbackConfigurationChecklistItem["value"];
    return { field, label, group, kind, unit, completed: value !== undefined, ...(value === undefined ? {} : { value }) };
  });
  return { items, completed: items.filter(item => item.completed).length, total: items.length, nextField: items.find(item => !item.completed)?.field ?? null };
}
