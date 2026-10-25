import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import type {
  ProductContentBlock,
  ProductFaq,
  ProductTestimonial,
  ProductVideo,
} from "../../../api/endpoints/product-content.js";
import type {
  UpsertFaqPayload,
  UpsertTestimonialPayload,
  UpsertVideoPayload,
} from "../../../api/endpoints/product-content.js";

export interface AdvancedLayoutSurface {
  blocks: ProductContentBlock[];
  faqs: ProductFaq[];
  testimonials: ProductTestimonial[];
  videos: ProductVideo[];
}

export type AdvancedLayoutStatus = "idle" | "loading" | "saving" | "error";

export interface UseAdvancedLayoutArgs {
  merchantId: string | null;
  productId: string | null;
}

export interface UseAdvancedLayoutResult {
  surface: AdvancedLayoutSurface;
  status: AdvancedLayoutStatus;
  loading: boolean;
  errorMsg: string | null;
  isDraft: boolean;
  reload: () => Promise<void>;
  saveBlocks: (blocks: ProductContentBlock[]) => Promise<void>;
  saveFaq: (payload: UpsertFaqPayload & { productId: string }) => Promise<void>;
  removeFaq: (id: string) => Promise<void>;
  reorderFaqs: (orderedIds: string[]) => Promise<void>;
  saveTestimonial: (
    payload: UpsertTestimonialPayload & { productId: string },
  ) => Promise<void>;
  removeTestimonial: (id: string) => Promise<void>;
  moderateTestimonial: (
    id: string,
    action: "approved" | "rejected",
    isPublished: boolean,
  ) => Promise<void>;
  saveVideo: (payload: UpsertVideoPayload & { productId: string }) => Promise<void>;
  removeVideo: (id: string) => Promise<void>;
  moderateVideo: (
    id: string,
    action: "approved" | "rejected",
    isPublished: boolean,
  ) => Promise<void>;
  /**
   * Persist the in-memory draft to the real product. Call after the product
   * itself has been created. No-op when the surface is empty or productId
   * stays null.
   */
  flushDrafts: () => Promise<void>;
  /**
   * Container-level enable flag. Default ON: when the merchant creates a
   * product, the dashboard starts with the Conteúdo Avançado section
   * expanded so blocks / FAQ / videos / reviews can be added right away.
   * Flipping it OFF collapses the section to a single toggle row (matching
   * the visual contract of `PromotionSection`) and hides every tab + draft
   * surface. Stored per (merchant, product) so the choice survives reloads
   * and product switches.
   */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /**
   * Reviews toggle. **Default OFF** — the merchant must explicitly flip it on
   * to start rendering the testimonials block on the storefront. Independent
   * from any per-FAQ / per-video `isPublished` so flipping it never blocks
   * other tabs.
   */
  testimonialsVisible: boolean;
  setTestimonialsVisible: (v: boolean) => void;
}

const EMPTY_SURFACE: AdvancedLayoutSurface = {
  blocks: [],
  faqs: [],
  testimonials: [],
  videos: [],
};

function testimonialsStorageKey(merchantId: string | null, productId: string | null): string {
  return `aacp.advancedLayout.testimonialsVisible:${merchantId ?? "draft"}:${productId ?? "draft"}`;
}

function enabledStorageKey(merchantId: string | null, productId: string | null): string {
  return `aacp.advancedLayout.enabled:${merchantId ?? "draft"}:${productId ?? "draft"}`;
}

function readTestimonialsVisibleFromStorage(
  merchantId: string | null,
  productId: string | null,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(testimonialsStorageKey(merchantId, productId));
    // Default OFF — the merchant must explicitly opt in to show reviews.
    if (raw === null) return false;
    return raw === "1";
  } catch {
    return false;
  }
}

function readEnabledFromStorage(merchantId: string | null, productId: string | null): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(enabledStorageKey(merchantId, productId));
    // Default ON — a brand-new product starts with the section expanded so the
    // merchant can land directly inside Blocos.
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function writeTestimonialsVisibleToStorage(
  merchantId: string | null,
  productId: string | null,
  visible: boolean,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      testimonialsStorageKey(merchantId, productId),
      visible ? "1" : "0",
    );
  } catch {
    // localStorage may be unavailable (private mode / quota); toggle still works in-memory.
  }
}

function writeEnabledToStorage(
  merchantId: string | null,
  productId: string | null,
  enabled: boolean,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      enabledStorageKey(merchantId, productId),
      enabled ? "1" : "0",
    );
  } catch {
    // see writeTestimonialsVisibleToStorage
  }
}

export function useAdvancedLayout({ merchantId, productId }: UseAdvancedLayoutArgs): UseAdvancedLayoutResult {
  const api = useApi();
  const [surface, setSurface] = useState<AdvancedLayoutSurface>(EMPTY_SURFACE);
  const [status, setStatus] = useState<AdvancedLayoutStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const snapshotRef = useRef<AdvancedLayoutSurface>(EMPTY_SURFACE);
  const [enabled, setEnabledState] = useState<boolean>(() =>
    readEnabledFromStorage(merchantId, productId),
  );
  const [testimonialsVisible, setTestimonialsVisibleState] = useState<boolean>(() =>
    readTestimonialsVisibleFromStorage(merchantId, productId),
  );

  const ready = !!merchantId && !!productId;

  // Re-hydrate the toggles from storage whenever the product changes
  // (cadastro -> edicao).
  useEffect(() => {
    setEnabledState(readEnabledFromStorage(merchantId, productId));
    setTestimonialsVisibleState(readTestimonialsVisibleFromStorage(merchantId, productId));
  }, [merchantId, productId]);

  // Detect transition from draft (productId null) to saved: in that moment the
  // surface holds the user's drafts and must be flushed to the API. We track the
  // previous ready value with a ref to fire flushDrafts exactly once per
  // transition (not on every re-render or merchantId change).
  const wasReadyRef = useRef<boolean>(false);
  useEffect(() => {
    if (!ready) {
      wasReadyRef.current = false;
      return;
    }
    if (!wasReadyRef.current) {
      wasReadyRef.current = true;
      // First mount after productId becomes truthy — if there's anything in the
      // surface that came from the draft buffer, flush it.
      const hasDraft =
        surface.blocks.length > 0 ||
        surface.faqs.length > 0 ||
        surface.testimonials.length > 0 ||
        surface.videos.length > 0;
      if (hasDraft) {
        void (async () => {
          try {
            await flushDraftsInternalRef.current?.();
          } catch {
            // Errors already surfaced via toast inside the flush helper.
          }
        })();
      }
    }
  }, [ready, surface]);

  const setTestimonialsVisible = useCallback(
    (next: boolean) => {
      setTestimonialsVisibleState(next);
      writeTestimonialsVisibleToStorage(merchantId, productId, next);
    },
    [merchantId, productId],
  );

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      writeEnabledToStorage(merchantId, productId, next);
    },
    [merchantId, productId],
  );

  const reload = useCallback(async () => {
    if (!ready) return;
    setStatus("loading");
    setErrorMsg(null);
    try {
      const out = await api.listContent(merchantId!, productId!);
      const next: AdvancedLayoutSurface = {
        blocks: out.blocks ?? [],
        faqs: out.faqs ?? [],
        testimonials: out.testimonials ?? [],
        videos: out.videos ?? [],
      };
      snapshotRef.current = next;
      setSurface(next);
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao carregar conteúdo avançado";
      setErrorMsg(message);
      setStatus("error");
    }
  }, [api, merchantId, productId, ready]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runSave = useCallback(
    async (apply: () => void, persist: () => Promise<void>) => {
      setStatus("saving");
      setErrorMsg(null);
      const before = snapshotRef.current;
      apply();
      try {
        await persist();
        snapshotRef.current = surface;
        setStatus("idle");
      } catch (err) {
        setSurface(before);
        setStatus("error");
        const message = err instanceof Error ? err.message : "Erro ao salvar";
        setErrorMsg(message);
        showToast("error", message);
        throw err;
      }
    },
    [surface],
  );

  const saveBlocks = useCallback(
    async (blocks: ProductContentBlock[]) => {
      if (!ready) {
        // Draft mode: keep the editor's state in memory only — flushDrafts will
        // persist once the product is saved.
        setSurface((prev) => ({ ...prev, blocks }));
        snapshotRef.current = { ...snapshotRef.current, blocks };
        return;
      }
      await runSave(
        () =>
          setSurface((prev) => ({
            ...prev,
            blocks,
          })),
        () =>
          api.replaceContentBlocks(merchantId!, productId!, {
            blocks: blocks.map((b) => ({
              id: b.id,
              type: b.type,
              props: b.props,
              order: b.order,
              isEnabled: b.isEnabled,
            })),
          }).then(() => undefined),
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const saveFaq = useCallback(
    async (payload: UpsertFaqPayload & { productId: string }) => {
      if (!ready) {
        const localId = payload.id ?? `draft-faq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const localFaq: ProductFaq = {
          id: localId,
          productId: "",
          question: payload.question,
          answer: payload.answer,
          order: payload.order,
          isPublished: payload.isPublished,
        };
        setSurface((prev) => {
          const without = prev.faqs.filter((f) => f.id !== localId);
          const next = [...without, localFaq].sort((a, b) => a.order - b.order);
          return { ...prev, faqs: next };
        });
        return;
      }
      await runSave(
        () => undefined,
        async () => {
          const saved = await api.upsertFaq(merchantId!, productId!, {
            id: payload.id,
            question: payload.question,
            answer: payload.answer,
            order: payload.order,
            isPublished: payload.isPublished,
          });
          setSurface((prev) => {
            const without = prev.faqs.filter((f) => f.id !== saved.id);
            const next = [...without, saved].sort((a, b) => a.order - b.order);
            return { ...prev, faqs: next };
          });
        },
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const removeFaq = useCallback(
    async (id: string) => {
      if (!ready) {
        setSurface((prev) => ({ ...prev, faqs: prev.faqs.filter((f) => f.id !== id) }));
        return;
      }
      await runSave(
        () => setSurface((prev) => ({ ...prev, faqs: prev.faqs.filter((f) => f.id !== id) })),
        () => api.deleteFaq(merchantId!, productId!, id).then(() => undefined),
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const reorderFaqs = useCallback(
    async (orderedIds: string[]) => {
      if (!ready) {
        setSurface((prev) => {
          const map = new Map(prev.faqs.map((f) => [f.id, f]));
          const next = orderedIds
            .map((id, idx) => {
              const faq = map.get(id);
              if (!faq) return null;
              return { ...faq, order: idx };
            })
            .filter((f): f is ProductFaq => f !== null);
          return { ...prev, faqs: next };
        });
        return;
      }
      await runSave(
        () =>
          setSurface((prev) => {
            const map = new Map(prev.faqs.map((f) => [f.id, f]));
            const next = orderedIds
              .map((id, idx) => {
                const faq = map.get(id);
                if (!faq) return null;
                return { ...faq, order: idx };
              })
              .filter((f): f is ProductFaq => f !== null);
            return { ...prev, faqs: next };
          }),
        () => api.reorderFaqs(merchantId!, productId!, { orderedIds }).then(() => undefined),
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const saveTestimonial = useCallback(
    async (payload: UpsertTestimonialPayload & { productId: string }) => {
      if (!ready) {
        const localId =
          payload.id ?? `draft-testimonial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const local: ProductTestimonial = {
          id: localId,
          productId: "",
          authorName: payload.authorName,
          authorAvatarUrl: payload.authorAvatarUrl ?? null,
          body: payload.body,
          rating: payload.rating ?? null,
          source: "curated",
          order: payload.order,
          isPublished: payload.isPublished,
          moderationStatus: payload.moderationStatus ?? "pending",
        };
        setSurface((prev) => {
          const without = prev.testimonials.filter((t) => t.id !== localId);
          const next = [...without, local].sort((a, b) => a.order - b.order);
          return { ...prev, testimonials: next };
        });
        return;
      }
      await runSave(
        () => undefined,
        async () => {
          const saved = await api.upsertTestimonial(merchantId!, productId!, {
            id: payload.id,
            authorName: payload.authorName,
            authorAvatarUrl: payload.authorAvatarUrl,
            body: payload.body,
            rating: payload.rating,
            order: payload.order,
            isPublished: payload.isPublished,
            moderationStatus: payload.moderationStatus,
          });
          setSurface((prev) => {
            const without = prev.testimonials.filter((t) => t.id !== saved.id);
            const next = [...without, saved].sort((a, b) => a.order - b.order);
            return { ...prev, testimonials: next };
          });
        },
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const removeTestimonial = useCallback(
    async (id: string) => {
      if (!ready) {
        setSurface((prev) => ({
          ...prev,
          testimonials: prev.testimonials.filter((t) => t.id !== id),
        }));
        return;
      }
      await runSave(
        () =>
          setSurface((prev) => ({
            ...prev,
            testimonials: prev.testimonials.filter((t) => t.id !== id),
          })),
        () => api.deleteTestimonial(merchantId!, productId!, id).then(() => undefined),
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const moderateTestimonial = useCallback(
    async (id: string, action: "approved" | "rejected", isPublished: boolean) => {
      if (!ready) {
        setSurface((prev) => ({
          ...prev,
          testimonials: prev.testimonials.map((t) =>
            t.id === id ? { ...t, isPublished, moderationStatus: action } : t,
          ),
        }));
        return;
      }
      await runSave(
        () => undefined,
        async () => {
          const updated = await api.moderateTestimonial(
            merchantId!,
            productId!,
            id,
            action,
            isPublished,
          );
          setSurface((prev) => ({
            ...prev,
            testimonials: prev.testimonials.map((testimonial) =>
              testimonial.id === updated.id ? { ...testimonial, ...updated } : testimonial,
            ),
          }));
        },
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const saveVideo = useCallback(
    async (payload: UpsertVideoPayload & { productId: string }) => {
      if (!ready) {
        const localId = payload.id ?? `draft-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const local: ProductVideo = {
          id: localId,
          productId: "",
          title: payload.title,
          videoUrl: payload.videoUrl,
          thumbnailUrl: payload.thumbnailUrl ?? null,
          durationSeconds: payload.durationSeconds ?? null,
          source: "merchant",
          order: payload.order,
          isPublished: payload.isPublished,
          moderationStatus: payload.moderationStatus ?? "pending",
        };
        setSurface((prev) => {
          const without = prev.videos.filter((v) => v.id !== localId);
          const next = [...without, local].sort((a, b) => a.order - b.order);
          return { ...prev, videos: next };
        });
        return;
      }
      await runSave(
        () => undefined,
        async () => {
          const saved = await api.upsertVideo(merchantId!, productId!, {
            id: payload.id,
            title: payload.title,
            videoUrl: payload.videoUrl,
            thumbnailUrl: payload.thumbnailUrl,
            durationSeconds: payload.durationSeconds,
            order: payload.order,
            isPublished: payload.isPublished,
            moderationStatus: payload.moderationStatus,
          });
          setSurface((prev) => {
            const without = prev.videos.filter((v) => v.id !== saved.id);
            const next = [...without, saved].sort((a, b) => a.order - b.order);
            return { ...prev, videos: next };
          });
        },
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const removeVideo = useCallback(
    async (id: string) => {
      if (!ready) {
        setSurface((prev) => ({
          ...prev,
          videos: prev.videos.filter((v) => v.id !== id),
        }));
        return;
      }
      await runSave(
        () =>
          setSurface((prev) => ({
            ...prev,
            videos: prev.videos.filter((v) => v.id !== id),
          })),
        () => api.deleteVideo(merchantId!, productId!, id).then(() => undefined),
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  const moderateVideo = useCallback(
    async (id: string, action: "approved" | "rejected", isPublished: boolean) => {
      if (!ready) {
        setSurface((prev) => ({
          ...prev,
          videos: prev.videos.map((v) =>
            v.id === id ? { ...v, isPublished, moderationStatus: action } : v,
          ),
        }));
        return;
      }
      await runSave(
        () => undefined,
        async () => {
          const updated = await api.moderateVideo(
            merchantId!,
            productId!,
            id,
            action,
            isPublished,
          );
          setSurface((prev) => ({
            ...prev,
            videos: prev.videos.map((video) =>
              video.id === updated.id ? { ...video, ...updated } : video,
            ),
          }));
        },
      );
    },
    [api, merchantId, productId, ready, runSave],
  );

  // Flush drafts (saved while productId was null) to the API. Only runs after
  // productId is truthy. The hook's transition effect (above) calls this
  // automatically; tests / external callers can trigger it manually.
  const flushDrafts = useCallback(async () => {
    if (!ready) return;
    const snapshot = snapshotRef.current;
    if (
      snapshot.blocks.length === 0 &&
      snapshot.faqs.length === 0 &&
      snapshot.testimonials.length === 0 &&
      snapshot.videos.length === 0
    ) {
      return;
    }
    setStatus("saving");
    setErrorMsg(null);
    try {
      if (snapshot.blocks.length > 0) {
        await api.replaceContentBlocks(merchantId!, productId!, {
          blocks: snapshot.blocks.map((b) => ({
            id: b.id,
            type: b.type,
            props: b.props,
            order: b.order,
            isEnabled: b.isEnabled,
          })),
        });
      }
      for (const f of snapshot.faqs) {
        await api.upsertFaq(merchantId!, productId!, {
          id: undefined,
          question: f.question,
          answer: f.answer,
          order: f.order,
          isPublished: f.isPublished,
        });
      }
      for (const t of snapshot.testimonials) {
        await api.upsertTestimonial(merchantId!, productId!, {
          id: undefined,
          authorName: t.authorName,
          authorAvatarUrl: t.authorAvatarUrl ?? undefined,
          body: t.body,
          rating: t.rating ?? undefined,
          order: t.order,
          isPublished: t.isPublished,
          moderationStatus: t.moderationStatus,
        });
      }
      for (const v of snapshot.videos) {
        await api.upsertVideo(merchantId!, productId!, {
          id: undefined,
          title: v.title,
          videoUrl: v.videoUrl,
          thumbnailUrl: v.thumbnailUrl ?? undefined,
          durationSeconds: v.durationSeconds ?? undefined,
          order: v.order,
          isPublished: v.isPublished,
          moderationStatus: v.moderationStatus,
        });
      }
      // After a successful flush, drop the draft IDs by reloading from the API.
      await reload();
      showToast("success", "Conteúdo avançado sincronizado com o produto.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao sincronizar conteúdo avançado";
      setErrorMsg(message);
      setStatus("error");
      showToast("error", message);
      throw err;
    }
  }, [api, merchantId, productId, ready, reload]);

  // Stash the latest flushDrafts so the transition effect can call it without
  // re-triggering on every render.
  const flushDraftsInternalRef = useRef<(() => Promise<void>) | null>(null);
  flushDraftsInternalRef.current = flushDrafts;

  return {
    surface,
    status,
    loading: status === "loading",
    errorMsg,
    isDraft: !ready,
    reload,
    saveBlocks,
    saveFaq,
    removeFaq,
    reorderFaqs,
    saveTestimonial,
    removeTestimonial,
    moderateTestimonial,
    saveVideo,
    removeVideo,
    moderateVideo,
    flushDrafts,
    enabled,
    setEnabled,
    testimonialsVisible,
    setTestimonialsVisible,
  };
}
