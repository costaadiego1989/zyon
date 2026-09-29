/** Signed checkout tokens are sent only through the existing embed transport. */
export function embedAuthHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
