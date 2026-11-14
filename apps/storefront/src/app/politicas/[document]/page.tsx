import type { Metadata } from "next";
import { notFound } from "next/navigation";
import documents from "@/lib/legal-documents.json";
import operator from "@/lib/legal-operator.json";
import styles from "./policy.module.css";

type DocumentKey = keyof typeof documents;
const links: Array<[DocumentKey, string]> = [["privacidade", "Privacidade"], ["cookies", "Cookies"], ["termos", "Termos"]];
function getDocument(key: string) {
  if (!Object.hasOwn(documents, key)) notFound();
  return documents[key as DocumentKey];
}
export function generateStaticParams() { return links.map(([document]) => ({ document })); }
export async function generateMetadata({ params }: { params: Promise<{ document: string }> }): Promise<Metadata> {
  const document = getDocument((await params).document);
  return { title: `${document.title} | Zyon`, description: document.description };
}
export default async function PolicyPage({ params }: { params: Promise<{ document: string }> }) {
  const key = (await params).document;
  const document = getDocument(key);
  return <main className={styles.page}>
    <div className={styles.content}>
      <a className={styles.brand} href="https://www.zyon-payments.com.br">Zyon</a>
      <h1>{document.title}</h1>
      <p>{document.description}</p>
      <p className={styles.updated}>Última atualização: <time dateTime="2026-10-05">5 de outubro de 2026</time></p>
      <nav aria-label="Documentos legais">{links.map(([slug, name]) => <a key={slug} href={`/politicas/${slug}`} aria-current={slug === key ? "page" : undefined}>{name}</a>)}</nav>
      <article>{document.sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}</article>
      <footer>
        <p>Operadora da Zyon: <strong>{operator.legalName}</strong> · CNPJ {operator.cnpj}</p>
        <p>{operator.address}</p>
        <p>Contato de privacidade e suporte: <a href={`mailto:${operator.privacyEmail}`}>{operator.privacyEmail}</a></p>
        <p><a href="/privacidade">Gerenciar dados de personalização</a> · <a href="https://www.zyon-payments.com.br/exclusao-de-dados">Solicitar exclusão de dados</a></p>
        <p>Referências: <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm">LGPD</a>, <a href="https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais">guia de cookies da ANPD</a>, <a href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm">CDC</a> e <a href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm">Decreto de comércio eletrônico</a>.</p>
      </footer>
    </div>
  </main>;
}
