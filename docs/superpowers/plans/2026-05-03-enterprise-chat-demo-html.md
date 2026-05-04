# Demo HTML Enterprise Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página HTML autónoma (`enterprise-chat-demo.html`) com shell enterprise (sidebar + zona de mensagens tipo IM) para visualizar UX “agent assist” nível empresa, mais integração opcional ao web component `@aacp/checkout` quando API + Vite dev estiverem ligados.

**Architecture:** Um ficheiro HTML com CSS variáveis, layout em CSS Grid/Flex e JavaScript vanilla que simula respostas do assistente (filas/filamentos) para funcionar sem backend; mesmo ficheiro documenta/incorpora opcional `<aacp-checkout-agent>` herdando `api-base-url` / `merchant-id` para fluxo real.

**Tech Stack:** HTML5, CSS3 (sem frameworks), vanilla JS opcional Fetch nulo para mock; `@aacp/widget` apenas se `pnpm dev` apontar o script `/src/main.tsx`.

---

## File Structure

| Ficheiro | Responsabilidade |
|----------|------------------|
| `apps/widget/enterprise-chat-demo.html` | Shell enterprise, zona de mensagens, composer, mock IA, bloco opcional do web component |

---

### Task 1: HTML shell + tema enterprise

**Files:**
- Create: `apps/widget/enterprise-chat-demo.html`

- [x] **Step 1: Criar ficheiro HTML** com `<meta viewport>`, `lang="pt-BR"`, `@import` Google Fonts (`DM Sans`, `Instrument Serif`), variáveis CSS (`--surface`, `--accent`, `--msg-agent`, `--msg-user`).

- [x] **Step 2:** Grid layout: sidebar 260px (`nav` com “Canais”, “Contexto”), `main` com header de conversação (avatar agente + status online + badge “Assistido por IA”), `section` scrollável de mensagens, `footer` com `textarea` + botão enviar.

- [x] **Step 3:** Verificar visual no browser abrindo o ficheiro via `pnpm dev -- --open enterprise-chat-demo.html` ou servidor estático sobre `apps/widget`.

**Critério de verificação:** Layout responsivo até ~720px largura útil sem scroll horizontal estranho na thread.

---

### Task 2: Comportamento bate-papo (mock agente)

**Files:**
- Modify: `apps/widget/enterprise-chat-demo.html` ( `<script>` no fim )

- [x] **Step 4:** Implementar estado `messages[]`; função `appendMessage(role, text)` que insere bubbles com classe `.msg--agent | .msg--user` + `time` relativamente formatado (`toLocaleTimeString('pt-BR')`).

- [x] **Step 5:** Ao enviar: limpar campo, mensagem usuário aparece instantâneo; após delay 450ms mostrar `typing indicator` (três pontos); após mais 900–1400ms escolher resposta mock contextual (lista de templates + fallback genérico se texto vazio/comprido).

```javascript
async function simulateAgentReply(userText) {
  await delay(500);
  showTyping(true);
  await delay(800 + Math.random() * 500);
  showTyping(false);
  const snippets = [
    "Entendi. Para o seu carrinho atual, posso verificar políticas comerciais e sugerir o próximo passo sem criar obrigações de entrega até confirmar dados.",
    "Estou registando esse ponto na conversa para o relatório ao comerciante. Quer focar primeiro em frete, desconto ou prazo?",
    "Pelo fluxo checkout, esse evento costuma aumentar score de abandono — posso oferecer opções dentro das regras do lojista. O que você prefere priorizar?",
    userText.trim().length
      ? `Sobre "${userText.slice(0, 80)}${userText.length > 80 ? "…" : ""}": trabalho apenas com dados que você já partilhou nesta página, sem dados sensíveis fora da sessão atual.`
      : "Obrigado por detalhar. Se quiser, descreva a objeção (preço, prazo ou confiança) que preparo próximos passos."
  ];
  appendMessage(
    "agent",
    snippets[Math.floor(Math.random() * snippets.length)]
  );
}
```

- [x] **Step 6:** Atalhos Enter envia (`Shift+Enter` nova linha no `textarea`).

**Critério de verificação:** Enviar 5 mensagens seguidas gera sempre respostas diferentes possíveis, sem erro de consola.

---

### Task 3: Integração opcional ao widget real (legado)

**Files:**
- Modify: `apps/widget/enterprise-chat-demo.html`

- [x] **Step 7:** Secção inferior colapsável ou sidebar “checkout real” com comentários + `<aacp-checkout-agent merchant-id="mrc_demo" api-base-url="http://localhost:3000" …>` condicionado pelo parâmetro URL `?widget=1` para não obrigar ao bundle quando abrir como `file://`.

```javascript
const params = new URLSearchParams(window.location.search);
if (params.get("widget") === "1") {
  document.getElementById("widget-slot").hidden = false;
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/src/main.tsx";
  document.body.append(script);
}
```

- [x] **Step 8:** Texto ao utilizador instruindo: `pnpm --filter @aacp/widget dev` e api em `localhost:3000`, abrir `http://localhost:5173/enterprise-chat-demo.html?widget=1`.

**Critério de verificação:** Com API desligada, página mock funciona 100%; com API + widget, aparece launcher do componente quando `?widget=1`.

---

## Self-review

**Spec coverage:** UI enterprise messenger + comportamento bat-papo cobertos; fluxo backend real apenas via query `widget=1`.

**Placeholder scan:** Sem TBD nos passos execuveis.

**Type consistency:** N/A TS no HTML (JS vanilla apenas).

---

**Plan complete** em `docs/superpowers/plans/2026-05-03-enterprise-chat-demo-html.md`.

**Duas formas de execução seguinte:** Subagent-driven (uma tarefa por agente) ou Inline Execution com checkpoints — para este artefacto já concluído no repo, próximo passo é só validar manualmente no browser.
