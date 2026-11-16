import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductFaqEditor } from "../../src/pages/product-detail/components/ProductFaqEditor.js";
import type { ProductFaq } from "../../src/api/endpoints/product-content.js";

function Fixture() {
  const [faqs, setFaqs] = useState<ProductFaq[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/__qa/faqs").then(response => response.json()).then(setFaqs); }, []);
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
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
