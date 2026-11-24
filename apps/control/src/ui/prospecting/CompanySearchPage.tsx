import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { CompanyDirectoryCoverage, CompanyDirectoryImportSummary, CompanyDomainQuery, CompanyDomainResult, CompanyFilters, CompanySearchQuery } from "@zyon/shared-types";
import { PlatformApiError } from "../../lib/api.js";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button, ReadState, cents, money, stages, useAction, useResource, type PageProps } from "./screen-controls.js";
import { ProspectingState } from "./ProspectingShell.js";
import {CampaignCompanyTransfer} from "./CampaignCompanyTransfer.js";

const ufs = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const companyPageSize = 20;
function Domain({
  api,
  kind,
  label,
  name,
  uf,
  snapshotId,
  onSessionExpired,
  changed,
}: Pick<PageProps, "api" | "onSessionExpired"> & {
  kind: CompanyDomainQuery["kind"];
  label: string;
  name: string;
  uf?: string;
  snapshotId?: string;
  changed: () => void;
}) {
  const [search, setSearch] = useState(""),
    [after, setAfter] = useState<string>(),
    [chosen, setChosen] = useState<{ code: string; label: string } | null>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const id = useId(), input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const load = useCallback(
    (s: AbortSignal) =>
      api.domains(
        { kind, uf: uf || undefined, search: search || undefined, snapshotId, afterCode: after, limit: 30 },
        s
      ),
    [api, kind, uf, search, snapshotId, after]
  );
  const result = useResource(load, onSessionExpired);
  const identity=JSON.stringify([kind,uf,snapshotId,search]);
  const [optionPages,setOptionPages]=useState<{identity:string;items:CompanyDomainResult['items']}>({identity:'',items:[]});
  useEffect(()=>setAfter(undefined),[uf,snapshotId]);
  useEffect(()=>{
    if(!result.data)return;
    const incoming=result.data.items;
    setOptionPages(previous=>({identity,items:[...new Map([
      ...(after&&previous.identity===identity?previous.items:[]),...incoming,
    ].map(item=>[item.code,item])).values()]}));
  },[result.data,identity,after]);
  const choices = optionPages.identity===identity?optionPages.items:result.data?.items??[];
  const options = [{ code: "", label: "Todos" }, ...choices];
  const highlighted = Math.min(active, options.length - 1);
  function close() { setOpen(false); setSearch(""); setAfter(undefined); }
  function choose(value: {code: string; label: string}) {
    setChosen(value.code ? value : null);
    close();
    changed();
    input.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = input.current!.getBoundingClientRect(), below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12, flip = below < 220 && above > below;
      setPosition({left: Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8)), width: Math.min(rect.width, innerWidth - 16),
        ...(flip ? {bottom: innerHeight - rect.top + 6} : {top: rect.bottom + 6}), maxHeight: Math.max(100, Math.min(340, flip ? above : below))});
    }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  useEffect(() => { setActive(search ? 1 : 0); }, [search]);
  useEffect(() => {
    if (open) document.getElementById(id + "-option-" + highlighted)?.scrollIntoView?.({block: "nearest"});
  }, [open, highlighted, id]);
  return (
    <div className="prospecting-domain" ref={root}>
      <label htmlFor={id}>{label}</label>
      <input type="hidden" name={name} value={chosen?.code ?? ""} data-label={chosen?.label} />
      <div className="prospecting-domain-control">
        <input
          id={id} ref={input} role="combobox" autoComplete="off"
          aria-expanded={open} aria-controls={open ? id + "-options" : undefined} aria-autocomplete="list"
          aria-activedescendant={open ? id + "-option-" + highlighted : undefined}
          placeholder={open ? "Digite nome ou código…" : "Todos"}
          value={open ? search : chosen ? chosen.label + " · " + chosen.code : ""}
          onClick={() => setOpen(true)}
          onBlur={(event) => { if (!menu.current?.contains(event.relatedTarget as Node)) close(); }}
          onChange={(e) => {
            e.stopPropagation();
            setAfter(undefined);
            setSearch(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              if (open && event.key === "ArrowDown" && highlighted === options.length - 1 && result.data?.nextCursor) {
                setAfter(result.data.nextCursor); setActive(options.length);
              } else setActive(index => open ? Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))) : 0);
            } else if (event.key === "Enter" && open) { event.preventDefault(); if (!search || choices.length) choose(options[highlighted]); }
            else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
            else if (event.key === "Tab") close();
          }}
        />
        {chosen ? <button type="button" className="prospecting-domain-clear" aria-label={"Limpar " + label.toLowerCase()} onClick={() => choose({code: "", label: "Todos"})}><X size={15} /></button> : <ChevronDown size={16} aria-hidden="true" />}
      </div>
      {open && createPortal(<div ref={menu} className="prospecting-domain-menu" style={position}>
        <ul id={id + "-options"} role="listbox" aria-label={"Opções de " + label.toLowerCase()}>
          {options.map((option, index) => <li key={option.code} id={id + "-option-" + index} role="option" aria-selected={(chosen?.code ?? "") === option.code}
            className={highlighted === index ? "is-highlighted" : undefined} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
            <span><span>{option.label}</span>{option.code && <small>{option.code}{uf ? " · " + uf : ""}</small>}</span>
            {(chosen?.code ?? "") === option.code && <Check size={16} aria-hidden="true" />}
          </li>)}
        </ul>
        {result.error ? <ReadState {...result} /> : !result.data ? <p role="status">Buscando opções…</p> : !choices.length ? <p role="status">Nenhuma opção encontrada.</p> : null}
        {result.data?.nextCursor && <button type="button" className="prospecting-domain-more" onMouseDown={event => event.preventDefault()} onClick={() => setAfter(result.data!.nextCursor!)}>Carregar mais opções</button>}
      </div>, document.body)}
    </div>
  );
}
function Field({
  name,
  label,
  choices,
  type = "text",
  disabled = false,
}: {
  name: string;
  label: string;
  choices?: Record<string, string>;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      {choices ? (
        <select aria-label={label} name={name} disabled={disabled}>
          <option value="">Todos</option>
          {Object.entries(choices).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        <input name={name} type={type} disabled={disabled} />
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
      '[name="' + dimension + '"]'
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
    const label = field instanceof HTMLSelectElement ? field.selectedOptions[0].textContent ?? value : field?.dataset.label ?? value;
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
    return <PublishedCompanySearchPage {...props} coverage={source.value.coverage} sourceSnapshotId={source.value.snapshotId} importSummary={source.value.latestImport} />;
  const preparing = source?.status === "unavailable" && source.value?.snapshotId === null && source.value.state === "unavailable";
  const job = preparing ? source.value?.latestImport : undefined;
  const storageFailed = job?.state === "failed" && ["production_directory_storage_limit", "retail_directory_25gb_limit"].includes(job.errorCode ?? "");
  const importing = job && ["discovered", "importing", "validating", "ready"].includes(job.state);
  return (
    <section className="prospecting-page">
      <header><h2>Buscar empresas</h2><p>Consulte o cadastro nacional por atividade, localização e perfil da empresa.</p></header>
      {preparing ? (
        <div className="prospecting-state">
          <h3>{storageFailed ? "Importação interrompida por armazenamento" : job?.state === "failed" ? "Importação interrompida" : importing ? "Importando base de empresas" : "Base nacional em preparação"}</h3>
          <p role={job?.state === "failed" ? "alert" : "status"}>{storageFailed ? "A carga atingiu o limite de armazenamento. A base ainda não foi publicada." : job?.state === "failed" ? "A carga não foi concluída. A busca será liberada após a recuperação e a validação dos arquivos oficiais." : "A importação e a validação dos arquivos oficiais preparam a base. A busca será liberada com o primeiro lote completo de empresas. Os demais cadastros serão disponibilizados durante a carga."}</p>
          {job && <p>{job.validatedFiles} de {job.totalFiles} arquivos validados{job.selectedCompanies > 0 ? " · " + job.selectedCompanies.toLocaleString("pt-BR") + " empresas selecionadas" : ""}.<br />Atualizado em {new Date(job.updatedAt).toLocaleString("pt-BR")}.</p>}
          <Button onClick={availability.reload}>Verificar disponibilidade</Button>
        </div>
      ) : (
        <ReadState error={availability.error ?? (availability.data ? new Error("directory_availability_unknown") : undefined)} reload={availability.reload} />
      )}
    </section>
  );
}
function PublishedCompanySearchPage(props: PageProps & {coverage?:CompanyDirectoryCoverage;sourceSnapshotId?:string;importSummary?:CompanyDirectoryImportSummary}) {
  const { api, onSessionExpired, navigate } = props;
  const [coverage,setCoverage]=useState(props.coverage),[importSummary,setImportSummary]=useState(props.importSummary),[currentSnapshotId,setCurrentSnapshotId]=useState(props.sourceSnapshotId);
  const [refreshing,setRefreshing]=useState(false),[refreshError,setRefreshError]=useState('');
  const refreshController=useRef<AbortController | undefined>(undefined);
  useEffect(()=>()=>refreshController.current?.abort(),[]);
  const [query, setQuery] = useState<CompanySearchQuery>({ filters: {},...(props.coverage?.scopeComplete===false?{snapshotId:props.sourceSnapshotId}:{}) }),
    [uf, setUf] = useState(""),
    [dirty, setDirty] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<{ snapshot: string; ids: string[] }>({ snapshot: "", ids: [] }),
    [name, setName] = useState(""),
    [issue, setIssue] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);
  const searchName = useRef<HTMLInputElement>(null);
  const saveSearchTrigger = useRef<HTMLButtonElement>(null), restoreSaveSearchFocus = useRef(false);
  useEffect(() => { if (savingSearch) searchName.current?.focus(); }, [savingSearch]);
  const [pagination,setPagination]=useState<{index:number;cursors:(string|undefined)[]}>({index:0,cursors:[undefined]});
  const load = useCallback((s: AbortSignal) => api.companies({...query,limit:companyPageSize}, s), [api, query]);
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
    setSavingSearch(false);
    restoreSaveSearchFocus.current = false;
  }
  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      resetPage({ filters: filtersFrom(e.currentTarget),...(coverage?.scopeComplete===false?{snapshotId:currentSnapshotId}:{}) });
      setDirty(false);
      setIssue("");
      setSelected({ snapshot: "", ids: [] });
    } catch (error) {
      setIssue((error as Error).message);
    }
  }
  function resetPage(next:CompanySearchQuery){
    setPagination({index:0,cursors:[undefined]});setQuery(next);
  }
  function movePage(index:number,cursor:string|undefined){
    if(!page||dirty||refreshing)return;
    setPagination(current=>({index,cursors:index>current.index?[...current.cursors.slice(0,index),cursor]:current.cursors}));
    setQuery({...query,snapshotId:page.snapshotId,cursor});
  }
  const totalPages=page?.countState==='complete'&&typeof page.count==='number'&&Number.isFinite(page.count)
    ?Math.max(1,Math.ceil(page.count/companyPageSize)):undefined;
  useEffect(()=>{
    if(page&&totalPages!==undefined&&pagination.index>=totalPages){
      setPagination({index:0,cursors:[undefined]});
      setQuery(current=>({...current,snapshotId:page.snapshotId,cursor:undefined}));
    }
  },[page,totalPages,pagination.index]);
  const pageNumber=Math.min(pagination.index+1,totalPages??pagination.index+1);
  const valid = Boolean(page?.items.length) && !dirty && !action.denied,
    ids = selected.snapshot === page?.snapshotId ? selected.ids : [];
  useEffect(() => {
    if (!savingSearch && valid && !action.disabled && restoreSaveSearchFocus.current) {
      restoreSaveSearchFocus.current = false;
      saveSearchTrigger.current?.focus();
    }
  }, [savingSearch, valid, action.disabled]);
  function closeSavedSearch() { restoreSaveSearchFocus.current = true; setSavingSearch(false); }
  const domainProps = { api, onSessionExpired, changed: invalidateSelection, snapshotId: page?.snapshotId??(coverage?.scopeComplete===false?currentSnapshotId:undefined) };
  async function refreshAvailability(){
    if(ids.length||refreshing)return;
    const controller=new AbortController();refreshController.current=controller;setRefreshing(true);setRefreshError('');
    try{
      const readiness=await api.readiness(controller.signal),source=readiness?.source;
      if(controller.signal.aborted)return;
      if(source?.status!=='current'||source.value?.state!=='published'||!source.value.snapshotId)throw new Error('directory_availability_unknown');
      setCoverage(source.value.coverage);setImportSummary(source.value.latestImport);setCurrentSnapshotId(source.value.snapshotId);
      const nextSnapshotId=source.value.snapshotId;
      setPagination({index:0,cursors:[undefined]});setQuery(current=>({filters:current.filters,snapshotId:nextSnapshotId}));setSelected({snapshot:nextSnapshotId,ids:[]});
    }catch(error){if(!controller.signal.aborted){if(error instanceof PlatformApiError&&error.status===401)onSessionExpired();setRefreshError('Não foi possível atualizar a base. Tente novamente.');}}
    finally{if(!controller.signal.aborted)setRefreshing(false);}
  }
  const binary = { true: "Sim", false: "Não" };
  return (
    <section className="prospecting-page">
      <header>
        <h2>Buscar empresas</h2>
        <p>Consulte o cadastro nacional por atividade, localização e perfil da empresa.{!coverage&&page?.countState==='complete'&&page.count!=null&&<> · {page.count.toLocaleString('pt-BR')} {page.count===1?'empresa encontrada':'empresas encontradas'}.</>}</p>
        {coverage?.kind === "regional_retail" && <p role="status"><strong>Varejo do Sudeste e Sul</strong> · {coverage.companyCount.toLocaleString("pt-BR")} {coverage.scopeComplete?'empresas ativas com telefone':'empresas disponíveis para buscar e selecionar'}.<br />{coverage.scopeComplete?'Cobertura':'Regiões previstas'}: {coverage.ufs.join(", ")}. Dados da Receita Federal; limite da base de 25 GB.</p>}
        {coverage?.scopeComplete===false&&<div className="prospecting-import-progress">
          <p role={importSummary?.state==='failed'?'alert':'status'}><strong>{importSummary?.state==='failed'?'Carga interrompida':importSummary?.state==='published'?'Novos cadastros disponíveis':'Base em carga'}</strong><br />A cobertura ainda é parcial. {importSummary?.state==='failed'?'Os cadastros já liberados continuam disponíveis.':'Novos cadastros são liberados durante a importação.'}</p>
          <div className="prospecting-actions"><Button disabled={refreshing||ids.length>0} onClick={()=>void refreshAvailability()}>{refreshing?'Atualizando base…':'Atualizar base'}</Button>{ids.length>0&&<span>Desmarque a seleção para atualizar a base.</span>}</div>
          {refreshError&&<p role="alert">{refreshError}</p>}
        </div>}
      </header>
      <form className="prospecting-company-filters" onSubmit={apply} onChange={invalidateSelection}>
        <div className="prospecting-fields">
          <Field name="search" label="Pesquisar empresa" />
          <label>
            UF
            <select aria-label="UF" value={uf} name="ufs" onChange={(e) => setUf(e.target.value)}>
              <option value="">{coverage ? "Todas as UFs da base" : "Todo o Brasil"}</option>
              {(coverage?.ufs ?? ufs).map((v) => (
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
            <Field name="simples" label="Simples Nacional" choices={binary} disabled={!!coverage} />
            <Field name="mei" label="MEI" choices={binary} disabled={!!coverage} />
            <Field name="hasContact" label="Contato cadastral disponível" choices={binary} />
            <Field name="stages" label="Estágio no CRM" choices={stages} />
          </div>
          <AdditionalFilterValues changed={invalidateSelection} />
          {coverage && <p>Simples Nacional e MEI ainda não estão disponíveis nesta base.</p>}
        </details>
        <div className="prospecting-filter-actions">
          <Button type="submit" primary><Search size={16} />Aplicar filtros</Button>
          <button ref={saveSearchTrigger} type="button" className="button button--secondary" aria-expanded={savingSearch} aria-controls="save-company-search" disabled={!valid || refreshing || action.disabled} onClick={() => setSavingSearch(value => !value)}>Salvar busca</button>
        </div>
      </form>
      {savingSearch && valid && <form id="save-company-search" className="prospecting-save-search" onSubmit={(event) => {
        event.preventDefault();
        void action.run(async (id) => {
          const saved = await api.createSegment({name: name.trim(), filters: query.filters, filterVersion: 1, clientRequestId: id});
          closeSavedSearch(); setName("");
          return saved.name + " · versão " + saved.version + " · " + (saved.countState === "complete" ? saved.count + (saved.count === 1 ? " empresa" : " empresas") : "contagem em andamento");
        });
      }}>
        <p>Guarde estes filtros para escolher o mesmo público ao criar uma campanha.</p>
        <div className="prospecting-actions">
          <label>Nome da busca<input ref={searchName} required maxLength={160} placeholder="Ex.: lojas de roupas em São Paulo" value={name} onChange={event => setName(event.target.value)} /></label>
          <Button type="submit" disabled={action.disabled || !name.trim()}>Salvar</Button>
          <Button onClick={closeSavedSearch}>Cancelar</Button>
        </div>
      </form>}
      {issue && <p role="alert">{issue}</p>}
      {!page ? (
        <ReadState {...result} />
      ) : (
        <>
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
                      disabled={refreshing || !valid || action.disabled || (ids.length >= 100 && !ids.includes(c.cnpj))}
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
          <nav className="prospecting-pagination" aria-label="Paginação de empresas">
            <span role="status">{`Página ${pageNumber}${totalPages===undefined?'':` de ${totalPages.toLocaleString('pt-BR')}`}`}</span>
            <div className="prospecting-pagination-controls">
            {pagination.index>0 && (
              <Button disabled={dirty||refreshing} onClick={() => movePage(0,undefined)}>
                Primeira página
              </Button>
            )}
            <Button disabled={dirty||refreshing||pagination.index===0} onClick={()=>movePage(pagination.index-1,pagination.cursors[pagination.index-1])}>Página anterior</Button>
              <Button
                disabled={dirty||refreshing||!page.nextCursor}
                onClick={() => movePage(pagination.index+1,page.nextCursor!)}
              >
                Próxima página
              </Button>
            </div>
          </nav>
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
              <CampaignCompanyTransfer {...props} snapshotId={page.snapshotId} cnpjs={ids} disabled={action.disabled||dirty||refreshing}/>
            </>
          )}
        </>
      )}
      {action.feedback}
    </section>
  );
}
