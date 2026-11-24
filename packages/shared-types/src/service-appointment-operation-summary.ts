/** Read-only command review. Every write still revalidates its own versions. */
export interface ServiceAppointmentOperationSummary {
  merchantId: string;
  appointmentId: string;
  appointmentVersion: number;
  asOf: string;
  attendanceActions: Array<"start_service" | "complete_service" | "no_show">;
  canReviewCancellation: boolean;
  canReviewRescheduling: boolean;
  localPayments: Array<{
    paymentId: string;
    paymentVersion: number;
    currency: string;
    balanceStatus: "available" | "not_payable" | "unavailable";
    receivedCents: number | null;
    remainingCents: number | null;
    canRecordReceipt: boolean;
  }>;
}
