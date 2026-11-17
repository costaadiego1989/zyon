import { useId } from "react";
import { Button } from "../../../components/Button.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { useServiceProfessionalLinks, type ServiceProfessionalLinksOptions } from "../hooks/useServiceProfessionalLinks.js";

export function ServiceProfessionalLinks(props: ServiceProfessionalLinksOptions) {
  const links = useServiceProfessionalLinks(props);
  const switchId = useId();
  if (props.businessMode !== "services" || props.productType !== "service") return null;
  return <section aria-labelledby="service-professional-links-title" aria-busy={links.loading || links.saving}
    style={{ display: "grid", gap: 16, padding: "20px 22px", border: "1px solid var(--color-border)", borderRadius: 14, background: "var(--surface-2)", minWidth: 0 }}>
    <div><h3 id="service-professional-links-title" style={{ margin: 0 }}>Profissionais deste serviço</h3>
      <p style={{ margin: "8px 0 0", color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.6 }}>Escolha os profissionais que realizam este serviço. Os horários de atendimento são gerenciados separadamente.</p>
    </div>
    {!props.productId ? <p style={{ margin: 0 }}>Salve o serviço para vincular profissionais. Você poderá continuar neste cadastro após salvar.</p>
      : !links.allowed ? <p style={{ margin: 0 }} role="status">{props.blocked ? "Confirme os dados e a modalidade deste serviço antes de alterar vínculos." : "Somente o proprietário ou um administrador pode alterar os profissionais vinculados."}</p>
      : <>
        {links.loading && <p role="status" style={{ margin: 0 }}>Carregando profissionais e vínculos salvos…</p>}
        {links.error && <p role="alert" style={{ margin: 0, color: "var(--color-error)" }}>{links.error}</p>}
        {!links.loading && !links.error && !links.rows.length && <p style={{ margin: 0 }}>Nenhum profissional cadastrado nesta empresa. Cadastre os profissionais em Atendimento para vinculá-los a este serviço.</p>}
        {links.rows.length > 0 && <ul aria-label="Selecionar profissionais" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {links.rows.map((row, index) => {
            const saved = row.professional.services.some(link => link.productId === props.productId), pending = row.selected !== saved;
            const id = `${switchId}-professional-${index}`;
            return <li key={row.professional.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--color-border)", overflowWrap: "anywhere" }}>
              <div className="product-detail__switch-row" style={{ gap: 16, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}><label htmlFor={id} style={{ display: "block", fontSize: 14, lineHeight: 1.5, cursor: row.professional.isActive ? "pointer" : "default" }}>Vincular {row.professional.publicName}</label>
                  <span style={{ display: "block", marginTop: 4, color: "var(--color-text-muted)", fontSize: 12 }}>{!row.professional.isActive ? "Inativo" : row.professional.isPublished ? "Publicado" : "Não publicado"}</span>
                  <span style={{ display: "block", marginTop: 6, fontSize: 12 }}>{pending ? "Alteração ainda não salva" : saved ? "Vinculado a este serviço" : "Sem vínculo com este serviço"}</span>
                </div>
                <ToggleSwitch id={id} checked={row.selected} disabled={!row.professional.isActive || links.saving || links.loading}
                  onChange={selected => links.select(row.professional.id, selected)} />
              </div>
              {row.status === "saving" && <p role="status" style={{ margin: "8px 0 0", fontSize: 12 }}>Salvando vínculo…</p>}
              {row.message && <p role={row.status === "failed" ? "alert" : "status"} style={{ margin: "8px 0 0", fontSize: 12, color: row.status === "failed" ? "var(--color-error)" : "var(--color-text-muted)" }}>{row.message}</p>}
            </li>;
          })}
        </ul>}
        {links.needsReload && <p role="status" style={{ margin: 0, fontSize: 13 }}>Os vínculos já confirmados foram preservados. Recarregue os profissionais, revise as escolhas pendentes e confirme novamente.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Button variant="primary" disabled={!links.canSave} loading={links.saving} onClick={() => void links.save()}>Salvar vínculos</Button>
          <Button variant="outline" disabled={links.loading || links.saving} onClick={links.reload}>Recarregar profissionais</Button>
        </div>
      </>}
  </section>;
}
