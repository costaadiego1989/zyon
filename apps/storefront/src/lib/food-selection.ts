interface SelectionGroup {
  name: string;
  required: boolean;
  selectionType: "single" | "multiple";
  minSelections?: number;
  maxSelections?: number;
  items: readonly { id: string }[];
}

export function foodSelectionLimits(group: SelectionGroup) {
  return { min: group.minSelections ?? (group.required ? 1 : 0),
    max: group.maxSelections ?? (group.selectionType === "single" ? 1 : group.items.length) };
}

export function foodSelectionLabel(group: SelectionGroup) {
  const { min, max } = foodSelectionLimits(group);
  return min === max ? `Escolha ${min}` : min === 0 ? `Escolha até ${max}` : `Escolha de ${min} a ${max}`;
}

export function foodSelectionError(group: SelectionGroup, selected: Set<string>): string | null {
  const count = group.items.filter(item => selected.has(item.id)).length, { min, max } = foodSelectionLimits(group);
  if (count < min) return min === 1 ? `Escolha ${group.name.toLowerCase()} para continuar.` : `Escolha pelo menos ${min} opções em ${group.name}.`;
  if (count > max) return `Escolha no máximo ${max} opções em ${group.name}.`;
  return null;
}

export function toggleFoodSelection(previous: Set<string>, group: SelectionGroup, id: string) {
  if (!group.items.some(item => item.id === id)) return previous;
  const next = new Set(previous), { min, max } = foodSelectionLimits(group);
  if (group.selectionType === "single") {
    const deselect = previous.has(id) && min === 0;
    group.items.forEach(item => next.delete(item.id));
    if (!deselect) next.add(id);
  } else if (next.has(id)) next.delete(id);
  else if (group.items.filter(item => next.has(item.id)).length < max) next.add(id);
  return next;
}
