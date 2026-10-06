import { validateFoodOptionGroups } from "./food-options-validation.js";
import { serviceScheduleError } from "./service-schedule.js";

export const PRODUCT_TYPES = ["physical", "digital", "service", "food"] as const;

/** Configuration validation is shared by create, edit and spreadsheet reimport. */
export function validateProductType(type: string, metadata?: Record<string, unknown>): string | undefined {
  if (!(PRODUCT_TYPES as readonly string[]).includes(type)) return "invalid_product_type";
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) return "invalid_product_metadata";
  if (!metadata) return undefined;
  if (type === "food" || metadata.optionGroups !== undefined) {
    const foodError = validateFoodOptionGroups(metadata.optionGroups);
    if (foodError) return foodError;
  }
  if (type === "digital" && metadata.downloadExpiryDays !== undefined &&
      (!Number.isSafeInteger(metadata.downloadExpiryDays) || Number(metadata.downloadExpiryDays) < 1 || Number(metadata.downloadExpiryDays) > 365)) return "invalid_download_expiry";
  if (type === "digital" && metadata.downloadUrl !== undefined && metadata.downloadUrl !== "") {
    if (typeof metadata.downloadUrl !== "string") return "invalid_download_url";
    try {
      const url = new URL(metadata.downloadUrl);
      if (url.protocol !== "https:" || url.username || url.password) return "invalid_download_url";
    } catch { return "invalid_download_url"; }
  }
  if (type === "service") {
    const scheduleError = serviceScheduleError(metadata.serviceSchedule);
    if (scheduleError) return scheduleError;
    if (metadata.serviceType !== undefined && metadata.serviceType !== "" && !["presencial", "remoto"].includes(String(metadata.serviceType))) return "invalid_service_type";
    const values = [metadata.startDate, metadata.startTime, metadata.endDate, metadata.endTime];
    if (values.some(value => value !== undefined && value !== "")) {
      if (!values.every(value => typeof value === "string" && value.length > 0)) return "service_interval_incomplete";
      const [startDate, startTime, endDate, endTime] = values as string[];
      const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      const timeValid = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      if (!dateValid(startDate!) || !dateValid(endDate!) || !timeValid(startTime!) || !timeValid(endTime!)) return "invalid_service_interval";
      if (`${endDate}T${endTime}` <= `${startDate}T${startTime}`) return "service_end_must_follow_start";
    }
  }
  return undefined;
}

/** Drafts may omit content; payment requires deliverable content. */
export function isDigitalContentReady(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const values = metadata as Record<string, unknown>;
  return typeof values.downloadUrl === "string" && !!values.downloadUrl.trim() && !validateProductType("digital", values);
}
