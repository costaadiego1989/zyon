"use client";

import { useRef, useState } from "react";
import { FiCheckCircle, FiFilm, FiMessageSquare, FiSend, FiStar } from "react-icons/fi";
import { getValidBuyer } from "@/lib/buyer-auth";
import styles from "./CustomerReviewSubmission.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

type SubmissionKind = "testimonial" | "video";
type SubmissionState = "idle" | "sending" | "sent" | "error";

/**
 * Buyer-facing submission surface for the advanced product layout.
 *
 * A valid Buyer Hub session is required before the form submits. Without one,
 * the user is directed to the Hub to sign in or create an account. The server
 * resolves the merchant from the public slug, applies a per-route rate limit,
 * and always creates content as pending moderation.
 */
export function CustomerReviewSubmission({
  merchantSlug,
  productId,
  productName,
}: {
  merchantSlug?: string;
  productId?: string;
  productName?: string;
}) {
  const [kind, setKind] = useState<SubmissionKind>("testimonial");
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const [showAuthToast, setShowAuthToast] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);

  if (!merchantSlug || !productId) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === "sending") return;

    setState("sending");
    setMessage("");

    const buyer = getValidBuyer();
    if (!buyer?.token) {
      setState("idle");
      setShowAuthToast(true);
      return;
    }
    try {
      let response: Response;
      if (kind === "testimonial") {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Content-Type": "application/json",
        };
        headers.Authorization = `Bearer ${buyer.token}`;
        response = await fetch(
          `${API_BASE}/storefront/${encodeURIComponent(merchantSlug)}/products/${encodeURIComponent(productId)}/testimonials`,
          { method: "POST", headers, body: JSON.stringify({ authorName, body, rating }) },
        );
      } else {
        if (!videoFile) throw new Error("Escolha um vídeo MP4 para enviar.");
        if (videoFile.type !== "video/mp4") throw new Error("Envie um vídeo no formato MP4.");
        if (videoFile.size > MAX_VIDEO_BYTES) throw new Error("O vídeo pode ter no máximo 50 MB.");

        const authHeaders = {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyer.token}`,
        };
        const uploadResponse = await fetch(
          `${API_BASE}/storefront/${encodeURIComponent(merchantSlug)}/products/${encodeURIComponent(productId)}/videos/upload-url`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ contentType: "video/mp4", sizeBytes: videoFile.size }),
          },
        );
        if (!uploadResponse.ok) {
          if (uploadResponse.status === 401) {
            setState("idle");
            setShowAuthToast(true);
            return;
          }
          const result = await uploadResponse.json().catch(() => null) as { message?: string } | null;
          throw new Error(typeof result?.message === "string" ? result.message : "Não foi possível preparar o envio do vídeo.");
        }
        const upload = await uploadResponse.json() as {
          uploadUrl: string;
          uploadFields: Record<string, string>;
          videoUrl: string;
        };
        const uploadForm = new FormData();
        Object.entries(upload.uploadFields).forEach(([name, value]) => uploadForm.append(name, value));
        uploadForm.append("file", videoFile);
        const uploadToStorage = await fetch(upload.uploadUrl, {
          method: "POST",
          body: uploadForm,
        });
        if (!uploadToStorage.ok) throw new Error("Não foi possível enviar o vídeo. Tente novamente.");
        response = await fetch(
          `${API_BASE}/storefront/${encodeURIComponent(merchantSlug)}/products/${encodeURIComponent(productId)}/videos`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ title: videoTitle, videoUrl: upload.videoUrl }),
          },
        );
      }

      if (!response.ok) {
        if (response.status === 401) {
          setState("idle");
          setShowAuthToast(true);
          return;
        }
        if (response.status === 429) {
          throw new Error("Você enviou uma avaliação recentemente. Aguarde alguns minutos para enviar outra.");
        }
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(typeof result?.message === "string" ? result.message : "Não foi possível enviar sua avaliação agora.");
      }

      setState("sent");
      setAuthorName("");
      setBody("");
      setVideoTitle("");
      setVideoFile(null);
      if (videoInputRef.current) videoInputRef.current.value = "";
      setMessage("Recebemos sua contribuição. Ela aparecerá no produto após a aprovação da loja.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar sua avaliação agora.");
    }
  };

  return (
    <section className={styles.section} aria-labelledby="customer-review-heading">
      <div className={styles.intro}>
        <div className={styles.icon} aria-hidden="true">
          {kind === "testimonial" ? <FiMessageSquare /> : <FiFilm />}
        </div>
        <div>
          <h2 id="customer-review-heading">Conte sua experiência</h2>
          <p>
            Ajude outras pessoas com uma avaliação de {productName ?? "produto"}. A loja revisa cada envio antes de publicar.
          </p>
        </div>
      </div>

      {showAuthToast ? (
        <div className={styles.authToast} role="status" aria-live="polite">
          <div>
            <strong>Seu review merece uma conta segura.</strong>
            <span>Entre no Hub do usuário ou crie sua conta para enviar e acompanhar a aprovação.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowAuthToast(false);
              window.dispatchEvent(new Event("aacp:open-buyer-hub"));
            }}
          >
            Entrar ou criar conta
          </button>
          <button type="button" className={styles.dismissToast} onClick={() => setShowAuthToast(false)} aria-label="Fechar aviso">×</button>
        </div>
      ) : null}

      {state === "sent" ? (
        <p className={styles.success} role="status">
          <FiCheckCircle aria-hidden="true" />
          <span>{message}</span>
          <button type="button" onClick={() => { setState("idle"); setMessage(""); }}>
            Enviar outra
          </button>
        </p>
      ) : (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <div className={styles.kindSwitch} role="group" aria-label="Tipo de avaliação">
            <button type="button" aria-pressed={kind === "testimonial"} onClick={() => { setKind("testimonial"); setState("idle"); setMessage(""); }}>
              <FiMessageSquare aria-hidden="true" /> Avaliação escrita
            </button>
            <button type="button" aria-pressed={kind === "video"} onClick={() => { setKind("video"); setState("idle"); setMessage(""); }}>
              <FiFilm aria-hidden="true" /> Vídeo
            </button>
          </div>

          {kind === "testimonial" ? (
            <>
              <label>
                Seu nome
                <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={200} autoComplete="name" required />
              </label>
              <fieldset className={styles.rating}>
                <legend>Sua nota</legend>
                <div>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value} aria-label={`${value} de 5 estrelas`}>
                      <input type="radio" name="customer-review-rating" value={value} checked={rating === value} onChange={() => setRating(value)} />
                      <FiStar aria-hidden="true" fill={value <= rating ? "currentColor" : "none"} />
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Sua avaliação
                <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={4} required />
              </label>
            </>
          ) : (
            <>
              <label>
                Título do vídeo
                <input value={videoTitle} onChange={(event) => setVideoTitle(event.target.value)} maxLength={200} required />
              </label>
              <label>
                Arquivo de vídeo
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4"
                  onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
                  required
                />
                <small>Envie um arquivo MP4 de até 50 MB. O vídeo só aparece na loja após a aprovação.</small>
              </label>
            </>
          )}

          {state === "error" ? <p className={styles.error} role="alert">{message}</p> : null}
          <button className={styles.submit} type="submit" disabled={state === "sending"} aria-busy={state === "sending"}>
            <FiSend aria-hidden="true" />
            {state === "sending" ? "Enviando..." : "Enviar para aprovação"}
          </button>
        </form>
      )}
    </section>
  );
}
