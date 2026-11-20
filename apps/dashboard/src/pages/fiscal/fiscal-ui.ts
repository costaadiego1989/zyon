import {
  FiscalApiError,
  type FiscalProvider,
  type FiscalProfiles,
  type FiscalEnvironment,
  type FiscalProfileInput,
  type FiscalReadinessCode,
} from "../../api/fiscal.js";
export const readinessLabel: Record<FiscalReadinessCode, string> = {
  authentication: "Autorização da conta",
  issuer: "Identidade do emitente",
  certificate: "Certificado no provedor",
  permissions: "Permissões fiscais",
  environment: "Ambiente efetivo da conta",
  stock_policy: "Responsável pelo estoque",
  email_policy: "Responsável pelo e-mail",
  whatsapp_policy: "Responsável pelo WhatsApp",
};
export const providerLabels: Record<FiscalProvider, string> = {
  focus: "Focus NF-e",
  bling: "Bling",
  omie: "Omie",
  tiny: "Tiny/Olist",
};
export function fiscalReasonText(code: string): string {
  return (
    (
      {
        fiscal_erp_reconnect_required:
          "Reconecte a autorização fiscal da conta.",
        fiscal_provider_unavailable:
          "Provedor indisponível. Tente verificar novamente.",
        fiscal_operation_unsupported: "Operação fiscal não suportada.",
        fiscal_profile_unconfirmed: "Revise e confirme o perfil fiscal.",
        fiscal_payment_metadata_required:
          "O pagamento aprovado aguarda dados fiscais autênticos do provedor.",
        fiscal_payment_mapping_required:
          "Configure a forma de pagamento no ERP.",
        fiscal_order_scope_unsupported:
          "A nota deve ser emitida pela mesma loja do pedido. Confira o vínculo da venda.",
        fiscal_document_pending: "Arquivo fiscal em recuperação.",
      } as Record<string, string>
    )[code] ?? "Revise a preparação fiscal com o responsável pela empresa."
  );
}
export function fiscalCredentialSecret(
  provider: FiscalProvider,
  input: {
    token: string;
    refreshToken: string;
    expiresAt: string;
    appId: string;
    clientSecret: string;
    environment: FiscalEnvironment;
    issuerTaxId: string;
  }
) {
  if (provider === "focus") return input.token;
  return JSON.stringify({
    contract: provider === "omie" ? "omie_app_v1" : "olist_oauth_v3",
    environment: input.environment,
    issuerTaxId: input.issuerTaxId.replace(/[.\-/\s]/g, "").toUpperCase(),
    token: input.token,
    refreshToken: input.refreshToken,
    expiresAt: new Date(input.expiresAt + "T23:59:59Z").toISOString(),
    ...(provider === "omie"
      ? { appHash: input.appId }
      : { clientId: input.appId, clientSecret: input.clientSecret }),
  });
}
export function fiscalErrorText(error: unknown): string {
  if (error instanceof FiscalApiError) {
    if (error.kind === "forbidden")
      return "Acesso negado. Esta área exige proprietário ou administrador da loja.";
    if (error.kind === "unauthenticated")
      return "Sessão expirada. Faça login para continuar.";
    if (error.kind === "not_found")
      return "Registro fiscal não encontrado nesta loja e ambiente.";
    if (error.pending.length)
      return (
        "Preparação pendente: " +
        error.pending.map((x) => readinessLabel[x]).join(", ") +
        "."
      );
    if (error.kind === "validation" || error.kind === "pending")
      return "Não foi possível concluir. " + fiscalReasonText(error.code);
  }
  return "Não foi possível carregar ou salvar os dados fiscais. Tente novamente.";
}
type OperationField = {
  key: string;
  label: string;
  kind?: "number" | "boolean";
  options?: string[];
};
export const operationFields: Record<FiscalProvider, OperationField[]> = {
  focus: [
    { key: "natureza_operacao", label: "Natureza da operação" },
    ...[
      ["tipo_documento", "Tipo do documento"],
      ["finalidade_emissao", "Finalidade da emissão"],
      ["local_destino", "Destino da operação"],
      ["consumidor_final", "Indicador de consumidor final"],
      ["presenca_comprador", "Presença do comprador"],
      ["modalidade_frete", "Modalidade do frete"],
      [
        "indicador_inscricao_estadual_destinatario",
        "Indicador de inscrição estadual",
      ],
    ].map(([key, label]) => ({ key, label, kind: "number" as const })),
  ],
  bling: [
    { key: "lojaId", label: "Código da loja no Bling", kind: "number" },
    { key: "crt", label: "Código do regime tributário", kind: "number" },
    { key: "cupomFiscal", label: "Código de cupom fiscal", kind: "number" },
    { key: "fretePorConta", label: "Frete por conta", kind: "number" },
    {
      key: "indicadorIe",
      label: "Indicador de inscrição estadual",
      kind: "number",
    },
  ],
  omie: [
    {
      key: "etapa",
      label: "Etapa do pedido",
      options: ["10", "20", "30", "40"],
    },
    { key: "codigoParcela", label: "Código da parcela" },
    {
      key: "codigoCenarioImpostos",
      label: "Código do cenário de impostos",
      kind: "number",
    },
    { key: "codigoCategoria", label: "Código da categoria" },
    {
      key: "codigoContaCorrente",
      label: "Código da conta corrente",
      kind: "number",
    },
    { key: "modalidadeFrete", label: "Modalidade do frete" },
    { key: "contribuinte", label: "Contribuinte", options: ["S", "N"] },
    { key: "indPresenca", label: "Presença do comprador" },
    {
      key: "indIntermediario",
      label: "Indicador de intermediário",
      options: ["0", "1"],
    },
    {
      key: "cnpjIntermediario",
      label: "CNPJ do intermediário (quando aplicável)",
    },
    {
      key: "identIntermediario",
      label: "Identificação do intermediário (quando aplicável)",
    },
    { key: "timeZone", label: "Fuso horário da operação" },
  ],
  tiny: [
    {
      key: "naturezaOperacaoId",
      label: "Código da natureza de operação",
      kind: "number",
    },
    { key: "ecommerceId", label: "Código do e-commerce", kind: "number" },
    { key: "consumidorFinal", label: "Consumidor final", kind: "boolean" },
    { key: "countryName", label: "Nome do país no ERP" },
    { key: "timeZone", label: "Fuso horário da operação" },
  ],
};
export const taxFields: Record<FiscalProvider, string[]> = {
  focus: [
    "icms_situacao_tributaria",
    "icms_aliquota",
    "icms_modalidade_base_calculo",
    "icms_percentual_reducao_base_calculo",
    "pis_situacao_tributaria",
    "pis_aliquota_porcentual",
    "cofins_situacao_tributaria",
    "cofins_aliquota_porcentual",
    "ipi_situacao_tributaria",
    "ipi_aliquota",
  ],
  bling: [
    "icms.cst",
    "icms.aliquota",
    "simples.cst",
    "simples.aliquota",
    "pis.cst",
    "pis.aliquota",
    "cofins.cst",
    "cofins.aliquota",
    "ipi.cst",
    "ipi.aliquota",
  ],
  omie: [
    "icms_sn.cod_sit_trib_icms_sn",
    "icms.cod_sit_trib_icms",
    "icms.aliq_icms",
    "pis_padrao.cod_sit_trib_pis",
    "pis_padrao.aliq_pis",
    "cofins_padrao.cod_sit_trib_cofins",
    "cofins_padrao.aliq_cofins",
    "ipi.cod_sit_trib_ipi",
    "ipi.aliq_ipi",
  ],
  tiny: ["cst", "aliquota"],
};
export type FiscalItemEditor = {
  sku: string;
  ncm: string;
  cfop: string;
  origin: string;
  unit: string;
  productId: string;
  natureId: string;
  taxes: { key: string; value: string; numeric: boolean }[];
};
export const emptyItem = (): FiscalItemEditor => ({
  sku: "",
  ncm: "",
  cfop: "",
  origin: "",
  unit: "",
  productId: "",
  natureId: "",
  taxes: [],
});
export function buildFiscalProfile(
  provider: FiscalProvider,
  environment: FiscalEnvironment,
  contract: FiscalProfiles["supportedContract"],
  operation: Record<string, string>,
  items: FiscalItemEditor[],
  issuerRegime: string,
  previous: Record<string, unknown> = {}
): FiscalProfileInput {
  if (!contract) throw new Error("Contrato fiscal indisponível");
  const op: Record<string, unknown> = {
    ...((previous.operation as object) ?? {}),
  };
  for (const field of operationFields[provider])
    if (operation[field.key] !== undefined && operation[field.key] !== "")
      op[field.key] =
        field.kind === "number"
          ? Number(operation[field.key])
          : field.kind === "boolean"
          ? operation[field.key] === "true"
          : operation[field.key];
  if (provider === "bling") {
    op.departureDateBasis = "issued_at";
    op.expectedDateBasis = "issued_at";
  }
  if (provider !== "focus")
    op.products = Object.fromEntries(
      items.map((item) => [
        item.sku,
        {
          productId: Number(item.productId),
          ...(provider === "bling"
            ? { naturezaOperacaoId: Number(item.natureId) }
            : {}),
        },
      ])
    );
  return {
    provider,
    environment,
    operation: "sale",
    issuerRegime,
    sourceContractVersion: contract.sourceContractVersion,
    recipientRequirements: contract.minimumRecipientRequirements,
    itemRules: {
      ...previous,
      currency: "BRL",
      supportedProductTypes: ["physical"],
      operation: op,
      items: Object.fromEntries(
        items.map((item) => [
          item.sku,
          {
            productType: "physical",
            ncm: item.ncm,
            cfop: item.cfop,
            origin: item.origin,
            unit: item.unit,
            taxes: Object.fromEntries(
              item.taxes
                .filter((t) => t.key && t.value !== "")
                .map((t) => [t.key, t.numeric ? Number(t.value) : t.value])
            ),
          },
        ])
      ),
    },
  };
}
export function profileEditor(profile: FiscalProfiles["profile"]) {
  const config = profile?.itemRules ?? {},
    op = (config.operation ?? {}) as Record<string, unknown>,
    products = (op.products ?? {}) as Record<
      string,
      { productId?: number; naturezaOperacaoId?: number }
    >;
  return {
    operation: Object.fromEntries(
      Object.entries(op)
        .filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => [k, String(v)])
    ),
    items: Object.entries(
      (config.items ?? {}) as Record<string, Record<string, unknown>>
    ).map(([sku, r]) => ({
      sku,
      ncm: String(r.ncm ?? ""),
      cfop: String(r.cfop ?? ""),
      origin: String(r.origin ?? ""),
      unit: String(r.unit ?? ""),
      productId: String(products[sku]?.productId ?? ""),
      natureId: String(products[sku]?.naturezaOperacaoId ?? ""),
      taxes: Object.entries(
        (r.taxes ?? {}) as Record<string, string | number>
      ).map(([key, value]) => ({
        key,
        value: String(value),
        numeric: typeof value === "number",
      })),
    })),
  };
}
