import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchStoreConfig } from "@/lib/api/server-client";
import styles from "@/app/politicas/[document]/policy.module.css";

export const metadata: Metadata = { title: "Políticas da loja | Zyon" };
const fields = { privacy: "Privacidade", terms: "Termos de uso", returns: "Trocas e devoluções", shipping: "Envio e frete", warranty: "Garantia", payment: "Pagamento", general: "Informações gerais" };
function documentUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default async function StorePolicies({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await fetchStoreConfig(slug);
  if (!store) notFound();
  const policies = store.publishedPolicies ?? store.storeSettings?.policies ?? {};
  const company = store.storeSettings?.company;
  const address = company?.address;
  const available = Object.entries(fields).filter(([key]) => typeof policies[key] === "string" && policies[key].trim());
  return <main className={styles.page}><div className={styles.content}>
    <a className={styles.brand} href={`/store/${encodeURIComponent(slug)}`}>Voltar para {store.name}</a>
    <h1>Políticas de {store.name}</h1>
    <p>Condições publicadas pelo lojista. Elas complementam os documentos da plataforma e preservam seus direitos legais.</p>
    {company && <section aria-label="Identificação do fornecedor">
      {company.razaoSocial && <p><strong>{company.razaoSocial}</strong>{company.cnpj ? ` · CNPJ ${company.cnpj}` : ""}</p>}
      {address?.street && <p>{[address.street, address.number, address.complement, address.neighborhood, address.city, address.state, address.zip].filter(Boolean).join(", ")}</p>}
      {company.email && <p>Atendimento: <a href={`mailto:${company.email}`}>{company.email}</a>{company.phone ? ` · ${company.phone}` : ""}</p>}
    </section>}
    <nav aria-label="Políticas da loja">{available.map(([key, label]) => <a key={key} href={`#${key}`}>{label}</a>)}</nav>
    {store.policiesAvailable === false && <p role="status">Não foi possível consultar todas as políticas da loja. Tente novamente ou consulte o atendimento.</p>}
    <article>{available.length ? available.map(([key, label]) => {
      const text = policies[key].trim();
      const url = documentUrl(text);
      return <section key={key} id={key}><h2>{label}</h2>{url ? <p><a href={url} target="_blank" rel="noopener noreferrer">Ler {label.toLowerCase()} no site informado pela loja</a></p> : <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>}</section>;
    }) : store.policiesAvailable === false ? null : <p>A loja ainda não publicou políticas próprias aqui. Consulte os canais de atendimento para conhecer as condições da oferta; seus direitos legais permanecem preservados.</p>}</article>
    <footer><p>Documentos da plataforma: <a href="/politicas/privacidade">Privacidade da Zyon</a> · <a href="/politicas/termos">Termos da Zyon</a> · <a href="/politicas/cookies">Cookies</a></p></footer>
  </div></main>;
}
