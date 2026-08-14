import { notFound } from "next/navigation";
import ConversationShell from "@/components/ConversationShell";
import { getDemoMerchant } from "@/lib/demo-merchant";

type Params = { slug: string };
type SearchParams = { order?: string };

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const { order } = await searchParams;
  const merchant = getDemoMerchant(slug);
  if (!merchant) {
    notFound();
  }

  const m = merchant!;

  const themeCss = `
    :root {
      --color-primary: ${m.theme.primary};
      --color-secondary: ${m.theme.secondary};
      --font-heading: ${m.theme.heading};
      --font-body: ${m.theme.body};
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <div className="store-layout">
        <header className="store-header">
          <span className="store-header__brand">{m.name}</span>
        </header>
        <main className="store-main">
          <ConversationShell
            storeName={m.name}
            returnOrderId={order}
          />
        </main>
      </div>
    </>
  );
}
