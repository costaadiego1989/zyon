import { DashboardHttpError } from "../../api/http/index.js";

export function contentLoadError(error: unknown): string {
  if (error instanceof DashboardHttpError) {
    if (error.status === 401) return "Sua sessão expirou. Entre novamente para acessar o conteúdo dos produtos.";
    if (error.status === 403) return "Sua conta não tem acesso ao conteúdo dos produtos. Confira as permissões e o plano da loja.";
    if (error.status === 0) return "Não conseguimos conectar ao catálogo. Confira sua conexão e tente novamente.";
  }
  return "Não foi possível carregar o conteúdo dos produtos. Tente novamente em instantes. Seus produtos e conteúdos salvos foram preservados.";
}
