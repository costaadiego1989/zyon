import { readFile, writeFile } from "node:fs/promises";

const web = new URL("../", import.meta.url);
const documents = JSON.parse(await readFile(new URL("../storefront/src/lib/legal-documents.json", web), "utf8"));
const template = await readFile(new URL("privacidade.html", web), "utf8");
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

for (const [slug, document] of Object.entries(documents)) {
  let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(document.title)} | Zyon</title>`)
    .replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${escape(document.title)}</h1>`)
    .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*("\s*\/>)/g, `$1${escape(document.description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*("\s*\/>)/, `$1${escape(document.title)} | Zyon$2`)
    .replace(/<p class="lead">[\s\S]*?<\/p>/, `<p class="lead">${escape(document.description)}</p>`)
    .replaceAll("https://www.zyon-payments.com.br/privacidade", `https://www.zyon-payments.com.br/${slug}`)
    .replace(/<p class="updated">[\s\S]*?<\/p>/, '<p class="updated">Última atualização: <time datetime="2026-10-05">5 de outubro de 2026</time></p>');
  const nav = Object.entries(documents).map(([key, value]) => `      <a href="/${key}"${key === slug ? ' aria-current="page"' : ""}>${key === "privacidade" ? "Privacidade" : key === "cookies" ? "Cookies" : "Termos de uso"}</a>`).join("\n");
  html = html.replace(/<nav class="document-nav"[\s\S]*?<\/nav>/, `<nav class="document-nav" aria-label="Documentos da Zyon">\n${nav}\n      <a href="/exclusao-de-dados">Exclusão de dados</a>\n    </nav>`);
  const content = document.sections.map((section) => `      <section>\n        <h2>${escape(section.title)}</h2>\n${section.paragraphs.map((paragraph) => `        <p>${escape(paragraph)}</p>`).join("\n")}\n      </section>`).join("\n");
  html = html.replace(/<article class="document-body"[\s\S]*?<\/article>/, `<article class="document-body" aria-label="${escape(document.title)}">\n${content}\n    </article>`);
  await writeFile(new URL(`${slug}.html`, web), html, "utf8");
}
