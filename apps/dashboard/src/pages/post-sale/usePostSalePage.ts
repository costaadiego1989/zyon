import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface PostSaleStats {
  totalMessagesSent: number;
  totalMessagesScheduled: number;
  totalReviewsReceived: number;
  npsAverage: number | null;
  npsByClassification: {
    promoters: number;
    passives: number;
    detractors: number;
  };
}

export interface Review {
  id: string;
  productId: string;
  buyerId: string;
  rating: number;
  text: string | null;
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface NpsItem {
  id: string;
  buyerId: string;
  score: number;
  feedback: string | null;
  classification: "promoter" | "passive" | "detractor";
  createdAt: string;
}

export interface PostSaleTemplate {
  type: string;
  channel: string;
  name: string;
  body: string;
  subject?: string;
  metaRevision?: number;
  metaApprovedVersions?: Array<{ revision: number; body: string }>;
  metaCategory?: string | null;
  metaLanguage?: string | null;
  metaTemplateBody?: string | null;
  metaVariableMap?: Record<string, string> | null;
  twilioContentSid?: string | null;
  metaStatus?: string | null;
  metaRejectionReason?: string | null;
}

export function usePostSalePage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [stats, setStats] = useState<PostSaleStats | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [npsItems, setNpsItems] = useState<NpsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const moderating = useRef(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [npsPage, setNpsPage] = useState(1);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [npsTotal, setNpsTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsData, reviewsData, npsData] = await Promise.all([
          api.getPostSaleStats(),
          api.getPostSaleReviews(reviewsPage),
          api.getPostSaleNps(npsPage),
        ]);

        if (cancelled) return;

        setStats(statsData);
        setReviews(reviewsData.items || []);
        setNpsItems(npsData.items || []);
        setReviewsTotal(reviewsData.total); setNpsTotal(npsData.total);
        setReviewsPage(p => Math.min(p, Math.max(1, Math.ceil(reviewsData.total / 20))));
        setNpsPage(p => Math.min(p, Math.max(1, Math.ceil(npsData.total / 20))));
      } catch (e) {
        reportError({ source: "post-sale.load", error: e });
        if (!cancelled) {
          setError("Não foi possível carregar os resultados de pós-venda. Tente novamente.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, props.me, loadVersion, reviewsPage, npsPage]);

  async function handleModerateReview(reviewId: string, status: "approved" | "rejected") {
    if (moderating.current) return;
    moderating.current = true; setModeratingId(reviewId); setModerationError(null);
    try {
      await api.moderateReview(reviewId, status);

      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId ? { ...r, moderationStatus: status } : r
        )
      );

      showToast("success", `Avaliação ${status === "approved" ? "aprovada" : "rejeitada"}`);
    } catch (e) {
      reportError({ source: "post-sale.moderate", error: e });
      setModerationError("Não foi possível moderar a avaliação. O estado anterior foi mantido; tente novamente.");
    } finally { moderating.current = false; setModeratingId(null); }
  }

  return {
    stats,
    reviews,
    npsItems,
    loading,
    loaded,
    error,
    moderationError,
    moderatingId,
    retry: () => setLoadVersion(value => value + 1),
    reviewsPage,
    reviewsTotal,
    npsTotal,
    setReviewsPage,
    npsPage,
    setNpsPage,
    handleModerateReview,
  };
}
