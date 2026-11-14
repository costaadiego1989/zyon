"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import type { StorefrontPublicUiAction as StorefrontReadUiAction } from "@zyon/shared-types";
import type { BuyerProductQuestionsBlock, ProductQuestionInputBlock, ProductQuestionsBlock,
  QuestionSubmissionBlock, ReviewSubmissionBlock } from "@/lib/types";

type QuestionBlock = BuyerProductQuestionsBlock | ProductQuestionInputBlock | ProductQuestionsBlock
  | QuestionSubmissionBlock | ReviewSubmissionBlock;

const layout: CSSProperties = { color: "var(--aacp-fg)", fontFamily: "var(--aacp-font)",
  fontSize: "0.875rem", lineHeight: 1.6, overflowWrap: "anywhere", minWidth: 0 };

function QuestionInput({ block, onQuickReply }: { block: ProductQuestionInputBlock;
  onQuickReply?: (text: string, action?: StorefrontReadUiAction) => void }) {
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return <form style={layout} onSubmit={event => {
    event.preventDefault();
    if (submitted || !question.trim() || !onQuickReply) return;
    setSubmitted(true);
    onQuickReply(`Enviar pergunta sobre ${block.data.productName}`, { tool: "create_question",
      args: { productId: block.data.productId, question: question.trim() } });
  }}>
    <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
      💬 Sua pergunta sobre {block.data.productName}
      <textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} required
        disabled={submitted} rows={3} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8,
          padding: 10, border: "1px solid var(--aacp-line)", borderRadius: 8, font: "inherit",
          color: "var(--aacp-fg)", background: "var(--aacp-surface)" }} />
    </label>
    <button type="submit" data-neu="button" disabled={!onQuickReply || submitted || !question.trim()}
      style={{ minHeight: 44, padding: "8px 16px", font: "inherit", cursor: "pointer" }}>
      {submitted ? "Envio solicitado" : "Enviar pergunta"}
    </button>
    {submitted && <p role="status">Aguarde o protocolo no chat para confirmar o registro.</p>}
  </form>;
}

export default function ProductQuestions({ block, onQuickReply }: { block: QuestionBlock;
  onQuickReply?: (text: string, action?: StorefrontReadUiAction) => void }) {
  if (block.type === "review_submission") {
    return <p role="status" style={layout}>⭐ <strong>Avaliação recebida.</strong> Ela aguarda moderação antes de aparecer publicamente.</p>;
  }
  if (block.type === "question_submission") {
    return <div role="status" style={layout}><p><strong>💬 Pergunta registrada</strong></p>
      <p>Aguardando resposta da loja.</p><p>Protocolo: <code>{block.data.ticketId}</code></p></div>;
  }
  if (block.type === "product_question_input") {
    return <QuestionInput block={block} onQuickReply={onQuickReply} />;
  }
  const own = block.type === "buyer_product_questions";
  return <section aria-label={own ? "Suas perguntas sobre o produto" : "Perguntas respondidas sobre o produto"} style={layout}>
    <h3 style={{ fontSize: "1rem", margin: "0 0 8px" }}>💬 {own ? "Suas perguntas" : "Perguntas respondidas"}</h3>
    <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{block.data.productName}</p>
    {own && <p>Este histórico inclui apenas as perguntas recentes registradas com sua conta.</p>}
    {block.data.questions.length === 0 && <p>{own ? "Nenhuma pergunta sua encontrada neste histórico. Você pode escrever uma dúvida no chat."
      : "A loja ainda não publicou respostas para este produto. Escreva sua dúvida no chat."}</p>}
    {onQuickReply && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      <button type="button" data-neu="button" style={{ minHeight: 44, padding: "8px 12px", font: "inherit" }}
        onClick={() => onQuickReply(`Fazer uma pergunta sobre ${block.data.productName}`,
          { tool: "ask_product_question", args: { productId: block.data.productId } })}>Fazer pergunta</button>
      {!own && <button type="button" data-neu="button" style={{ minHeight: 44, padding: "8px 12px", font: "inherit" }}
        onClick={() => onQuickReply(`Minhas perguntas sobre ${block.data.productName}`,
          { tool: "get_product_questions", args: { productId: block.data.productId, filter: "mine" } })}>Minhas perguntas</button>}
    </div>}
    <dl style={{ margin: 0 }}>
      {block.data.questions.map(question => <div key={question.id} style={{ padding: "12px 0", borderTop: "1px solid var(--aacp-line)" }}>
        <dt style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{question.question}</dt>
        <dd style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{"answer" in question ? question.answer
          : <>Resposta não vinculada; acompanhe o atendimento.<br />Protocolo: <code>{question.ticketId}</code></>}</dd>
      </div>)}
    </dl>
    {own && block.data.hasMore && <p>Há outras perguntas. Consulte o atendimento para acompanhar os demais protocolos.</p>}
  </section>;
}
