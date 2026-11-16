import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductFaqEditor } from "../../src/pages/product-detail/components/ProductFaqEditor.js";
import { ProductVideoEditor } from "../../src/pages/product-detail/components/ProductVideoEditor.js";
import type { ProductFaq, ProductVideo } from "../../src/api/endpoints/product-content.js";
import { ApiContext } from "../../src/hooks/useApi.js";
import { createDashboardApi } from "../../src/api-client.js";
import { OrdersShipmentsPage } from "../../src/pages/orders-shipments-page.js";
import type { MerchantProfile } from "../../src/api-client.js";
import { IntegrationsPage } from "../../src/pages/integrations-page.js";
import { PromotionSection } from "../../src/pages/product-detail/components/PromotionSection.js";
import { ExperimentsPage } from "../../src/pages/experiments/ExperimentsPage.js";
import { AdvancedLayoutTab } from "../../src/pages/product-detail/components/AdvancedLayoutTab.js";

const api = createDashboardApi({ baseUrl: window.location.origin });

function VisibilityFixture() {
  const [productId, setProductId] = useState<string | null>(new URLSearchParams(location.search).has("draft") ? null : "qa-product");
  return <><AdvancedLayoutTab merchantId="qa-merchant" productId={productId} />
    {!productId && <button onClick={() => setProductId("qa-product")}>Salvar produto QA</button>}</>;
}

function Fixture() {
  const [faqs, setFaqs] = useState<ProductFaq[]>([]);
  const [busy, setBusy] = useState(false);
  const [videos, setVideos] = useState<ProductVideo[]>([]);
  useEffect(() => { void fetch("/__qa/faqs").then(response => response.json()).then(setFaqs); }, []);
  useEffect(() => { void fetch("/__qa/videos").then(response => response.json()).then(setVideos); }, []);
  return <main style={{ maxWidth: 800, padding: 24 }}><h1>Editor de conteúdo QA</h1>
    <section aria-label="FAQs"><ProductFaqEditor faqs={faqs} busy={busy}
      onSave={async faq => {
        setBusy(true);
        try {
          // Match the production parent's create/update wire projection.
          const response = await fetch("/__qa/faqs", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: faq.id, question: faq.question, answer: faq.answer, order: faq.order, isPublished: faq.isPublished }) });
          if (!response.ok) throw Error("product_content_resource_not_found");
          const saved = await response.json();
          setFaqs(current => [...current.filter(item => item.id !== saved.id), saved]);
        } finally { setBusy(false); }
      }} onDelete={async id => {
        const response = await fetch("/__qa/faqs/" + encodeURIComponent(id), { method: "DELETE" });
        if (!response.ok) throw Error("delete failed");
        setFaqs(current => current.filter(item => item.id !== id));
      }} onReorder={async () => {}} /></section>
    <section aria-label="Videos"><ProductVideoEditor videos={videos} merchantId="qa-merchant" busy={busy}
      onSave={async video => {
        setBusy(true);
        try {
          const response = await fetch("/__qa/videos", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: "qa-product", id: video.id, title: video.title, videoUrl: video.videoUrl,
              thumbnailUrl: video.thumbnailUrl, durationSeconds: video.durationSeconds, order: video.order,
              isPublished: video.isPublished, moderationStatus: video.moderationStatus }) });
          if (!response.ok) throw Error("video_invalid");
          const saved = await response.json(); setVideos(current => [...current.filter(item => item.id !== saved.id), saved]);
        } finally { setBusy(false); }
      }} onDelete={async id => {
        await fetch("/__qa/videos/" + encodeURIComponent(id), { method: "DELETE" });
        setVideos(current => current.filter(item => item.id !== id));
      }} onModerate={async () => {}} /></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ApiContext.Provider value={api}>
  {new URLSearchParams(location.search).get("mode") === "orders"
    ? <OrdersShipmentsPage apiBaseUrl={location.origin} me={{ id: "qa-merchant" } as MerchantProfile} />
    : new URLSearchParams(location.search).get("mode") === "integrations"
      ? <IntegrationsPage apiBaseUrl={location.origin} me={{ id: "qa-merchant" } as MerchantProfile} />
      : new URLSearchParams(location.search).get("mode") === "promotion"
        ? <PromotionSection merchantId="qa-merchant" productId="qa-product" variantSkus={[]} />
        : new URLSearchParams(location.search).get("mode") === "experiments"
          ? <ExperimentsPage apiBaseUrl={location.origin} me={{ id: "qa-merchant" } as MerchantProfile} />
          : new URLSearchParams(location.search).get("mode") === "visibility"
            ? <VisibilityFixture /> : <Fixture />}
</ApiContext.Provider>);
