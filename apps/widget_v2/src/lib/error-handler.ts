export interface ErrorContext {
  context: string;
  userId?: string;
  sessionId?: string;
  details?: Record<string, any>;
}

export function reportError(
  error: unknown,
  context: string,
  details?: Record<string, any>
): { message: string; original: Error } {
  const err = error instanceof Error ? error : new Error(String(error));

  console.error(`[${context}]`, err.message, details || "");

  const userMessage = parseErrorMessage(err);

  try {
    showErrorNotification(userMessage);
  } catch (e) {
    console.warn("Failed to show notification:", e);
  }

  return { message: userMessage, original: err };
}

function parseErrorMessage(err: Error): string {
  const msg = err.message.toLowerCase();

  if (msg.includes("network") || msg.includes("fetch") || msg.includes("offline")) {
    return "Erro de conexão. Verifique sua internet.";
  }
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("token")) {
    return "Sua sessão expirou. Recarregue a página.";
  }
  if (msg.includes("403") || msg.includes("forbidden")) {
    return "Você não tem permissão para esta ação.";
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return "Recurso não encontrado.";
  }
  if (msg.includes("500") || msg.includes("internal server")) {
    return "Erro no servidor. Tente novamente em instantes.";
  }
  if (msg.includes("timeout")) {
    return "Requisição expirou. Tente novamente.";
  }

  return "Algo deu errado. Tente novamente.";
}

function showErrorNotification(message: string): void {
  if (typeof window !== "undefined" && (window as any).__SHOW_ERROR__) {
    (window as any).__SHOW_ERROR__(message);
  } else {
    console.warn("⚠️  TOAST:", message);
  }
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; backoffMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const backoffMs = options?.backoffMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = backoffMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Retry exhausted");
}
