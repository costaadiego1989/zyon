"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import DOMPurify, { type Config } from "dompurify";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Sanitizes with the browser DOM, without loading jsdom into Vercel's SSR
 * runtime. The empty server snapshot also keeps hydration deterministic. */
export function SafeStoreHtml({
  html,
  style,
  config,
}: {
  html: string;
  style?: CSSProperties;
  config?: Config;
}) {
  const hasDOM = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const sanitized = useMemo(
    () => hasDOM ? String(DOMPurify.sanitize(html, config)) : "",
    [hasDOM, html, config],
  );
  return <div style={style} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
