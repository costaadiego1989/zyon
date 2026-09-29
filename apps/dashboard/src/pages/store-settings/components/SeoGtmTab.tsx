import React, { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../../components/FormField.js";
import { Modal } from "../../../components/Modal.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import type { SeoSettings, GtmSettings, SeoTone, GenerateSeoSuggestionsResponse } from "@zyon/shared-types";

export interface SeoGtmTabProps {
  seo: SeoSettings; gtm: GtmSettings; slug: string; customDomain?: string;
  errors: Record<string, string>; actionError?: string | null;
  saving: boolean; generatingAi: boolean; showGeneratorModal: boolean;
  suggestions: GenerateSeoSuggestionsResponse | null;
  expandedSections?: { og: boolean; pixels: boolean };
  onSeoChange: (partial: Partial<SeoSettings>) => void;
  onGtmChange: (partial: Partial<GtmSettings>) => void;
  onSlugChange: (slug: string) => void; onSave: () => void;
  onGenerate: (prompt: string, tone: SeoTone, category?: string) => void;
  onApplySuggestion: (titleIdx: number, descIdx: number, keywords: string[]) => void;
  onOpenModal: () => void; onCloseModal: () => void;
  onToggleSection?: (section: "og" | "pixels") => void;
}

function SeoGeneratorModal({ isOpen, onClose, onGenerate, onApply, loading, suggestions, error }: {
  isOpen: boolean; onClose: () => void; onGenerate: SeoGtmTabProps["onGenerate"];
  onApply: SeoGtmTabProps["onApplySuggestion"]; loading: boolean;
  suggestions: GenerateSeoSuggestionsResponse | null; error?: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<SeoTone>("profissional");
  const [selectedTitle, setSelectedTitle] = useState(0);
  const [selectedDesc, setSelectedDesc] = useState(0);
  useEffect(() => { setSelectedTitle(0); setSelectedDesc(0); }, [suggestions]);
  return <Modal isOpen={isOpen} title="Criar textos para a busca" subtitle="Descreva sua loja para receber sugestões de título e descrição. Revise o resultado antes de salvar." presentation="center" size="lg" onClose={() => { if (!loading) onClose(); }} footer={<><Button variant="outline" disabled={loading} onClick={onClose}>Cancelar</Button>{suggestions ? <Button disabled={!suggestions.titles.length || !suggestions.descriptions.length} onClick={() => onApply(selectedTitle, selectedDesc, suggestions.keywords)}>Usar sugestões no formulário</Button> : <Button disabled={prompt.trim().length < 10} loading={loading} onClick={() => onGenerate(prompt.trim(), tone)}><Sparkles size={16} /> Gerar sugestões</Button>}</>}>
    <div className="configuration-form administration-page">
      {!suggestions ? <fieldset className="admin-fields" disabled={loading}>
        <div className="admin-field-wide"><FormTextarea label="Descreva seu negócio" placeholder="Conte o que a loja vende, para quem vende e seus diferenciais." value={prompt} onChange={setPrompt} rows={6} maxLength={500} hint={`${prompt.length}/500 caracteres. Escreva pelo menos 10.`} /></div>
        <FormSelect label="Tom dos textos" value={tone} onChange={v => setTone(v as SeoTone)} options={[{value:"profissional",label:"Profissional"},{value:"casual",label:"Casual"},{value:"luxo",label:"Sofisticado"},{value:"técnico",label:"Técnico"}]} />
      </fieldset> : <>
        <fieldset className="store-seo-choices"><legend>Título para os resultados de busca</legend>{suggestions.titles.map((title,i) => <label className="store-seo-choice" key={i}><input type="radio" name="seo-title" checked={selectedTitle === i} onChange={() => setSelectedTitle(i)} /><span>{title}</span></label>)}</fieldset>
        <fieldset className="store-seo-choices"><legend>Descrição para os resultados de busca</legend>{suggestions.descriptions.map((description,i) => <label className="store-seo-choice" key={i}><input type="radio" name="seo-description" checked={selectedDesc === i} onChange={() => setSelectedDesc(i)} /><span>{description}</span></label>)}</fieldset>
        <p className="admin-help"><strong>Palavras-chave sugeridas:</strong> {suggestions.keywords.join(", ") || "Nenhuma palavra-chave sugerida."}</p>
        <p className="admin-help">As sugestões serão aplicadas ao formulário. Clique em Salvar configurações para publicá-las.</p>
      </>}
      {error && <p role="alert" className="admin-feedback admin-feedback--error">{error}</p>}
    </div>
  </Modal>;
}

export function SeoGtmTab({ seo, gtm, slug, customDomain, errors, actionError, saving, generatingAi, showGeneratorModal, suggestions, onSeoChange, onGtmChange, onSlugChange, onGenerate, onApplySuggestion, onOpenModal, onCloseModal }: SeoGtmTabProps) {
  const [keywordInput, setKeywordInput] = useState("");
  function addKeyword() {
    const kw = keywordInput.trim();
    if (!kw || (seo.keywords ?? []).length >= 10 || (seo.keywords ?? []).includes(kw)) return;
    onSeoChange({keywords:[...(seo.keywords ?? []),kw]}); setKeywordInput("");
  }
  return <div>
    <section className="store-seo-section">
      <SectionHeader title="Como sua loja aparece na busca" variant="secondary" trailing={<Button variant="outline" disabled={saving || generatingAi} onClick={onOpenModal}><Sparkles size={16} /> Criar textos com IA</Button>} />
      <p className="admin-help">Defina o título e a descrição que ajudam clientes a reconhecer sua loja nos resultados de busca.</p>
      <FormField label="Endereço da loja" value={slug} onChange={v => onSlugChange(v.toLowerCase().replace(/[^a-z0-9-]/g,""))} placeholder="minha-loja" error={errors.slug} hint={customDomain ? `https://${customDomain}` : `https://stores.zyon.com/store/${slug || "minha-loja"}`} />
      <FormField label="Título da página" value={seo.title ?? ""} onChange={v => onSeoChange({title:v})} maxLength={70} hint={`${(seo.title ?? "").length}/70 caracteres`} error={errors.seoTitle} placeholder="Nome da loja e seu principal diferencial" />
      <FormTextarea label="Descrição da página" value={seo.description ?? ""} onChange={v => onSeoChange({description:v})} maxLength={160} rows={4} hint={errors.seoDescription ?? `${(seo.description ?? "").length}/160 caracteres`} placeholder="Descreva os produtos e o que seus clientes encontram na loja." />
      <div><FormField label={`Palavras-chave (${(seo.keywords ?? []).length}/10)`} value={keywordInput} onChange={setKeywordInput} onKeyDown={e => { if(e.key === "Enter") { e.preventDefault(); addKeyword(); } }} hint="Digite uma expressão e pressione Enter, ou use o botão abaixo." error={errors.keywords} /><div className="admin-actions"><Button variant="outline" disabled={!keywordInput.trim() || (seo.keywords ?? []).length >= 10} onClick={addKeyword}>Adicionar palavra-chave</Button></div><ul className="store-keywords">{(seo.keywords ?? []).map((kw,i) => <li key={`${kw}-${i}`}><span>{kw}</span><Button variant="ghost" aria-label={`Remover palavra-chave ${kw}`} onClick={() => onSeoChange({keywords:seo.keywords?.filter((_,index) => index !== i)})}><X size={16} /></Button></li>)}</ul></div>
      <details className="store-seo-details"><summary>Compartilhamento nas redes sociais</summary><p className="admin-help">Personalize o título, a descrição e a imagem usados quando alguém compartilha o link da loja.</p><div className="admin-fields">
        <FormField label="Título do compartilhamento" value={seo.ogTitle ?? ""} onChange={v => onSeoChange({ogTitle:v})} maxLength={70} error={errors.ogTitle} />
        <FormField label="Imagem do compartilhamento (URL)" type="url" value={seo.ogImage ?? ""} onChange={v => onSeoChange({ogImage:v})} placeholder="https://..." />
        <div className="admin-field-wide"><FormTextarea label="Descrição do compartilhamento" value={seo.ogDescription ?? ""} onChange={v => onSeoChange({ogDescription:v})} maxLength={160} rows={4} hint={errors.ogDescription} /></div>
        <div className="admin-field-wide"><FormField label="Endereço principal da página (opcional)" type="url" value={seo.canonicalUrl ?? ""} onChange={v => onSeoChange({canonicalUrl:v})} hint="Use apenas se precisar indicar outra URL principal aos mecanismos de busca." /></div>
      </div></details>
    </section>
    <section className="store-seo-section">
      <SectionHeader title="Rastreamento e conversões" variant="secondary" />
      <p className="admin-help">Cole os identificadores das ferramentas que sua loja utiliza para medir visitas e compras. Deixe em branco as integrações que não utiliza.</p>
      <div className="admin-fields"><FormField label="Google Tag Manager" value={gtm.gtmId ?? ""} onChange={v => onGtmChange({gtmId:v})} placeholder="GTM-XXXXXX" hint="Identificador do contêiner." error={errors.gtmId} /><FormField label="Google Analytics 4" value={gtm.gaTrackingId ?? ""} onChange={v => onGtmChange({gaTrackingId:v})} placeholder="G-XXXXXX" hint="Identificador de medição." error={errors.gaTrackingId} /></div>
      <details className="store-seo-details"><summary>Pixels de conversão</summary><div className="admin-fields"><FormField label="Pixel do Facebook" value={gtm.pixelIds?.facebook ?? ""} onChange={v => onGtmChange({pixelIds:{...gtm.pixelIds,facebook:v}})} placeholder="123456789012345" /><FormField label="Pixel do TikTok" value={gtm.pixelIds?.tiktok ?? ""} onChange={v => onGtmChange({pixelIds:{...gtm.pixelIds,tiktok:v}})} placeholder="CXXXXXXXXXXXXXXX" /></div></details>
      <div className="store-seo-switch"><ToggleSwitch id="store-gtm-datalayer" checked={gtm.dataLayerEnabled !== false} disabled={saving} onChange={v => onGtmChange({dataLayerEnabled:v})} /><label htmlFor="store-gtm-datalayer">Disponibilizar eventos ao Google Tag Manager<br /><span className="admin-muted">Visitas, itens adicionados ao carrinho e compras no Data Layer.</span></label></div>
    </section>
    <SeoGeneratorModal isOpen={showGeneratorModal} onClose={onCloseModal} onGenerate={onGenerate} onApply={onApplySuggestion} loading={generatingAi} suggestions={suggestions} error={actionError} />
  </div>;
}
