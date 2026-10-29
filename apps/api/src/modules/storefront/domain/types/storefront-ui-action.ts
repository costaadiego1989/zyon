/** Internal action resolved from a server-owned UI selection, never from its label. */
export interface StorefrontUiAction { tool: string; args: Record<string, unknown> }
