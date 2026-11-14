export type Role = "OWNER" | "ADMIN" | "STAFF";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  STAFF: "Agente de Suporte",
};

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  STAFF: 1,
};

/**
 * Normalize a role string from the API (which uses lowercase: "owner" | "admin" | "staff")
 * to the dashboard's Role type (uppercase).
 * Returns undefined if the value is not a recognized role.
 */
export function normalizeRole(value: unknown): Role | undefined {
  if (value === "OWNER" || value === "ADMIN" || value === "STAFF") return value;
  if (value === "owner") return "OWNER";
  if (value === "admin") return "ADMIN";
  if (value === "staff") return "STAFF";
  return undefined;
}
