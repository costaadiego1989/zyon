import { useState, useEffect } from "react";
import type { MerchantProfile } from "../../api-client.js";

export function useInventoryPage(options: {
  me: MerchantProfile | null;
  api?: any;
}) {
  const [summary, setSummary] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!options.api || !options.me) return;

    try {
      setLoading(true);
      const [sum, itemList, moveList, alertList, locList] = await Promise.all([
        options.api.getInventorySummary(options.me.id),
        options.api.listInventoryItems(options.me.id, { pageSize: 50 }),
        options.api.listMovements(options.me.id, { pageSize: 50 }),
        options.api.listAlerts(options.me.id, false),
        options.api.listLocations(options.me.id),
      ]).catch((err) => {
        setError(err.message);
        return [null, null, null, null, null];
      });

      setSummary(sum);
      setItems(itemList?.items ?? []);
      setMovements(moveList?.movements ?? []);
      setAlerts(alertList ?? []);
      setLocations(locList ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [options.api, options.me]);

  return { summary, items, movements, alerts, locations, loading, error, loadData };
}
