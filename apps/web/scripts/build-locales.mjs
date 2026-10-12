import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const sourcePath = resolve(webDirectory, "index.html");
const localesPath = resolve(webDirectory, "locales", "landing.json");
const source = await readFile(sourcePath, "utf8");
const locales = JSON.parse(await readFile(localesPath, "utf8"));
const siteUrl = "https://www.zyon-payments.com.br";

function replaceRequired(document, from, to, label) {
  if (!document.includes(from)) throw new Error(`Missing ${label}: ${from}`);
  return document.replaceAll(from, to);
}

function localizedAlternates(primaryLocale) {
  const languages = ["pt", "es", "en"];
  return languages
    .filter((language) => language !== primaryLocale)
    .map((language) => `<meta property="og:locale:alternate" content="${locales[language].ogLocale}" />`)
    .join("\n    ");
}

function buildLocale(language) {
  const locale = locales[language];
  let document = source;

  document = replaceRequired(document, '<html lang="pt-BR">', `<html lang="${locale.lang}">`, "html language");
  document = replaceRequired(document, '<title>Zyon | IA especialista em vendas para lojas virtuais</title>', `<title>${locale.title}</title>`, "title");
  document = replaceRequired(document, `content="${locales.pt.description}"`, `content="${locale.description}"`, "description");
  document = replaceRequired(
    document,
    `<link rel="canonical" href="${locales.pt.url}" />`,
    `<link rel="canonical" href="${locale.url}" />`,
    "canonical url",
  );
  document = replaceRequired(document, 'content="pt_BR"', `content="${locale.ogLocale}"`, "Open Graph locale");
  document = document.replace(/\s*<meta property="og:locale:alternate" content="(?:es_ES|en_US)" \/>/g, "");
  document = document.replace('<meta property="og:site_name"', `${localizedAlternates(language)}\n    <meta property="og:site_name"`);
  document = replaceRequired(document, 'content="Zyon | IA especialista em vendas para lojas virtuais"', `content="${locale.title}"`, "Open Graph title");
  document = replaceRequired(document, `content="${locales.pt.ogDescription}"`, `content="${locale.ogDescription}"`, "Open Graph description");
  document = replaceRequired(document, `content="${locales.pt.twitterDescription}"`, `content="${locale.twitterDescription}"`, "Twitter description");
  document = replaceRequired(document, 'content="https://www.zyon-payments.com.br/"', `content="${locale.url}"`, "Open Graph URL");
  document = replaceRequired(document, '"inLanguage": "pt-BR"', `"inLanguage": "${locale.lang}"`, "structured language");
  document = document.replace('href="/" aria-label="Zyon, página inicial"', `href="${locale.path}" aria-label="Zyon, página inicial"`);
  document = document.replace('data-language-current>PT', `data-language-current>${locale.code}`);
  document = document.replace('data-language="pt" href="/" hreflang="pt-BR" lang="pt-BR" aria-current="page"', 'data-language="pt" href="/" hreflang="pt-BR" lang="pt-BR"');
  document = document.replace(`data-language="${language}" href="${locale.path}" hreflang="${locale.lang}" lang="${locale.lang}"`, `data-language="${language}" href="${locale.path}" hreflang="${locale.lang}" lang="${locale.lang}" aria-current="page"`);

  for (const [from, to] of Object.entries(locale.replacements ?? {}).sort(([left], [right]) => right.length - left.length)) {
    document = document.replaceAll(from, to);
  }

  document = document
    .replace(/(href|src|srcset)="assets\//g, '$1="../assets/')
    .replace('href="/llms.txt"', 'href="/llms.txt"');

  return document;
}

for (const language of ["es", "en"]) {
  const output = buildLocale(language);
  const outputPath = resolve(webDirectory, language, "index.html");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
  process.stdout.write(`Generated ${language}/index.html\n`);
}

process.stdout.write(`${siteUrl}: localized pages updated\n`);
