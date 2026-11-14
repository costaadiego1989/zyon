/**
 * Backward-compatible barrel re-export.
 * All implementation now lives under `./api/`.
 * This file is kept to preserve existing imports across 30+ call sites.
 */
export * from "./api/index.js";
