import { DashboardHttpError } from "../../../api/http/error.js";
import { catalogErrorReason } from "../../../api/http/catalog-error-reason.js";

export function catalogSaveError(error: unknown): { message: string; conflictingSkus: string[] } {
  if (error instanceof Error && error.message === "product_media_upload_failed") return { message: "Produto salvo, mas algumas imagens não foram enviadas. Elas continuam neste editor; tente salvar novamente.", conflictingSkus: [] };
  if (error instanceof DashboardHttpError) {
    const reason = catalogErrorReason(error);
    if (error.status === 409 && reason.startsWith("sku_already_exists:")) {
      const conflictingSkus = reason.slice("sku_already_exists:".length).split(",").filter(Boolean);
      return { message: "Este SKU já está cadastrado. Use outro código ou edite o produto existente.", conflictingSkus };
    }
    const messages: Record<string, string> = {
      stock_quantity_below_reserved: "O estoque não pode ser menor que a quantidade reservada.",
      stock_reserved_variant_cannot_be_removed: "A variante tem unidades reservadas e não pode ser removida agora.",
      stock_reserved_sku_cannot_be_changed: "A variante tem unidades reservadas e seu SKU não pode ser alterado agora.",
      stock_reserved_type_cannot_be_changed: "O produto tem unidades reservadas e seu tipo não pode ser alterado agora.",
      invalid_cost: "Informe um custo válido, igual ou maior que zero.",
      stock_managed_by_erp: "O saldo deste SKU é controlado pelo ERP. Altere o estoque no ERP conectado.",
      stock_location_required: "Selecione um depósito no estoque antes de alterar o saldo deste produto.",
      stock_warehouse_required: "Este produto tem mais de um depósito. Ajuste o saldo pela tela de estoque.",
      service_end_must_follow_start: "O fim do serviço deve ser posterior ao início.",
      invalid_service_schedule: "Revise a duração e os horários do atendimento antes de salvar.",
      invalid_service_timezone: "Escolha um fuso horário válido para o atendimento.",
      invalid_service_slot_time: "Informe datas e horários válidos no fuso escolhido.",
      overlapping_service_slots: "Há horários sobrepostos. Separe os atendimentos conforme a duração do serviço.",
      invalid_download_url: "Informe um link HTTPS válido para download.",
      physical_product_requires_weight: "Informe o peso do produto físico.",
      invalid_food_options: "Revise as categorias de opções, os limites de seleção e os acréscimos antes de salvar.",
    };
    return { message: messages[reason] ?? "Não foi possível concluir o salvamento. Confira os dados e tente novamente.", conflictingSkus: [] };
  }
  return { message: "Não foi possível concluir o salvamento. Tente novamente.", conflictingSkus: [] };
}
