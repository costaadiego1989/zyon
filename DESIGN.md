# AACP Agentic Checkout Experience

> Status: direcao proposta para refatoracao do widget
> Atualizado em: 2026-06-13
> Escopo: checkout publico, hub do comprador, suporte e sistema de temas
> Registro: produto

## 1. Visao executiva

A AACP nao deve parecer um chatbot colocado ao lado de um carrinho. Ela deve
parecer uma nova categoria de checkout: uma experiencia de compra guiada, com
inteligencia editorial na conversa e precisao transacional em cada decisao.

O conceito central e:

**Editorial Intelligence + Transactional Precision**

- Editorial Intelligence cria presenca, ritmo, linguagem e uma pergunta ativa
  que parece cuidadosamente composta.
- Transactional Precision mantem total, frete, pagamento, consentimento,
  privacidade e consequencias sempre explicitos.
- A conversa acelera o checkout, mas nunca esconde controles tradicionais.
- Light e dark sao duas expressoes completas da mesma experiencia.
- Mobile e o produto principal. Desktop expande contexto, nao muda a jornada.

Nome de trabalho para a linguagem visual: **AACP Continuum**.

O nome Zion pode continuar como identidade do agente, mas a interface nao deve
depender de uma estetica cripto ou de terminal para parecer avancada.

## 2. Cena de uso

Uma pessoa abre o checkout no celular, muitas vezes com pressa, em uma loja que
ainda nao conhece, alternando entre luz natural, transporte, sofa ou escritorio.
Ela quer entender o pedido, responder apenas o necessario e ter certeza de que
nada sera cobrado sem sua confirmacao.

Essa cena define as decisoes:

- light e o modo inicial mais seguro para leitura em ambientes variados;
- dark e um modo completo, persistido por preferencia do usuario ou integrado ao
  tema do host;
- o contraste precisa funcionar sob brilho alto e brilho baixo;
- a interface deve manter uma acao primaria por momento;
- o usuario nunca pode depender da memoria para saber o que esta acontecendo.

## 3. Leitura das referencias visuais

### 3.1 Layout light atual

O layout atual ja possui uma base confiavel:

- separacao clara entre conversa e resumo do pedido;
- paleta mineral quente, mais humana que o branco clinico;
- carrinho com ledger financeiro legivel;
- mensagem inicial simples e acolhedora;
- controles familiares para conta, tema e total;
- identidade de merchant visivel.

Os principais limites atuais sao:

- a tipografia do palco conversacional ainda parece funcional, nao memoravel;
- cabecalho, progresso, conversa, composer e carrinho usam densidades parecidas;
- a mensagem inicial, o titulo da etapa e o historico disputam o mesmo nivel;
- quick replies longas viram uma grade de botoes sem prioridade;
- o composer ocupa muita atencao mesmo quando uma resposta sugerida resolveria;
- no mobile, carrinho, suporte e ferramentas flutuantes competem entre si;
- o hub e o suporte usam vocabularios visuais parcialmente diferentes;
- o CSS novo depende de uma camada de override sobre o CSS legado.

### 3.2 Layout dark Zion

O conceito criado no Lovable acerta em pontos importantes:

- cria foco forte na pergunta ativa;
- usa serif editorial para dar personalidade ao momento;
- combina sans para leitura e mono para metadados operacionais;
- transforma progresso em protocolo, nao em um formulario generico;
- usa icones lineares dentro de frames consistentes;
- mantem a transacao persistente no rodape;
- apresenta a seguranca como parte do fluxo;
- reduz a sensacao de chat infinito.

O conceito nao deve ser copiado literalmente:

- cyan sobre preto absoluto aproxima o produto de cripto e cybersecurity;
- excesso de caixa alta e mono reduz legibilidade em uso prolongado;
- a bandeja inferior ocupa espaco demais em telas menores;
- brilho, orb e transparencias podem virar decoracao sem funcao;
- o merchant perde protagonismo para a identidade Zion;
- textos como "SSL 256-bit" ou "criptografado ponta a ponta" nao podem aparecer
  sem garantia tecnica e juridica verificavel;
- a versao dark precisa ser uma traducao semantica do light, nao outro produto.

### 3.3 Sintese proposta

Vamos combinar:

| Preservar do light | Absorver do Zion | Evoluir alem dos dois |
| --- | --- | --- |
| Confianca mineral | Foco na pergunta ativa | Uma acao primaria por estado |
| Carrinho legivel | Tipografia editorial | Painel transacional persistente |
| Merchant visivel | Iconografia disciplinada | Hub e suporte no mesmo sistema |
| Mensagem humana | Metadados em mono | Privacidade contextual e verificavel |
| Controles familiares | Ritmo cinematografico contido | Adaptacao por usuario recorrente |

## 4. Principios de produto visual

### 4.1 A pergunta atual e o centro

O elemento mais importante da tela nao e o chat inteiro. E a decisao atual.

O palco deve destacar:

1. onde o usuario esta;
2. por que a informacao e necessaria;
3. qual resposta e esperada;
4. o que acontece depois.

O historico continua acessivel, mas perde contraste conforme se afasta da
decisao atual.

### 4.2 Futurismo silencioso

O futuro aparece em:

- resposta contextual;
- continuidade entre checkout, conta e suporte;
- transicoes sem quebra;
- dados pre-preenchidos com consentimento;
- feedback imediato;
- resumo em linguagem natural antes da confirmacao.

O futuro nao aparece em:

- neon permanente;
- particulas;
- gradiente em texto;
- vidro em toda superficie;
- terminologia tecnica inventada;
- animacao sem informar mudanca de estado.

### 4.3 Confianca progressiva

Confianca nao e um selo repetido. Ela deve surgir quando a duvida existe:

- e-mail: explicar uso para recibo e acompanhamento;
- CPF: explicar finalidade fiscal e politica de retencao;
- endereco: indicar que ainda nao sera cobrado;
- pagamento: mostrar valor, metodo e momento exato da cobranca;
- oferta: mostrar origem, validade e impacto no total;
- confirmacao: mostrar identificador autoritativo do pedido.

### 4.4 Marca com guardrails

O merchant pode personalizar:

- logo;
- cor de acento;
- identidade do agente;
- tom de copy;
- familia tipografica aprovada;
- densidade e raio dentro de faixas seguras.

A plataforma preserva:

- contraste;
- semantica de estados;
- posicao de confirmacoes financeiras;
- foco visivel;
- tamanho de alvo;
- ordem das etapas;
- linguagem de erro;
- estrutura mobile.

### 4.5 Premium pela precisao

Premium significa:

- alinhamento otico;
- numeros tabulares;
- espacos com ritmo;
- bordas discretas;
- texto financeiro sem ambiguidade;
- controles completos em hover, focus, active, disabled, loading e error;
- nenhuma quebra entre o checkout e as superficies auxiliares.

## 5. Arquitetura da experiencia

### 5.1 Os tres planos

#### Plano 1: Contexto

Uma barra compacta apresenta merchant, agente, status, conta e progresso.
Ela responde "onde estou?" e "quem esta me ajudando?".

#### Plano 2: Decisao

O palco conversacional apresenta uma unica decisao ativa. Mensagem, explicacao,
respostas sugeridas e input pertencem ao mesmo bloco semantico.

#### Plano 3: Transacao

O Transaction Dock mantem quantidade de itens, total e proxima acao sempre
alcancaveis. No desktop ele se expande como rail. No mobile ele abre uma sheet.

### 5.2 Estrutura de componentes alvo

```text
CheckoutExperience
|-- ExperienceHeader
|   |-- MerchantIdentity
|   |-- AgentIdentity
|   |-- ThemeControl
|   `-- AccountEntry
|-- JourneyProtocol
|-- DecisionStage
|   |-- StageIntroduction
|   |-- ConversationHistory
|   |-- ActiveAgentTurn
|   |-- DecisionActions
|   `-- ContextualComposer
|-- TransactionDock
|-- SurfaceLayer
|   |-- OrderSheet
|   |-- BuyerHub
|   `-- SupportCenter
`-- LiveRegion
```

### 5.3 Regra de superficies

Somente uma superficie auxiliar pode estar aberta por vez.

```ts
type ActiveSurface =
  | { kind: "none" }
  | { kind: "order"; snapPoint: "peek" | "full" }
  | { kind: "account"; section: "home" | "orders" | "identity" | "agent" }
  | { kind: "support"; topicId?: string };
```

Isso substitui a combinacao independente de `cartOpen`, `userPanelOpen`,
`supportOpen` e modais concorrentes.

## 6. Layout responsivo

### 6.1 Mobile, 320 a 767 px

Mobile e uma composicao vertical de tela inteira:

```text
56 px  Header compacto
52 px  Protocolo da jornada
auto   Palco da decisao
auto   Respostas ou input
64 px  Transaction Dock
safe   Safe area
```

Regras:

- nenhuma borda externa de "janela dentro da janela";
- header mostra merchant ou agente, nao todos os metadados;
- progresso usa rotulo atual + quatro marcadores compactos;
- quick replies usam uma acao recomendada em largura total;
- acoes secundarias podem rolar horizontalmente;
- composer aparece apenas quando texto livre e realmente necessario;
- Transaction Dock e o unico elemento flutuante persistente;
- suporte entra pelo header ou pelo menu do dock;
- cart, hub e suporte usam bottom sheets com a mesma anatomia;
- foco e teclado virtual nao podem esconder o campo ativo;
- `env(safe-area-inset-bottom)` e obrigatorio.

### 6.2 Tablet, 768 a 1023 px

- conversa ocupa a tela;
- pedido abre em sheet lateral ou inferior conforme orientacao;
- header preserva identidade, conta e tema;
- progresso mostra rotulos completos;
- o palco usa largura de leitura maxima de 680 px.

### 6.3 Desktop, 1024 px ou mais

- shell maximo entre 1180 e 1240 px;
- conversa entre 680 e 760 px;
- rail transacional entre 340 e 380 px;
- altura pode acompanhar o viewport, com minimo de 680 px;
- carrinho permanece visivel, mas o CTA continua subordinado ao estado;
- hub e suporte abrem como side sheets de 420 a 480 px;
- nao usar dashboard com varios cards equivalentes.

### 6.4 Breakpoints de QA

Validar obrigatoriamente:

| Viewport | Motivo |
| --- | --- |
| 320 x 568 | menor largura suportada |
| 360 x 800 | Android compacto |
| 390 x 844 | iPhone moderno |
| 430 x 932 | mobile amplo |
| 768 x 1024 | tablet portrait |
| 1024 x 768 | tablet landscape |
| 1280 x 800 | notebook comum |
| 1440 x 900 | desktop de referencia |

## 7. Sistema de cor

### 7.1 Estrategia

A estrategia e **Restrained**:

- neutros levemente orientados ao verde mineral;
- um acento do merchant em ate 10% da superficie;
- cores semanticas reservadas para estados reais;
- nada de preto ou branco absolutos;
- cor de acento nao substitui hierarquia.

### 7.2 Light

O light deve parecer porcelana tecnica, nao uma pagina branca.

```css
[data-theme="light"] {
  --color-canvas: oklch(97.4% 0.012 102);
  --color-surface: oklch(99.2% 0.006 100);
  --color-surface-muted: oklch(96.2% 0.012 108);
  --color-surface-strong: oklch(92.8% 0.018 112);
  --color-ink: oklch(23% 0.022 155);
  --color-muted: oklch(47% 0.018 155);
  --color-faint: oklch(61% 0.014 155);
  --color-line: oklch(85.5% 0.018 108);
  --color-line-soft: oklch(91% 0.014 108);
  --color-accent: oklch(45% 0.11 153);
  --color-accent-soft: oklch(94% 0.035 150);
}
```

### 7.3 Dark

O dark deve parecer carbono mineral, nao preto neon.

```css
[data-theme="dark"] {
  --color-canvas: oklch(16.5% 0.014 160);
  --color-surface: oklch(20.5% 0.016 158);
  --color-surface-muted: oklch(24% 0.017 155);
  --color-surface-strong: oklch(29% 0.019 152);
  --color-ink: oklch(94% 0.009 105);
  --color-muted: oklch(73% 0.012 120);
  --color-faint: oklch(61% 0.012 120);
  --color-line: oklch(38% 0.018 150);
  --color-line-soft: oklch(31% 0.016 150);
  --color-accent: oklch(77% 0.13 176);
  --color-accent-soft: oklch(27% 0.035 168);
}
```

O acento cyan-esverdeado aparece apenas em:

- etapa atual;
- foco;
- acao primaria;
- economia confirmada;
- estado online real;
- iconografia de identidade do agente.

### 7.4 Temas do merchant

O contrato atual possui um conjunto de cores e o dark e derivado de valores
fixos no front. O contrato V2 deve permitir dois modos validados:

```ts
type ThemePalette = {
  canvas: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
};

type MerchantThemeV2 = {
  version: 2;
  mode: "light" | "dark" | "system" | "host";
  light: ThemePalette;
  dark: ThemePalette;
  typography: {
    interface: string;
    editorial: string;
    operational: string;
  };
  shape: {
    controlRadius: number;
    surfaceRadius: number;
    density: "compact" | "comfortable" | "spacious";
  };
  identity: {
    logoUrl?: string;
    agentAvatarUrl?: string;
    agentName?: string;
  };
};
```

Antes de salvar, a API deve validar contraste, URL segura, faixa de raio e
fontes permitidas. O widget nao deve receber liberdade para gerar um tema
inacessivel.

## 8. Tipografia

### 8.1 Familias

Usar tres papeis tipograficos, nao tres vozes concorrentes:

| Papel | Familia | Uso |
| --- | --- | --- |
| Interface | IBM Plex Sans | labels, botoes, mensagens, formularios |
| Editorial | IBM Plex Serif | titulo da etapa e confirmacao |
| Operacional | IBM Plex Mono | pedido, horario, status e referencias |

As fontes devem ser auto-hospedadas em WOFF2 no bundle do widget para evitar
dependencia de Google Fonts, vazamento de contexto e variacao de carregamento.

### 8.2 Regra editorial

A serif aparece em no maximo um elemento dominante por viewport:

- "Vamos finalizar seu pedido";
- "Escolha como receber";
- "Revise antes de pagar";
- "Seu pedido esta confirmado".

Ela nao aparece em botoes, labels, precos, formularios ou mensagens comuns.

### 8.3 Escala

```css
:where(.checkout-experience) {
  --font-interface: "IBM Plex Sans", system-ui, sans-serif;
  --font-editorial: "IBM Plex Serif", Georgia, serif;
  --font-operational: "IBM Plex Mono", ui-monospace, monospace;

  --text-0: 0.75rem;
  --text-1: 0.875rem;
  --text-2: 1rem;
  --text-3: 1.25rem;
  --text-4: 1.625rem;
  --text-5: 2.125rem;
}

.stage-title {
  max-width: 18ch;
  font-family: var(--font-editorial);
  font-size: var(--text-5);
  font-style: italic;
  font-weight: 600;
  line-height: 0.98;
  letter-spacing: -0.035em;
}

.money,
.order-reference {
  font-variant-numeric: tabular-nums;
}

.order-reference {
  font-family: var(--font-operational);
  letter-spacing: 0.04em;
}
```

No mobile, o titulo editorial usa `1.75rem`. No desktop, `2.125rem`.
Tipografia de produto usa escala fixa por breakpoint, sem `clamp()` fluido.

## 9. Iconografia

### 9.1 Direcao

O que funciona nos icones Zion e a gramatica:

- linha precisa;
- stroke consistente;
- frame optico;
- pequeno indicador de estado;
- uso semantico;
- ausencia de ilustracao generica.

Podemos manter `lucide-react`, que ja existe no projeto, e criar uma camada de
apresentacao consistente.

```tsx
import type { LucideIcon } from "lucide-react";

type IconFrameProps = {
  icon: LucideIcon;
  label?: string;
  status?: "online" | "secure" | "neutral";
  size?: "sm" | "md";
};

export function IconFrame({
  icon: Icon,
  label,
  status = "neutral",
  size = "md",
}: IconFrameProps) {
  return (
    <span
      className="icon-frame"
      data-size={size}
      data-status={status}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Icon strokeWidth={1.75} />
      {status !== "neutral" ? <span className="icon-frame__status" /> : null}
    </span>
  );
}
```

Regras:

- 16 px para controles compactos;
- 18 px para botoes;
- 20 px para identidade;
- stroke entre 1.5 e 1.75;
- icone sozinho sempre recebe `aria-label` ou texto adjacente;
- nao misturar Lucide, emoji e SVG de estilos diferentes;
- um simbolo proprio de Zion pode existir apenas como marca do agente.

## 10. Journey Protocol

O stepper atual comunica etapas, mas pode ganhar a precisao do conceito Zion.

### 10.1 Desktop

- kicker operacional: `ETAPA 01`;
- titulo legivel: `Cadastro`;
- rail com quatro segmentos;
- etapas concluidas usam check discreto;
- etapa atual usa acento;
- pendentes permanecem neutras.

### 10.2 Mobile

- mostrar `Cadastro, etapa 1 de 4`;
- quatro marcadores compactos;
- esconder rotulos pendentes se faltarem 320 px;
- manter `aria-valuenow` e `aria-valuetext`;
- nunca comunicar progresso apenas pela cor.

### 10.3 Transicao

Ao mudar de etapa:

- atualizar o rail em 180 ms;
- fazer o novo titulo entrar com opacidade e `translateY(4px)`;
- mover foco para o titulo da etapa somente quando a mudanca veio de uma acao
  explicita;
- anunciar a etapa no live region;
- remover a transicao com `prefers-reduced-motion`.

## 11. Palco conversacional

### 11.1 Anatomia

```text
ETAPA 01 / CADASTRO
Vamos finalizar
seu pedido.

[Zion, agente de compras]
[Mensagem atual com destaque semantico]

[Acao recomendada] [Por que pedimos isso?]
[Input contextual, se necessario]
```

### 11.2 Mensagem inicial

A mensagem atual deve ser preservada e refinada:

> Ola, estou aqui para ajudar voce a finalizar seu pedido com seguranca.

Ela funciona porque:

- declara presenca;
- explica o objetivo;
- nao exagera a capacidade da IA;
- introduz seguranca sem prometer tecnologia especifica.

Depois dela, o agente faz uma pergunta por vez.

### 11.3 Active Turn

A ultima mensagem do agente recebe maior contraste, espacamento e peso. Mensagens
anteriores ficam no transcript com aparencia mais simples.

```tsx
function ActiveAgentTurn({
  agentName,
  children,
  rationale,
}: {
  agentName: string;
  children: React.ReactNode;
  rationale?: React.ReactNode;
}) {
  return (
    <section className="active-turn" aria-labelledby="active-turn-agent">
      <div className="active-turn__identity">
        <IconFrame icon={ShieldCheck} status="secure" />
        <span id="active-turn-agent">{agentName}</span>
      </div>
      <div className="active-turn__message">{children}</div>
      {rationale ? (
        <details className="active-turn__rationale">
          <summary>Por que pedimos isso?</summary>
          <div>{rationale}</div>
        </details>
      ) : null}
    </section>
  );
}
```

### 11.4 Quick replies

As respostas devem expressar prioridade:

- uma resposta recomendada recebe estilo primario;
- explicacao ou recusa recebe estilo secundario;
- no maximo tres acoes visiveis sem expansao;
- labels com mais de 28 caracteres usam linha propria;
- acoes nao podem simular conversa se sao comandos do checkout;
- "Digitar agora" abre o input, nao envia uma mensagem falsa.

### 11.5 Composer

O composer e contextual:

- oculto quando uma escolha binaria resolve;
- visivel para e-mail, telefone, CPF, CEP, nome e texto livre;
- label real acima do campo, placeholder apenas como exemplo;
- mascara preserva cursor e permite colar;
- validacao aparece inline antes do envio;
- botao muda de enviar para continuar conforme o tipo de tarefa;
- Enter envia apenas em input de uma linha;
- dados sensiveis nunca reaparecem completos no transcript.

## 12. Transaction Dock

O Transaction Dock substitui a concorrencia entre cart FAB, CTA e suporte.

### 12.1 Mobile

Estado fechado:

```text
1 item       Total R$ 299,90       Ver pedido
```

Estado contextual:

```text
Total R$ 299,90       Continuar para entrega
```

Ao abrir:

- bottom sheet com produto, quantidade, desconto, frete e total;
- snap point inicial mostra o resumo financeiro;
- snap point completo mostra itens e controles;
- fechar retorna o foco ao botao que abriu;
- sheet respeita teclado, safe area e scroll interno.

### 12.2 Desktop

O rail lateral segue esta ordem:

1. merchant e referencia;
2. estado atual do pedido;
3. itens;
4. subtotal, frete, desconto e total;
5. explicacao de seguranca contextual;
6. proxima acao.

Nao repetir um CTA de pagamento antes de o fluxo estar pronto para pagamento.

### 12.3 Atualizacao de total

Quando quantidade, frete ou desconto mudar:

- destacar apenas a linha alterada;
- manter numeros tabulares;
- anunciar o novo total em live region;
- nao usar confete ou glow;
- se a mudanca veio de oferta, mostrar origem e validade.

## 13. Buyer Hub

O hub deve parecer continuidade da compra, nao um painel SaaS.

### 13.1 Navegacao

Estrutura recomendada:

| Secao | Conteudo |
| --- | --- |
| Inicio | pedido ativo, ultima compra, atalhos |
| Pedidos | historico, rastreio, detalhes e recompra |
| Identidade | nome, telefone, e-mail e enderecos |
| Meu agente | preferencias permitidas do comprador |
| Ajuda | FAQs, chamados e handoff |

### 13.2 Prioridades

- pedido em andamento aparece antes de metricas;
- rastreio e recompra sao acoes de primeira classe;
- dados sensiveis sao editados em formularios claros;
- configuracao do agente usa linguagem de beneficio;
- regras internas do merchant nunca aparecem;
- "economia acumulada" so aparece se houver fonte de verdade auditavel;
- login, checkout e hub compartilham os mesmos tokens e componentes.

### 13.3 Responsividade

- mobile: superficie de tela inteira com navegacao superior rolavel;
- desktop: side sheet de ate 480 px ou rota dedicada quando houver muito conteudo;
- historico usa linhas expansivas, nao uma grade de cards;
- detalhes do pedido entram inline, evitando modal.

## 14. Suporte

Suporte deve ser um modo da mesma experiencia.

### 14.1 Entrada

- mobile: acao `Ajuda` no header ou no menu do Transaction Dock;
- desktop: acao discreta no header;
- remover tooltip automatica apos carregamento;
- nao manter um segundo FAB competindo com o total.

### 14.2 Fluxo

1. apresentar topicos verificados do merchant;
2. mostrar resposta inline;
3. perguntar se resolveu;
4. iniciar chat contextual com session ID;
5. oferecer handoff humano com expectativa real de prazo;
6. manter o checkout intacto ao fechar.

### 14.3 Identidade

O agente de vendas e o suporte podem compartilhar tecnologia, mas precisam de
identidades claras:

- `Zion, agente de compras`;
- `Equipe Athom, suporte`.

O usuario deve saber quando esta falando com IA, conteudo verificado ou humano.

## 15. Seguranca, privacidade e copy

### 15.1 Claims permitidos

Usar apenas claims comprovaveis:

- "Voce revisa tudo antes de pagar";
- "Nenhuma cobranca acontece sem sua confirmacao";
- "Usaremos este e-mail para recibo e acompanhamento";
- "Pagamento processado por [provedor]";
- "Conexao protegida", quando tecnicamente validado.

Evitar:

- "100% seguro";
- "SSL 256-bit";
- "criptografia ponta a ponta";
- "risco zero";
- "oferta exclusiva" sem regra real;
- urgencia artificial.

### 15.2 Dados sensiveis

- mascarar CPF no transcript;
- nunca registrar cartao em mensagens;
- limpar valores de inputs sensiveis apos submissao;
- explicar retencao e finalidade quando relevante;
- nao enviar PII em telemetria de UI;
- permitir revisao antes de confirmar.

## 16. Movimento e microinteracao

### 16.1 Duracoes

| Interacao | Duracao |
| --- | --- |
| Hover e press | 120 a 150 ms |
| Mudanca de etapa | 180 a 220 ms |
| Sheet | 220 a 260 ms |
| Confirmacao inline | 180 ms |
| Skeleton para conteudo | sem loop chamativo |

Usar curvas de saida:

```css
:root {
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
}
```

### 16.2 Momentos memoraveis

Momentos de impacto permitidos:

- a primeira mensagem aparece ja pronta, sem sequencia teatral;
- a etapa concluida troca de estado com precisao;
- um desconto confirmado atualiza total e economia juntos;
- o resumo final reorganiza a conversa em recibo;
- o pedido confirmado recebe um unico gesto de celebracao, curto e opcional.

### 16.3 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  .checkout-experience *,
  .checkout-experience *::before,
  .checkout-experience *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 17. Estados obrigatorios

Cada modulo precisa de default, hover, focus, active, disabled, loading, empty,
error, retry e success quando aplicavel.

| Estado | Resposta visual | Acao |
| --- | --- | --- |
| Boot | skeleton da estrutura | aguardar |
| API lenta | mensagem de continuidade | cancelar ou aguardar |
| Offline | estado persistente sem perder input | tentar novamente |
| Contrato invalido | fallback seguro | recarregar |
| Sessao expirada | explicar consequencia | retomar sessao |
| Estoque mudou | mostrar item afetado | revisar carrinho |
| Frete mudou | comparar anterior e novo | confirmar |
| Pagamento recusado | motivo util e privado | trocar metodo |
| Pagamento pendente | estado autoritativo | atualizar status |
| Pedido confirmado | referencia e proximos passos | acompanhar |
| Carrinho vazio | busca ou retorno a loja | adicionar produto |

Spinners isolados devem ser substituidos por skeletons ou progresso local sempre
que a estrutura da tela ja for conhecida.

## 18. Acessibilidade

Meta minima: WCAG 2.2 AA. Fluxos financeiros devem buscar AAA para texto e
comunicacao de estado.

Checklist:

- alvos de toque com pelo menos 44 x 44 px;
- foco visivel com contraste;
- ordem de tab igual a ordem visual;
- `role="log"` apenas no transcript;
- live region separada para total, etapa e pagamento;
- sheets com foco contido e retorno de foco;
- `aria-current="step"` na etapa ativa;
- erros associados por `aria-describedby`;
- labels persistentes em formularios;
- zoom de 200% sem perda de tarefa;
- suporte a forced colors;
- nenhum estado depende apenas de cor;
- imagens de produto com alt significativo ou `alt=""` quando decorativas;
- tema escuro testado, nao apenas invertido;
- leitura em pt-BR sem abreviacoes tecnicas desnecessarias.

## 19. Arquitetura de front-end

### 19.1 Diagnostico atual

O codigo ja possui bons recortes de estado, mas a camada visual precisa ser
consolidada:

- `styles.css` e `enterprise.css` sao carregados juntos;
- `enterprise.css` possui 2.893 linhas de overrides;
- `UserPanel.tsx` possui 648 linhas e muitos estilos inline;
- `ChatThread.tsx` concentra transcript, pagamento, oferta, cupom, PIX,
  produtos, frete e confirmacao;
- `fontDisplay` existe no contrato, mas nao governa o titulo editorial atual;
- dark mode usa cores fixas no helper, nao uma paleta do merchant;
- cart, hub e suporte possuem mecanismos independentes de abertura;
- o Web Component ainda renderiza em light DOM e pode herdar CSS do host.

### 19.2 Estrutura alvo

```text
apps/widget/src/
|-- app/
|   |-- CheckoutExperience.tsx
|   `-- SurfaceLayer.tsx
|-- design-system/
|   |-- tokens.css
|   |-- themes.css
|   |-- typography.css
|   |-- motion.css
|   |-- primitives/
|   |   |-- Button.tsx
|   |   |-- IconButton.tsx
|   |   |-- IconFrame.tsx
|   |   |-- Field.tsx
|   |   |-- Sheet.tsx
|   |   `-- StatusMessage.tsx
|   `-- index.ts
|-- features/
|   |-- journey/
|   |-- conversation/
|   |-- transaction/
|   |-- buyer-hub/
|   |-- support/
|   `-- payment/
|-- hooks/
|-- lib/
`-- main.tsx
```

### 19.3 Composicao React

```tsx
export function CheckoutExperience({ vm }: CheckoutExperienceProps) {
  return (
    <section
      className="checkout-experience"
      data-theme={vm.colorMode}
      data-stage={vm.checkoutStage}
    >
      <div className="experience-shell">
        <main className="experience-main">
          <ExperienceHeader vm={vm} />
          <JourneyProtocol stage={vm.checkoutStage} />
          <DecisionStage vm={vm} />
        </main>

        <TransactionRail vm={vm} />
      </div>

      <TransactionDock vm={vm} />
      <SurfaceLayer surface={vm.activeSurface} vm={vm} />
      <CheckoutLiveRegion announcements={vm.announcements} />
    </section>
  );
}
```

### 19.4 CSS por responsabilidade

Evitar outra folha monolitica:

```text
design-system/tokens.css          100 a 180 linhas
design-system/themes.css          120 a 200 linhas
design-system/typography.css       60 a 100 linhas
features/journey/journey.css       80 a 140 linhas
features/conversation/chat.css    180 a 280 linhas
features/transaction/order.css    180 a 280 linhas
features/buyer-hub/hub.css        180 a 300 linhas
features/support/support.css      120 a 220 linhas
```

Os limites sao orientativos. O objetivo e propriedade clara, nao perseguir
numero de linhas.

### 19.5 Isolamento

O Web Component deve migrar para Shadow DOM conforme
`docs/architecture/widget-architecture.md`.

Enquanto a migracao nao acontece:

- resetar apenas dentro de `.checkout-experience`;
- evitar seletores globais;
- nao depender do CSS do host;
- testar em paginas hostis com `button`, `input`, `img` e `box-sizing`
  sobrescritos.

## 20. Primitivos

### 20.1 Button

Variantes:

- `primary`: uma por contexto;
- `secondary`: alternativa segura;
- `quiet`: acao de baixa enfase;
- `danger`: apenas para destruicao;
- `icon`: sempre com label acessivel.

Alturas:

- 44 px mobile;
- 40 px desktop compacto;
- 48 px em acao financeira primaria.

### 20.2 Field

```tsx
type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  prefix?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function Field({
  id,
  label,
  hint,
  error,
  prefix,
  ...inputProps
}: FieldProps) {
  const descriptionId = `${id}-description`;

  return (
    <label className="field" htmlFor={id} data-invalid={Boolean(error)}>
      <span className="field__label">{label}</span>
      <span className="field__control">
        {prefix}
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? descriptionId : undefined}
          {...inputProps}
        />
      </span>
      {hint || error ? (
        <span id={descriptionId} className="field__message">
          {error ?? hint}
        </span>
      ) : null}
    </label>
  );
}
```

### 20.3 Sheet

Cart, suporte e hub devem compartilhar:

- backdrop;
- cabecalho;
- close;
- foco;
- scroll;
- safe area;
- animacao;
- breakpoints;
- retorno de foco.

## 21. Adaptacao inteligente

A experiencia pode adaptar densidade sem esconder informacao.

### 21.1 Comprador novo

- mais contexto;
- rationale visivel;
- explicacao de conta;
- resumo antes de cada transicao critica.

### 21.2 Comprador recorrente

- saudacao curta;
- endereco e contato sugeridos;
- confirmacao antes de reutilizar dados;
- acoes mais compactas;
- acesso rapido ao pedido anterior;
- nunca assumir pagamento sem confirmacao.

### 21.3 Sessao recuperada

- explicar que a compra foi encontrada;
- mostrar o que mudou desde a ultima visita;
- pedir revisao de preco, estoque e frete;
- retomar na decisao pendente, nao no inicio.

## 22. Instrumentacao

Eventos de produto devem medir tarefa, nao vaidade:

| Evento | Objetivo |
| --- | --- |
| `stage_viewed` | localizar abandono por etapa |
| `active_turn_answered` | medir friccao por pergunta |
| `rationale_opened` | identificar duvidas de privacidade |
| `quick_reply_selected` | avaliar utilidade das sugestoes |
| `manual_input_requested` | detectar falta de opcoes |
| `order_sheet_opened` | entender necessidade de revisao |
| `total_changed` | correlacionar oferta, frete e quantidade |
| `support_topic_opened` | melhorar conteudo |
| `handoff_requested` | medir limite da automacao |
| `payment_recovered` | medir recuperacao de falha |
| `checkout_completed` | conversao autoritativa |

Nao enviar:

- e-mail;
- telefone;
- CPF;
- endereco;
- texto livre integral;
- dados de cartao;
- conteudo sensivel de suporte.

## 23. Metricas de sucesso

### Produto

- taxa de conclusao por etapa;
- tempo mediano entre pergunta e resposta;
- percentual de usuarios que abrem `Por que pedimos isso?`;
- recuperacao apos erro de pagamento;
- retorno de sessao abandonada;
- uso do hub apos compra;
- resolucao no suporte sem handoff;
- taxa de revisao do pedido antes do pagamento.

### Qualidade

- LCP do widget menor que 1,8 s p75;
- interacao visual em menos de 100 ms;
- bundle inicial com budget definido e medido;
- zero regressao critica em axe;
- contraste AA em 100% dos temas publicados;
- nenhuma colisao com CSS do host;
- screenshots verdes nos viewports de referencia.

## 24. Plano de implementacao

### Fase 0: Congelar comportamento

Objetivo: garantir que a refatoracao visual nao mude regras de negocio.

Entregas:

- fixtures deterministicas para cada etapa;
- screenshots light e dark nos oito viewports;
- inventario de eventos e estados;
- testes para foco, teclado, sheet e total;
- baseline de bundle e performance.

Saida:

- comportamento atual documentado;
- testes de regressao visuais executaveis.

### Fase 1: Fundacao do design system

Entregas:

- tokens semanticos em OKLCH;
- paletas light e dark;
- fontes auto-hospedadas;
- `Button`, `IconButton`, `IconFrame`, `Field`, `Sheet`, `StatusMessage`;
- contrato `MerchantThemeV2`;
- gerador de tema com validacao de contraste.

Arquivos principais:

- `apps/widget/src/design-system/*`;
- `packages/shared-types/src/index.ts`;
- tema do dashboard;
- validacao de tema na API.

Saida:

- primitives cobertos por testes;
- nenhum novo componente usa cor hardcoded.

### Fase 2: Novo shell e palco

Entregas:

- `ExperienceHeader`;
- `JourneyProtocol`;
- `DecisionStage`;
- active turn;
- hierarquia editorial;
- quick replies priorizadas;
- composer contextual;
- live region.

Saida:

- fluxo de cadastro completo em light e dark;
- nenhum CTA concorrente no mobile.

### Fase 3: Transacao responsiva

Entregas:

- `TransactionRail`;
- `TransactionDock`;
- `OrderSheet`;
- ledger financeiro;
- mudanca de quantidade;
- oferta, cupom, frete e atualizacao de total;
- estados de pagamento.

Saida:

- carrinho acessivel no desktop e mobile;
- total sempre autoritativo e anunciado.

### Fase 4: Hub e suporte

Entregas:

- `SurfaceLayer`;
- hub reorganizado por tarefa;
- pedido ativo e rastreio;
- preferencias do agente;
- suporte contextual;
- handoff;
- remocao do FAB concorrente.

Saida:

- apenas uma superficie auxiliar aberta;
- checkout preservado ao abrir e fechar hub ou suporte.

### Fase 5: Isolamento e consolidacao

Entregas:

- Shadow DOM;
- remocao progressiva de estilos inline;
- decomposicao de `enterprise.css`;
- retirada de overrides legados;
- lazy-load de hub, suporte e formularios de pagamento;
- auditoria WCAG, performance e i18n;
- telemetria sem PII.

Saida:

- `enterprise.css` removido;
- `styles.css` deixa de ser fonte conflitante;
- widget isolado de CSS hostil.

### Fase 6: Diferenciacao

Entregas:

- retomada inteligente de sessao;
- resumo em linguagem natural antes de confirmar;
- comparacao clara quando preco ou frete muda;
- recompra pelo hub;
- continuidade do suporte para pedido concluido;
- personalizacao do agente dentro de guardrails.

Saida:

- experiencia reconhecivelmente AACP;
- diferenciais medidos por eventos de produto.

## 25. Sequencia sugerida de commits

Cada contexto deve ficar revisavel e reversivel:

1. `docs(widget): define agentic checkout design system`
2. `feat(widget): add semantic theme tokens and typography roles`
3. `feat(widget): add accessible ui primitives`
4. `refactor(widget): introduce experience shell and journey protocol`
5. `refactor(widget): isolate active conversation turn`
6. `feat(widget): add responsive transaction dock and order sheet`
7. `refactor(widget): unify account and support surface state`
8. `refactor(widget): rebuild buyer hub with task navigation`
9. `refactor(widget): integrate contextual support flow`
10. `refactor(widget): migrate widget into shadow dom`
11. `chore(widget): remove legacy enterprise overrides`
12. `test(widget): add visual and accessibility regression matrix`

## 26. Criterios de aceite por modulo

### Shell

- uma identidade visual em light e dark;
- nenhum vazamento de CSS do host;
- nenhuma superficie concorrente;
- layout funcional entre 320 e 1440 px.

### Jornada

- etapa e progresso compreensiveis sem cor;
- mudanca anunciada;
- titulo editorial nao invade controles;
- historico continua acessivel.

### Conversa

- uma pergunta por vez;
- resposta recomendada evidente;
- texto livre apenas quando necessario;
- dados sensiveis mascarados;
- erro recuperavel sem perder resposta.

### Carrinho

- item, quantidade, subtotal, frete, desconto e total claros;
- alteracoes anunciadas;
- mobile com dock e sheet;
- desktop com rail;
- nenhuma cobranca implicita.

### Hub

- pedido ativo prioritario;
- historico pesquisavel;
- rastreio acionavel;
- identidade editavel;
- preferencias do agente compreensiveis.

### Suporte

- entrada discreta;
- FAQ verificavel;
- handoff explicito;
- checkout preservado;
- sem prometer disponibilidade falsa.

### Tema

- contraste validado antes de publicar;
- light e dark configuraveis;
- fontes aprovadas;
- acento restrito a estados e acoes;
- preview nos viewports principais.

## 27. Anti-padroes proibidos

- preto ou branco absolutos como base;
- neon permanente;
- texto em gradiente;
- glassmorphism como linguagem principal;
- cards dentro de cards;
- quatro FABs concorrentes;
- modal como resposta padrao;
- animacao de entrada em cascata;
- display serif em botoes ou labels;
- caixa alta em frases longas;
- seguranca baseada em claims nao comprovados;
- chat que esconde carrinho ou pagamento;
- tema dark gerado apenas invertendo cores;
- metricas internas expostas ao comprador;
- urgencia, escassez ou oferta sem fonte de verdade.

## 28. Decisoes imediatas

1. Manter a composicao light mineral como base.
2. Criar dark carbono mineral com acento cyan-esverdeado restrito.
3. Adotar IBM Plex Sans, Serif e Mono como papeis do sistema.
4. Usar serif apenas no titulo da etapa.
5. Manter Lucide e criar `IconFrame` inspirado na disciplina visual Zion.
6. Substituir FABs por um unico Transaction Dock no mobile.
7. Unificar cart, hub e suporte em `SurfaceLayer`.
8. Evoluir `MerchantTheme` para light e dark validados.
9. Refatorar CSS por feature antes de ampliar efeitos visuais.
10. Tratar acessibilidade, performance e telemetria como parte do design.

## 29. Documentos relacionados

- `PRODUCT.md`
- `docs/product/premium-widget-ui-system.md`
- `docs/product/agentic-checkout-differentiation.md`
- `docs/architecture/widget-architecture.md`
- `docs/architecture/adr/0023-widget-shell-identity-experience.md`
- `docs/testing/test-strategy.md`

Este documento substitui direcoes visuais anteriores quando houver conflito. Os
documentos de arquitetura continuam sendo a fonte de verdade para contratos,
seguranca, persistencia e regras de negocio.
