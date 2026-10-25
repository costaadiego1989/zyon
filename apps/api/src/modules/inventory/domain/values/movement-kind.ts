export type MovementKind =
  | "ENTRY"
  | "EXIT"
  | "ADJUSTMENT"
  | "RESERVATION"
  | "RELEASE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export const MOVEMENT_KINDS: readonly MovementKind[] = [
  "ENTRY",
  "EXIT",
  "ADJUSTMENT",
  "RESERVATION",
  "RELEASE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
