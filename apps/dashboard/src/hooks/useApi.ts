import { createContext, useContext, useMemo } from "react";
import { createDashboardApi } from "../api-client.js";

export type DashboardApi = ReturnType<typeof createDashboardApi>;

/**
 * React Context for the dashboard API client.
 * Provides a single API client instance to the entire app tree.
 * Pages can call useApi() instead of instantiating per-page with useMemo.
 */
export const ApiContext = createContext<DashboardApi | null>(null);

export function useApi(): DashboardApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used within an ApiProvider");
  return api;
}

/**
 * Hook to create the API client instance (used in the provider).
 */
export function useApiInstance(baseUrl: string): DashboardApi {
  return useMemo(() => createDashboardApi({ baseUrl }), [baseUrl]);
}
