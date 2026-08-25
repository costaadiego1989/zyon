import { useEffect, useState } from "react";
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

export function usePostSalePage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [stats, setStats] = useState<PostSaleStats | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [npsItems, setNpsItems] = useState<NpsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [npsPage, setNpsPage] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [statsData, reviewsData, npsData] = await Promise.all([
          api.getPostSaleStats(),
          api.getPostSaleReviews(1),
          api.getPostSaleNps(1),
        ]);

        if (cancelled) return;

        setStats(statsData);
        setReviews(reviewsData.items || []);
        setNpsItems(npsData.items || []);
      } catch (e) {
        reportError({ source: "post-sale.load", error: e });
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar Pós-venda");
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
  }, [props.me]);

  async function handleModerateReview(reviewId: string, status: "approved" | "rejected") {
    try {
      await api.moderateReview(reviewId, status);

      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId ? { ...r, moderationStatus: status } : r
        )
      );

      showToast("success", `Review ${status === "approved" ? "aprovada" : "rejeitada"}`);
    } catch (e) {
      reportError({ source: "post-sale.moderate", error: e });
      showToast("error", "Erro ao moderar review");
    }
  }

  return {
    stats,
    reviews,
    npsItems,
    loading,
    loaded,
    reviewsPage,
    setReviewsPage,
    npsPage,
    setNpsPage,
    handleModerateReview,
  };
}
