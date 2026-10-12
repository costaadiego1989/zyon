import { catalogErrorReason } from "../../api/http/catalog-error-reason.js";

const messages: Record<string, string> = {
  import_storage_unavailable: "O envio de planilhas está indisponível. Tente novamente mais tarde.",
  import_queue_unavailable: "O processamento de planilhas está indisponível. Tente enviar o arquivo novamente mais tarde.",
  empty_import_file: "O arquivo está vazio. Selecione uma planilha com produtos.",
  invalid_import_file: "Não foi possível ler o arquivo. Selecione uma planilha CSV ou XLSX.",
  unsupported_file_type: "Use um arquivo CSV ou XLSX.",
  file_too_large: "O arquivo deve ter até 5 MB.",
  file_unavailable: "O arquivo desta importação não está disponível. Envie a planilha novamente.",
  file_fetch_failed: "Não foi possível acessar o arquivo enviado. Tente novamente mais tarde.",
  parse_failed: "Não foi possível ler a planilha. Confira se o arquivo é CSV ou XLSX.",
  column_mapping_failed: "Não foi possível identificar as colunas. Use nomes como Nome, SKU, Preço e Estoque.",
  missing_name: "Informe o nome do produto.",
  missing_sku: "Informe o código SKU do produto.",
  invalid_price: "Informe um preço válido maior que zero.",
  invalid_stock_quantity: "O estoque deve ser um número inteiro maior ou igual a zero.",
  stock_quantity_below_reserved: "O estoque informado é menor que a quantidade reservada.",
  stock_managed_by_erp: "O saldo deste SKU é controlado pelo ERP. Ajuste o estoque no ERP conectado.",
  stock_location_required: "Defina o depósito do produto na tela de estoque antes de importar o saldo.",
  stock_warehouse_required: "Este produto tem mais de um depósito. Ajuste o saldo pela tela de estoque.",
  physical_product_requires_weight: "Informe o peso do produto físico em gramas.",
  invalid_product_type: "Use um tipo válido: físico, digital, serviço ou food.",
  invalid_product_metadata: "Confira a configuração do produto na coluna Metadata.",
  invalid_download_url: "Informe um link HTTPS válido para download.",
  invalid_download_expiry: "O prazo de acesso digital deve ser de 1 a 365 dias.",
  invalid_service_type: "Use a modalidade de serviço presencial ou remoto.",
  service_interval_incomplete: "Informe as datas e os horários de início e fim do serviço.",
  invalid_service_interval: "Confira as datas e os horários do serviço.",
  service_end_must_follow_start: "O fim do serviço deve ser posterior ao início.",
  import_product_type_change_requires_editor: "Altere o tipo deste produto pelo editor antes de reimportar.",
  category_not_found: "A categoria não pertence a esta loja. Informe o nome de uma categoria da loja.",
};

export function importErrorMessage(reason: string): string {
  return messages[reason] ?? "Não foi possível importar esta linha. Confira os dados e tente novamente.";
}

export function importUploadError(error: unknown): string {
  const reason = catalogErrorReason(error);
  return messages[reason] ?? "Não foi possível confirmar o envio. Consulte o andamento em Produtos antes de tentar novamente.";
}

/** Browsers may leave MIME empty or use octet-stream for a valid spreadsheet. */
export function spreadsheetUploadMime(fileName: string): string | undefined {
  if (/\.csv$/i.test(fileName)) return "text/csv";
  if (/\.xlsx$/i.test(fileName)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return undefined;
}
