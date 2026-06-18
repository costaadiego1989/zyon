# ADR 0004 (widget/hooks) — `use-voice-checkout`: captura de voz, TTS e corridas de transcrição assíncrona

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Produto, Acessibilidade
- **Relacionado:** [ADR 0022](../../../../../../docs/architecture/adr/0022-widget-transactional-path.md), [ADR 0023](../../../../../../docs/architecture/adr/0023-widget-shell-identity-experience.md). Módulos irmãos: [`use-checkout-chat`](./0005-use-checkout-chat.md).

## Contexto

`use-voice-checkout.ts` controla o canal de voz do checkout: reconhecimento de
fala (SpeechRecognition), síntese de voz do agente (SpeechSynthesis) e o turno
de confirmação por toque antes de enviar a transcrição ao agente.

- **`startListening`** — abre o microfone se `enabled && !busy && !composerLocked
  && !speaking`; mascara PII na transcrição exibida (`maskVoiceTranscriptForDisplay`).
- **`speakAgentLine`** — fala a última linha do agente; em `onend`, religa o
  microfone se `autoListenRef` e o app não estiver ocupado/travado.
- **`confirmPendingTurn` / `discardPendingTurn` / `retryPendingTurn`** — ciclo
  de confirmação do turno de voz.
- **Refs de callback** (`onConfirmTranscriptRef`, etc.) — mantêm callbacks
  frescos entre renders.

**Portas:** Web Speech API do navegador; callbacks `onConfirmTranscript`,
`onAgentPlaybackDone`, `buildPendingTurn`.

**Invariantes que o módulo deve manter:**

1. O microfone não reabre enquanto o app está `busy` ou `composerLocked` (não
   capturar transcrição durante um turno em andamento).
2. PII na transcrição exibida é mascarada.
3. A API do hook não expõe parâmetros mortos/enganosos.

## Decisão

Ler estado volátil (`busy`/`composerLocked`) de refs frescos dentro de handlers
assíncronos do TTS, e sanear a superfície de opções do hook.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P2** | Closure obsoleta de `busy`/`composerLocked` reabre o microfone após o TTS (301–319) | `speakAgentLine` captura `busy` e `composerLocked` na sua closure; `utterance.onend` dispara segundos depois e re-checa esses valores obsoletos antes de auto-chamar `startListening`. O microfone pode auto-iniciar quando o app já ficou ocupado/travado, capturando transcrição durante um turno em voo. | Ler `busy`/`composerLocked` de refs atualizados por efeito (como já é feito para os callbacks) dentro do handler `onend`, em vez dos valores fechados na closure. | Não. |
| **P3** | Opção `awaitingAgentPlayback` não usada no hook de voz (110–132) | `awaitingAgentPlayback` é declarada em `UseVoiceCheckoutOptions` e passada pelos chamadores, mas nunca é desestruturada nem usada; o gating de playback depende só de `busy`/`agentPlaybackKey`. Parâmetro morto; o gating pretendido sobre o playback do agente pode estar faltando e a API engana. | Ou consumir `awaitingAgentPlayback` no gating de auto-fala/auto-escuta, ou removê-la do tipo de opções e dos call sites. | Não (mudança de API interna do hook; alinhar com chamadores). |

## Melhorias para produção

### Segurança
- PII mascarada na exibição da transcrição (já presente); confirmação por toque
  antes de qualquer ação de risco (ADR 0022).

### Desacoplamento
- Estado volátil via refs frescos; callbacks injetados por ref.

### Persistência & Consistência
- Gating de microfone consistente com o estado atual do turno (sem corrida).

### Observabilidade
- Hint de UI reflete o estado real (ouvindo/falando/confirmar).

### Otimização & Escala
- Sem reabertura espúria do microfone reduz turnos descartados.

### Features faltantes
- Definir e documentar o papel de `awaitingAgentPlayback` (ou removê-lo).

## Alternativas consideradas
- **Recriar `speakAgentLine` a cada mudança de `busy`.** Rejeitado: invalida o
  utterance em curso e causa cancelamentos; refs frescos são mais simples.

## Consequências
**Positivas:** microfone não reabre durante turno em voo; API de voz honesta.
**Negativas/riscos:** decisão sobre `awaitingAgentPlayback` afeta chamadores.

**Barra de aceite:** após o TTS, o microfone só religa se o app não estiver
`busy`/`composerLocked` no instante do `onend`; `awaitingAgentPlayback` usado ou
removido, sem parâmetro morto.
