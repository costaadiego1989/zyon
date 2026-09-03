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
