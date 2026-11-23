import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CompanyDomainQuery, CompanyFilters, CompanySearchQuery } from "@zyon/shared-types";
import { Search } from "lucide-react";
import { Button, ReadState, cents, money, stages, useAction, useResource, type PageProps } from "./screen-controls.js";
import { ProspectingState } from "./ProspectingShell.js";

const ufs = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
function Domain({
  api,
  kind,
  label,
  name,
  uf,
  snapshotId,
  onSessionExpired,
}: Pick<PageProps, "api" | "onSessionExpired"> & {
  kind: CompanyDomainQuery["kind"];
  label: string;
  name: string;
  uf?: string;
  snapshotId?: string;
}) {
  const [search, setSearch] = useState(""),
    [after, setAfter] = useState<string>(),
    [chosen, setChosen] = useState<{ code: string; label: string } | null>(null);
  const load = useCallback(
    (s: AbortSignal) =>
      api.domains(
        { kind, uf: uf || undefined, search: search || undefined, snapshotId, afterCode: after, limit: 30 },
        s
      ),
    [api, kind, uf, search, snapshotId, after]
  );
  const result = useResource(load, onSessionExpired);
  const choices = result.data?.items ?? [];
  return (
    <div>
      <label>
        Buscar {label.toLowerCase()}
        <input
          value={search}
          onChange={(e) => {
            setAfter(undefined);
            setSearch(e.target.value);
          }}
        />
      </label>
      <label>
        {label}
        <select
          aria-label={label}
          name={name}
          value={chosen?.code ?? ""}
          onChange={(e) => setChosen(choices.find((o) => o.code === e.target.value) ?? null)}
        >
          <option value="">Todos</option>
          {chosen && !choices.some((o) => o.code === chosen.code) && (
            <option value={chosen.code}>
              {chosen.label} · {chosen.code}
            </option>
          )}
          {choices.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label} · {o.code}
              {uf ? " · " + uf : ""}
            </option>
          ))}
        </select>
      </label>
      {result.error ? (
        <ReadState {...result} />
      ) : (
        result.data?.nextCursor && (
          <Button onClick={() => setAfter(result.data!.nextCursor!)}>Mais opções de {label.toLowerCase()}</Button>
        )
      )}
    </div>
  );
}
function Field({
  name,
  label,
  choices,
  type = "text",
}: {
  name: string;
  label: string;
  choices?: Record<string, string>;
  type?: string;
}) {
  return (
    <label>
      {label}
      {choices ? (
        <select aria-label={label} name={name}>
          <option value="">Todos</option>
          {Object.entries(choices).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        <input name={name} type={type} />
      )}
    </label>
  );
}
const dimensions = {
  ufs: "UF",
  cityCodes: "Município",
  districts: "Bairro",
  mainCnaes: "CNAE principal",
  secondaryCnaes: "CNAE secundário",
  sizes: "Porte",
  legalNatures: "Natureza jurídica",
  statuses: "Situação cadastral",
  matrixBranches: "Estabelecimento",
  stages: "Estágio no CRM",
};
type Dimension = keyof typeof dimensions;
function AdditionalFilterValues({ changed }: { changed: () => void }) {
  const group = useRef<HTMLFieldSetElement>(null);
  const [dimension, setDimension] = useState<Dimension>("ufs");
  const [pinned, setPinned] = useState<{ dimension: Dimension; value: string; label: string }[]>([]);
  const [notice, setNotice] = useState("");
  function add() {
    const field = group.current?.form?.querySelector<HTMLInputElement | HTMLSelectElement>(
      '[name="' + dimension + '"]:not([type=hidden])'
    );
    const value = field?.value.trim();
    if (!value) {
      setNotice("Preencha o filtro " + dimensions[dimension] + " acima.");
      return;
    }
    if (pinned.some((p) => p.dimension === dimension && p.value === value)) {
      setNotice("Valor já incluído.");
      return;
    }
    const label = field instanceof HTMLSelectElement ? field.selectedOptions[0].textContent ?? value : value;
    setPinned([...pinned, { dimension, value, label }]);
    setNotice("");
    changed();
  }
  return (
    <fieldset ref={group}>
      <legend>Mais de um valor por filtro</legend>
      <p>Para combinar valores, mantenha o primeiro e escolha outro no mesmo filtro acima.</p>
      <div className="prospecting-actions">
        <label>
          Filtro com múltiplos valores
          <select
            aria-label="Filtro com múltiplos valores"
            value={dimension}
            onChange={(e) => setDimension(e.target.value as Dimension)}
          >
            {Object.entries(dimensions).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={add}>Manter valor</Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className="prospecting-actions">
        {pinned.map((p) => (
          <span key={p.dimension + "." + p.value}>
            <input type="hidden" name={p.dimension} value={p.value} />
            <Button
              onClick={() => {
                setPinned(pinned.filter((item) => item !== p));
                changed();
              }}
            >
              Remover {dimensions[p.dimension]} · {p.label}
            </Button>
          </span>
        ))}
      </div>
    </fieldset>
  );
}
function filtersFrom(form: HTMLFormElement): CompanyFilters {
  const result: Record<string, unknown> = {};
  new FormData(form).forEach((raw, key) => {
    const value = String(raw).trim();
    if (!value) return;
    if (["capitalMinCents", "capitalMaxCents"].includes(key)) result[key] = cents(value);
    else if (["simples", "mei", "hasContact"].includes(key)) result[key] = value === "true";
    else if (Object.hasOwn(dimensions, key)) {
      const values = (result[key] as string[] | undefined) ?? [];
      if (!values.includes(value)) result[key] = [...values, value];
    } else result[key] = value;
  });
  return result;
}
export function CompanySearchPage(props: PageProps) {
  const load = useCallback(async (signal: AbortSignal) => {
    const readiness = await props.api.readiness(signal);
    if (!readiness || typeof readiness !== "object" || Array.isArray(readiness))
      throw new Error("directory_availability_unknown");
    return readiness;
  }, [props.api]);
  const availability = useResource(load, props.onSessionExpired);
  const source = availability.data?.source;
  if (source?.status === "current" && source.value?.snapshotId && source.value.state === "published")
    return <PublishedCompanySearchPage {...props} />;
  const preparing = source?.status === "unavailable" && source.value?.snapshotId === null && source.value.state === "unavailable";
  return (
    <section className="prospecting-page">
      <header><h2>Buscar empresas</h2><p>Consulte o cadastro nacional por atividade, localização e perfil da empresa.</p></header>
      {preparing ? (
        <div className="prospecting-state">
          <h3>Base nacional em preparação</h3>
          <p role="status">A busca será liberada quando a importação e a validação dos arquivos do CNPJ forem concluídas.</p>
          <Button onClick={availability.reload}>Verificar disponibilidade</Button>
        </div>
      ) : (
        <ReadState error={availability.error ?? (availability.data ? new Error("directory_availability_unknown") : undefined)} reload={availability.reload} />
      )}
    </section>
  );
}
function PublishedCompanySearchPage(props: PageProps) {
  const { api, onSessionExpired, navigate } = props;
  const [query, setQuery] = useState<CompanySearchQuery>({ filters: {} }),
    [uf, setUf] = useState(""),
    [dirty, setDirty] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<{ snapshot: string; ids: string[] }>({ snapshot: "", ids: [] }),
    [name, setName] = useState(""),
    [issue, setIssue] = useState("");
  const load = useCallback((s: AbortSignal) => api.companies(query, s), [api, query]);
  const result = useResource(load, onSessionExpired),
    page = result.data;
  const action = useAction(props, "companies", result.reload);
  useEffect(() => {
    if (result.error || (page && (!page.items.length || page.snapshotId !== selected.snapshot)))
      setSelected({ snapshot: page?.snapshotId ?? "", ids: [] });
  }, [result.error, page, selected.snapshot]);
  function invalidateSelection() {
    setDirty(true);
    setSelected({ snapshot: "", ids: [] });
  }
  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      setQuery({ filters: filtersFrom(e.currentTarget) });
      setDirty(false);
      setIssue("");
      setSelected({ snapshot: "", ids: [] });
    } catch (error) {
      setIssue((error as Error).message);
    }
  }
  const valid = Boolean(page?.items.length) && !dirty && !action.denied,
    ids = selected.snapshot === page?.snapshotId ? selected.ids : [];
  const domainProps = { api, onSessionExpired, snapshotId: page?.snapshotId };
  const binary = { true: "Sim", false: "Não" };
  return (
    <section className="prospecting-page">
      <header>
        <h2>Buscar empresas</h2>
        <p>Consulte o cadastro nacional por atividade, localização e perfil da empresa.</p>
      </header>
      <form onSubmit={apply} onChange={invalidateSelection}>
        <div className="prospecting-fields">
          <Field name="search" label="Pesquisar empresa" />
          <label>
            UF
            <select aria-label="UF" value={uf} name="ufs" onChange={(e) => setUf(e.target.value)}>
              <option value="">Todo o Brasil</option>
              {ufs.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <details open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
          <summary>Filtros detalhados</summary>
          <div className="prospecting-fields">
            <Field name="cnpj" label="CNPJ" />
            <Field name="legalName" label="Razão social" />
            <Field name="tradeName" label="Nome fantasia" />
            {uf ? (
              <Domain {...domainProps} kind="municipios" key={uf} name="cityCodes" label="Município" uf={uf} />
            ) : (
              <label>
                Município
                <select aria-label="Município" disabled>
                  <option>Selecione a UF primeiro</option>
                </select>
              </label>
            )}
            <Domain {...domainProps} kind="cnaes" name="mainCnaes" label="CNAE principal" />
            <Domain {...domainProps} kind="cnaes" name="secondaryCnaes" label="CNAE secundário" />
            <Field name="districts" label="Bairro" />
            <Domain {...domainProps} kind="naturezas" name="legalNatures" label="Natureza jurídica" />
            <Field
              name="sizes"
              label="Porte"
              choices={{
                "00": "Não informado",
                "01": "Microempresa",
                "03": "Empresa de pequeno porte",
                "05": "Demais",
              }}
            />
            <Field name="capitalMinCents" label="Capital mínimo (R$)" />
            <Field name="capitalMaxCents" label="Capital máximo (R$)" />
            <Field
              name="statuses"
              label="Situação cadastral"
              choices={{ "01": "Nula", "02": "Ativa", "03": "Suspensa", "04": "Inapta", "08": "Baixada" }}
            />
            <Field name="matrixBranches" label="Estabelecimento" choices={{ matrix: "Matriz", branch: "Filial" }} />
            <Field name="openedFrom" label="Abertura a partir de" type="date" />
            <Field name="openedTo" label="Abertura até" type="date" />
            <Field name="simples" label="Simples Nacional" choices={binary} />
            <Field name="mei" label="MEI" choices={binary} />
            <Field name="hasContact" label="Contato cadastral disponível" choices={binary} />
            <Field name="stages" label="Estágio no CRM" choices={stages} />
          </div>
          <AdditionalFilterValues changed={invalidateSelection} />
        </details>
        <Button type="submit" primary>
          <Search size={16} />
          Aplicar filtros
        </Button>
      </form>
      {issue && <p role="alert">{issue}</p>}
      {dirty && <p role="status">Aplique os filtros para usar a seleção.</p>}
      {!page ? (
        <ReadState {...result} />
      ) : (
        <>
          <header>
            <h3>
              {page.countState === "complete"
                ? page.count?.toLocaleString("pt-BR") + (page.count === 1 ? " empresa" : " empresas")
                : "Contagem em andamento"}
            </h3>
            <p>Competência {page.competence}</p>
          </header>
          {!page.items.length ? (
            <ProspectingState state="empty" message="Nenhuma empresa corresponde aos filtros." />
          ) : (
            <div className="prospecting-rows">
              {page.items.map((c) => (
                <div key={c.cnpj} className="prospecting-row">
                  <label className="prospecting-check">
                    <input
                      type="checkbox"
                      aria-label={"Selecionar " + c.cnpj}
                      checked={ids.includes(c.cnpj)}
                      disabled={!valid || action.disabled || (ids.length >= 100 && !ids.includes(c.cnpj))}
                      onChange={(e) =>
                        setSelected({
                          snapshot: page.snapshotId,
                          ids: e.target.checked ? [...ids, c.cnpj] : ids.filter((id) => id !== c.cnpj),
                        })
                      }
                    />
                    <span>
                      <strong>{c.legalName}</strong>
                      <small>
                        {c.cnpj} · {c.uf ?? "UF não informada"}
                      </small>
                    </span>
                  </label>
                  <span>Capital social · {c.capitalCents != null ? money(c.capitalCents) : "Não informado"}</span>
                  {c.prospectId && (
                    <Button onClick={() => navigate({ area: "leads", id: c.prospectId! })}>Abrir lead</Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="prospecting-actions">
            {query.cursor && (
              <Button onClick={() => setQuery({ filters: query.filters, snapshotId: page.snapshotId })}>
                Primeira página
              </Button>
            )}
            {page.nextCursor && (
              <Button
                disabled={dirty}
                onClick={() => setQuery({ ...query, snapshotId: page.snapshotId, cursor: page.nextCursor! })}
              >
                Próxima página
              </Button>
            )}
          </div>
          {valid && (
            <>
              <div className="prospecting-actions">
                <span>{ids.length} selecionada(s) de até 100 por inclusão</span>
                <Button
                  disabled={!ids.length || action.disabled}
                  onClick={() =>
                    void action.run(async (id) => {
                      const saved = await api.addProspects({
                        clientRequestId: id,
                        snapshotId: page.snapshotId,
                        cnpjs: ids,
                      });
                      setSelected({ snapshot: page.snapshotId, ids: [] });
                      result.reload();
                      return saved.created + " criada(s) e " + saved.existing + " já existente(s) no CRM.";
                    })
                  }
                >
                  Adicionar ao CRM
                </Button>
                <Button onClick={() => navigate({ area: "leads" })}>Ver leads</Button>
              </div>
              <form
                className="prospecting-actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async (id) => {
                    const saved = await api.createSegment({
                      name: name.trim(),
                      filters: query.filters,
                      filterVersion: 1,
                      clientRequestId: id,
                    });
                    return (
                      saved.name +
                      " · versão " +
                      saved.version +
                      " · " +
                      (saved.countState === "complete"
                        ? saved.count + (saved.count === 1 ? " empresa" : " empresas")
                        : "contagem em andamento")
                    );
                  });
                }}
              >
                <label>
                  Nome do segmento
                  <input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <Button type="submit" disabled={action.disabled || !name.trim()}>
                  Salvar segmento
                </Button>
              </form>
            </>
          )}
        </>
      )}
      {action.feedback}
    </section>
  );
}
