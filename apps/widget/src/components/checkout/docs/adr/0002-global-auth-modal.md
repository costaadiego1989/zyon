# ADR 0002 (widget/components/checkout) — `GlobalAuthModal`: acessibilidade do diálogo de auth/hub (foco e dismiss)

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Acessibilidade, Produto
- **Relacionado:** [ADR 0015](../../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md), [ADR 0023](../../../../../../../docs/architecture/adr/0023-widget-shell-identity-experience.md). Módulos irmãos: [`use-global-auth`](../../../../hooks/docs/adr/0003-use-global-auth.md).

## Contexto

`GlobalAuthModal.tsx` é o diálogo modal de identificação do comprador (entrada
por celular/OTP) e o account hub. Renderiza `role="dialog"` com
`aria-modal="true"`, backdrop clicável, formulário de telefone/código e o painel
`AccountHub`. Consome o controlador [`use-global-auth`](../../../../hooks/docs/adr/0003-use-global-auth.md)
(`auth.close`, `sendPhoneCode`, `verifyPhoneCode`).

**Invariantes que o módulo deve manter:**

1. Enquanto aberto, o foco de teclado permanece dentro do diálogo (sem tabular
   para a página atrás).
2. Há afordância padrão de dismiss (Escape), além do clique no backdrop.
3. O foco retorna ao elemento de origem ao fechar.

## Decisão

Implementar gestão de foco e dismiss padrão conforme WCAG, sem alterar o fluxo
de autenticação.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P2** | Modal de auth/hub sem focus trap e sem Escape (56–171) | `role="dialog"`/`aria-modal` estão setados, mas o foco nunca é movido para dentro do diálogo, não há focus trap e só o clique no backdrop fecha (sem tecla Escape). Usuários de teclado e leitores de tela conseguem tabular para a página atrás do modal; sem afordância padrão de dismiss — preocupações WCAG 2.1.2 (No Keyboard Trap, inversamente) e 2.4.3 (Focus Order). | Ao abrir, mover foco para o diálogo/primeiro campo, prender Tab dentro do diálogo e adicionar handler de `keydown` Escape chamando `auth.close`; restaurar o foco ao fechar. | Não. |

> Validação completa de conformidade WCAG exige teste manual com tecnologias
> assistivas e revisão especializada de acessibilidade.

## Melhorias para produção

### Segurança
- Sem impacto direto; o diálogo media identificação do comprador (ADR 0015).

### Desacoplamento
- Lógica de auth permanece em `use-global-auth`; o componente cuida só de
  foco/dismiss.

### Persistência & Consistência
- Foco restaurado ao elemento de origem mantém o contexto do usuário.

### Observabilidade
- N/A (interação de UI).

### Otimização & Escala
- N/A.

### Features faltantes
- Focus trap reutilizável para os demais modais do widget
  (ex.: painel crypto, guest modal).

## Alternativas consideradas
- **Confiar em `aria-modal` sem trap.** Rejeitado: `aria-modal` não impede a
  tabulação real no DOM atrás do diálogo.

## Consequências
**Positivas:** diálogo acessível por teclado/leitor de tela; dismiss padrão.
**Negativas/riscos:** baixo; precisa teste manual com AT para validar.

**Barra de aceite:** ao abrir, o foco entra no diálogo; Tab fica preso dentro;
Escape fecha; foco retorna à origem; verificado com navegação por teclado e
leitor de tela.
