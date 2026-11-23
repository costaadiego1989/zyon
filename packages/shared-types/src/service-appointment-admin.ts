/** Authenticated administrative facts. No provider proof or inferred actions. */
export type ServiceAppointmentAdminState = "pending" | "scheduled" | "in_service" | "completed" | "no_show" | "cancelled";
export interface ServiceAppointmentAdminPayment {
  id: string;
  mode: "online" | "at_attendance";
  status: "pending" | "approved" | "failed" | "cancelled" | "refunded" | "partially_refunded";
  amountCents: number;
  currency: string;
  version: number;
  requiresRegularization: boolean;
  receivedAt: string | null;
}
export interface ServiceAppointmentAdminItem {
  id: string;
  merchantId: string;
  professionalId: string;
  professionalName: string;
  productId: string;
  serviceName: string;
  categoryId: string | null;
  variantId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  durationMinutes: number;
  priceInCents: number;
  currency: string;
  policyVersion: number;
  operationalStatus: ServiceAppointmentAdminState;
  origin: "manual" | "whatsapp" | "storefront";
  version: number;
  customer: { name?: string; phone?: string; email?: string };
  payments: ServiceAppointmentAdminPayment[];
}
export interface ServiceAppointmentAdminList {
  items: ServiceAppointmentAdminItem[];
  nextCursor: string | null;
  totalCount: number;
  countsByStatus: Record<ServiceAppointmentAdminState, number>;
  asOf: string;
  timeZone: "America/Sao_Paulo";
}
export interface ServiceAppointmentAdminDetail extends ServiceAppointmentAdminItem {
  history: Array<{ id: string; action: string; actorId: string | null; origin: string; version: number; occurredAt: string }>;
  historyPartial: boolean;
  asOf: string;
}
export interface ServiceAppointmentAdminListQuery {
  fromDate: string;
  toDate: string;
  professionalId?: string;
  categoryId?: string;
  productId?: string;
  status?: ServiceAppointmentAdminState;
  limit?: string;
  cursor?: string;
}
