import React, { useEffect, useId, useRef, useState } from "react";
import { FolderTree } from "lucide-react";
import type { MerchantProfile } from "../../../api-client.js";
import type { CreateCategoryInput, ProductCategoryDTO, UpdateCategoryInput } from "../../../api/endpoints/catalog.js";
import type { ServiceAttendanceErrorKind } from "../../../api/endpoints/service-attendance.js";
import { createIdempotencyKey } from "../../../api/http/idempotency.js";
import { Button } from "../../../components/Button.js";
import { DataPanel } from "../../../components/DataPanel.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { ConfirmDialog } from "../../../components/ConfirmDialog.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { CategoryForm } from "../../categories/components/CategoryForm.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { categoryFormPayload, categoryParentOptions } from "./service-category-form.js";
import { useServiceCategoriesPanelData } from "./useServiceCategoriesPanelData.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
type Context = ReturnType<typeof useServiceCategoriesPanelData>["context"];
interface Editor { context: Context; token: object; key: string; category: ProductCategoryDTO | null; error?: string }
function errorMessage(kind: ServiceAttendanceErrorKind): string {
  if (kind === "conflict") return "Confira os dados atuais antes de salvar novamente.";
  if (kind === "network" || kind === "invalid_response") return "Não foi possível confirmar o resultado. Atualize os dados e confira o vínculo antes de tentar novamente.";
  return "Não foi possível salvar. Os dados preenchidos foram mantidos.";
}

export function ServiceCategoriesPanel({ me, vm }: { me: MerchantProfile | null; vm: ViewModel }) {
  const catalog = useServiceCategoriesPanelData(me), context = catalog.context;
  const current = useRef(context); current.current = context;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submitting = useRef<{ context: Context } | null>(null);
  const [editorState, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<{ context: Context; category: ProductCategoryDTO; key: string } | null>(null);
  const [notice, setNotice] = useState<{ context: Context; text: string; error?: boolean } | null>(null);
  const [choices, setChoices] = useState<{ context: Context; values: Record<string, string> }>({ context: null, values: {} });
  const editor = editorState?.context === context ? editorState : null;
  const confirming = deletion?.context === context ? deletion : null;
  const activeEditor = useRef(editor); activeEditor.current = editor;
  const togglePrefix = useId();
  const busy = vm.command.status === "saving" || vm.loadState.status === "loading" || catalog.status === "loading", blocked = busy || vm.command.status === "conflict" || vm.command.status === "uncertain";
  const panel = useRef<HTMLDivElement>(null), focusAfterDeletion = useRef<Context>(null);
  useEffect(() => {
    const pending = focusAfterDeletion.current;
    if (!pending || confirming) return;
    focusAfterDeletion.current = null;
    if (current.current === pending) panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [confirming]);
  // These adapter fields serve the existing form's display types. The writer
  // below sends neither merchant_id nor product_count to the API.
  const categories: ProductCategoryDTO[] = (vm.loadState.data?.categories ?? []).map(row => ({ ...row, merchant_id: me?.id ?? "" }));

  function open(category: ProductCategoryDTO | null) {
    if (!catalog.allowed || !vm.allowed || blocked || !context) return;
    setNotice(null); setDeletion(null); setEditor({ context, token: {}, key: createIdempotencyKey(), category });
  }
  async function perform<T>(operation: () => Promise<import("../useServiceAttendancePage.js").ServiceActionResult<T>>, message: string, after?: () => void) {
    const scope = context;
    if (!scope || !catalog.allowed || !vm.allowed || blocked || current.current !== scope || submitting.current?.context === scope) return;
    const token = { context: scope }; submitting.current = token;
    try {
      const result = await operation();
      if (!mounted.current || current.current !== scope) return;
      if (result.status === "success") {
        if (catalog.status !== "idle") await catalog.read();
        if (!mounted.current || current.current !== scope) return;
        setNotice({ context: scope, text: message }); after?.();
      }
      else if (result.status === "error") { const text = errorMessage(result.kind); setNotice({ context: scope, text, error: true }); setEditor(previous => previous?.context === scope ? { ...previous, error: text } : previous); }
    } finally { if (submitting.current === token) submitting.current = null; }
  }
  function saveCategory(input: CreateCategoryInput | UpdateCategoryInput) {
    const active = editor;
    if (!active || activeEditor.current?.token !== active.token) return;
    const operation = active.category
      ? () => vm.actions.updateCategory(active.category!.id, categoryFormPayload("edit", input), { idempotencyKey: active.key })
      : () => vm.actions.createCategory(categoryFormPayload("create", input as CreateCategoryInput), { idempotencyKey: active.key });
    void perform(operation, "Categoria salva.", () => { if (activeEditor.current?.token === active.token) setEditor(null); });
  }
  function choose(serviceId: string, categoryId: string) {
    if (!context || blocked) return;
    setChoices(previous => ({ context, values: { ...(previous.context === context ? previous.values : {}), [serviceId]: categoryId } }));
  }
  async function reconcile() {
    const refreshed = await vm.reconcileCategories(() => catalog.read());
    if (!refreshed || !mounted.current || current.current !== context) return;
    if (mounted.current && current.current === context) { setChoices({ context, values: {} }); setNotice(null); }
  }
  if (!catalog.allowed || !vm.allowed) return <EmptyState icon={FolderTree} title="Sem permissão para gerenciar categorias de serviços" description="A gestão de categorias exige uma empresa de serviços e permissão de administração." />;
  return <div ref={panel} style={{ display: "grid", gap: 16, minWidth: 0 }}>
    {notice?.context === context && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    <DataPanel title="Categorias de serviços" trailing={<Button disabled={blocked || !vm.loadState.data} onClick={() => open(null)}>Nova categoria</Button>}
      isEmpty={categories.length === 0} empty={{ icon: FolderTree, title: "Nenhuma categoria cadastrada", description: "Crie categorias para organizar as ofertas do seu catálogo de serviços." }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 20, display: "grid", gap: 16 }}>{categories.map(row => <li key={row.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <strong style={{ flex: "1 1 160px", overflowWrap: "anywhere" }}>{row.name}</strong>
        <span>Ofertas vinculadas: {row.product_count}</span>
        <label htmlFor={`${togglePrefix}-${row.id}`}>Categoria {row.name} ativa</label><ToggleSwitch id={`${togglePrefix}-${row.id}`} checked={row.is_active} disabled={blocked} onChange={isActive => void perform(() => vm.actions.updateCategory(row.id, { isActive }, { idempotencyKey: createIdempotencyKey() }), isActive ? "Categoria ativada." : "Categoria pausada.")} />
        <Button variant="outline" disabled={blocked} onClick={() => open(row)}>Editar {row.name}</Button>
        <Button variant="ghost" disabled={blocked} onClick={() => { setNotice(null); setDeletion({ context, category: row, key: createIdempotencyKey() }); }}>Excluir {row.name}</Button>
      </li>)}</ul>
    </DataPanel>
    <DataPanel title="Serviços publicados" trailing={<Button variant="outline" loading={catalog.status === "loading"} disabled={busy} onClick={() => void catalog.read()}>Consultar serviços publicados</Button>}>
      <div style={{ padding: 20, display: "grid", gap: 16 }}>
        <p>A categoria organiza cada serviço do catálogo. Os preços e as variantes continuam definidos na oferta.</p>
        {catalog.status === "idle" && <p>Consulte os serviços publicados para conferir seus vínculos.</p>}
        {catalog.status === "error" && <p role="alert">{catalog.error}</p>}
        {catalog.status === "ready" && catalog.items.length === 0 && <p>{catalog.nextCursor ? "Nenhum serviço nesta página. Há outros itens do catálogo para consultar." : "Nenhum serviço publicado encontrado nas páginas consultadas."}</p>}
        {catalog.items.map(service => {
          const selected = choices.context === context ? choices.values[service.id] ?? service.categoryId ?? "" : service.categoryId ?? "";
          const options = categories.filter(row => row.is_active || row.id === service.categoryId);
          const missingCategory = service.categoryId && !categories.some(row => row.id === service.categoryId);
          return <div key={service.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, flex: "1 1 240px", minWidth: 0 }}>{service.name}<select className="form-input" aria-label={`Categoria de ${service.name}`} value={selected} disabled={blocked} onChange={event => choose(service.id, event.target.value)}>
              <option value="">Sem categoria</option>{missingCategory && <option value={service.categoryId}>Categoria atual não disponível na lista</option>}{options.map(row => <option key={row.id} value={row.id}>{row.name}{row.is_active ? "" : " (inativa)"}</option>)}
            </select></label>
            <Button variant="outline" disabled={blocked || !selected || selected === service.categoryId || !categories.some(row => row.id === selected && row.is_active)} onClick={() => void perform(() => vm.actions.assignServiceCategory(service.id, selected), "Vínculo de categoria salvo.", () => { setChoices(previous => ({ context, values: Object.fromEntries(Object.entries(previous.context === context ? previous.values : {}).filter(([id]) => id !== service.id)) })); })}>Salvar categoria de {service.name}</Button>
          </div>;
        })}
        {catalog.nextCursor && <Button variant="outline" disabled={busy} loading={catalog.status === "loading"} onClick={() => void catalog.read(catalog.nextCursor)}>Carregar mais itens do catálogo</Button>}
        {(vm.command.status === "conflict" || vm.command.status === "uncertain") && <Button variant="outline" onClick={() => void reconcile()}>Atualizar dados e vínculos</Button>}
      </div>
    </DataPanel>
    {editor && <CategoryForm key={editor.key} mode={editor.category ? "edit" : "create"} category={editor.category} parentOptions={categoryParentOptions(categories, editor.category?.id ?? null)} offeringKind="services" saving={busy} saveError={editor.error} onSave={saveCategory} onCancel={() => { if (!busy) setEditor(null); }} />}
    <ConfirmDialog open={!!confirming} title="Excluir categoria" description={confirming ? `Excluir ${confirming.category.name}? Esta ação altera a organização do catálogo.` : ""} confirmLabel="Excluir categoria" busy={busy} error={notice?.context === context && notice.error ? notice.text : null}
      onCancel={() => { if (!busy) setDeletion(null); }} onConfirm={() => { if (confirming) void perform(() => vm.actions.deleteCategory(confirming.category.id, { idempotencyKey: confirming.key }), "Categoria excluída.", () => { focusAfterDeletion.current = confirming.context; setDeletion(null); }); }} />
  </div>;
}
