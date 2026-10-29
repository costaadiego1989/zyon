export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // remove non-alphanumeric
    .replace(/\s+/g, "-")           // spaces → hyphens
    .replace(/-+/g, "-")            // collapse multiple hyphens
    .replace(/^-|-$/g, "");         // trim leading/trailing hyphens
}

export async function generateUniqueSlug(
  base: string,
  isUnique: (slug: string) => Promise<boolean>,
): Promise<string> {
  const candidate = slugify(base);
  if (!candidate) return `store-${randomSuffix()}`;

  if (await isUnique(candidate)) return candidate;

  for (let i = 0; i < 5; i++) {
    const suffixed = `${candidate}-${randomSuffix()}`;
    if (await isUnique(suffixed)) return suffixed;
  }

  return `${candidate}-${Date.now().toString(36).slice(-6)}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
