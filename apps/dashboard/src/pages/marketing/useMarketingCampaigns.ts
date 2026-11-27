import { useCallback, useEffect, useMemo, useState } from "react";
import {
  marketingApi,
  type MarketingCampaign,
  type MarketingCampaignReport,
  type MarketingCampaignReview,
  type MarketingCampaignDraft,
} from "../../api/marketing.js";
import { marketingError } from "./marketing-format.js";

export function useMarketingCampaigns(base: string) {
  const api = useMemo(() => marketingApi(base), [base]);
  const [list, setList] = useState<MarketingCampaign[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<MarketingCampaign | null>(null);
  const [review, setReview] = useState<MarketingCampaignReview | null>(null);
  const [report, setReport] = useState<MarketingCampaignReport | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .campaigns()
      .then((value) => {
        if (active) setList(value);
      })
      .catch((error) => {
        if (active) setError(marketingError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
  useEffect(() => {
    setCampaign(null);
    setReview(null);
    setReport(null);
    if (!selected) return;
    let active = true,
      pending = false;
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const [report, review] = await Promise.all([
          api.report(selected),
          api.review(selected),
        ]);
        if (active) {
          setCampaign(report.campaign);
          setReport(report);
          setReview(review);
        }
      } catch (error) {
        if (active) setError(marketingError(error));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, selected, revision]);
  const run = async <T>(
    operation: () => Promise<T>,
    message: string
  ): Promise<T | null> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await operation();
      setNotice(message);
      refresh();
      return value;
    } catch (error) {
      setError(marketingError(error));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) => {
    setSelected(id);
    setEditing(false);
    setError("");
    setNotice("");
  };
  const back = () => {
    setSelected(null);
    setEditing(false);
    setError("");
    setNotice("");
  };
  const create = () => {
    setSelected(null);
    setCampaign(null);
    setEditing(true);
    setError("");
    setNotice("");
  };
  const save = async (draft: MarketingCampaignDraft) => {
    const value = await run(
      () =>
        campaign
          ? api.updateCampaign(campaign.id, draft, campaign.version)
          : api.createCampaign(draft),
      "Rascunho salvo. Revise o público antes de aprovar."
    );
    if (value) {
      setCampaign(value);
      setSelected(value.id);
      setEditing(false);
    }
  };
  return {
    api,
    list,
    selected,
    campaign,
    review,
    report,
    editing,
    setEditing,
    loading,
    busy,
    error,
    notice,
    refresh,
    run,
    open,
    back,
    create,
    save,
  };
}
