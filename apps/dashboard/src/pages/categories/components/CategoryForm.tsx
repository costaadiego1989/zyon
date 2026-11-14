import React, { useId, useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import type { ProductCategoryDTO, CreateCategoryInput, UpdateCategoryInput } from "../../../api/endpoints/catalog.js";
import { slugify } from "../useCategoriesPage.js";
import { useApi } from "../../../hooks/useApi.js";
import { Modal } from "../../../components/Modal.js";
import { Button } from "../../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../../components/FormField.js";
import "../../../components/configuration-form.css";
import "../categories.css";

interface CategoryFormProps {
  mode: "create" | "edit";
  category: ProductCategoryDTO | null;
  parentOptions: ProductCategoryDTO[];
  defaultParentId?: string;
  saving: boolean;
  saveError?: string | null;
  onSave: (data: CreateCategoryInput | UpdateCategoryInput) => void;
  onCancel: () => void;
}

export function CategoryForm({ mode, category, parentOptions, defaultParentId, saving, saveError, onSave, onCancel }: CategoryFormProps) {
  const api = useApi();
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(mode === "edit");
  const [parentId, setParentId] = useState(category?.parent_id ?? defaultParentId ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [imageUrl, setImageUrl] = useState(category?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const busy = saving || uploading;
  const nameError = submitted && !name.trim() ? "Informe o nome da categoria." : undefined;
  const slugError = submitted && mode === "create" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || slugify(name))
    ? "Use letras minúsculas, números e hífens." : undefined;

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setImageError(null);
    if (!file.type.startsWith("image/")) { setImageError("Escolha um arquivo de imagem."); return; }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await api.uploadLogo(base64);
      if (!result.logoUrl) throw new Error("missing_image_url");
      setImageUrl(result.logoUrl);
    } catch {
      setImageError("Não foi possível enviar a imagem. A imagem anterior foi mantida. Tente novamente.");
    } finally { setUploading(false); }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    const finalSlug = slug.trim() || slugify(name);
    if (!name.trim() || (mode === "create" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalSlug))) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const data = { name: name.trim(), description: description.trim(), image_url: imageUrl };
    onSave(mode === "create" ? { ...data, slug: finalSlug, parent_id: parentId || undefined } : { ...data, parent_id: parentId || null });
  }

  return (
    <Modal isOpen presentation="center" size="lg" title={mode === "edit" ? "Editar categoria" : "Nova categoria"}
      subtitle="Agrupe produtos para ajudar seus clientes a encontrar o que procuram."
      onClose={() => { if (!busy) onCancel(); }}
      footer={<><Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button><Button type="submit" form={formId} loading={saving} disabled={busy}>{mode === "edit" ? "Salvar categoria" : "Criar categoria"}</Button></>}>
      <form id={formId} ref={formRef} onSubmit={submit} noValidate>
        <fieldset className="configuration-form" disabled={busy} aria-busy={busy}>
          {saveError && <p className="form-field-error" role="alert">{saveError}</p>}
          <section className="configuration-form__section">
            <h3>Nome e organização</h3>
            <div className="configuration-form__grid">
              <FormField label="Nome da categoria" value={name} error={nameError} placeholder="Ex.: Camisetas"
                onChange={value => { setName(value); if (!slugEdited) setSlug(slugify(value)); }} />
              <FormSelect label="Categoria superior" value={parentId} onChange={setParentId}
                options={[{ value: "", label: "Nenhuma, categoria principal" }, ...parentOptions.map(cat => ({ value: cat.id, label: cat.name }))]}
                hint="Exemplo: Camisetas pode ficar dentro de Roupas." />
            </div>
            <FormField label="Identificador no endereço" value={slug} disabled={mode === "edit"} error={slugError}
              onChange={value => { setSlugEdited(true); setSlug(value); }}
              hint={mode === "edit" ? "Definido na criação da categoria e mantido ao editar." : "Gerado a partir do nome. Exemplo: camisetas-infantis."} />
            <FormTextarea label="Descrição (opcional)" value={description} onChange={setDescription} rows={3}
              placeholder="Ex.: Camisetas para o dia a dia, em diferentes cores e tamanhos." />
          </section>
          <section className="configuration-form__section">
            <h3>Imagem da categoria</h3>
            <p>Escolha uma imagem que represente este grupo de produtos. O envio é opcional.</p>
            <input ref={fileRef} type="file" accept="image/*" onChange={upload} hidden />
            <div className="category-image">
              {imageUrl && <img src={imageUrl} alt="Imagem atual da categoria" />}
              <Button variant="outline" onClick={() => fileRef.current?.click()} loading={uploading}><Upload size={16} />{imageUrl ? "Trocar imagem" : "Enviar imagem"}</Button>
              {imageUrl && <Button variant="ghost" onClick={() => { setImageUrl(""); setImageError(null); }}><Trash2 size={16} /> Remover imagem</Button>}
            </div>
            {imageError && <p role="alert" className="form-field-error">{imageError}</p>}
          </section>
        </fieldset>
      </form>
    </Modal>
  );
}
