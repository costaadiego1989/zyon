import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "../../components/Toast.js";
import type { ImportJobStatus } from "../../api/endpoints/catalog.js";

export interface BackgroundImportJob {
  jobId: string;
  fileName: string;
  merchantId: string;
  status: "processing" | "completed" | "failed";
  totalRows?: number;
  successRows?: number;
  failedRows?: number;
  errors?: ImportJobStatus["errors"];
  startedAt: number;
  settledAt?: number;
  reason?: string;
  job?: ImportJobStatus;
}

export interface ImportProgressApi {
  imports: BackgroundImportJob[];
  startImport: (jobId: string, fileName: string, merchantId: string) => void;
  dismissImport: (jobId: string) => void;
  refreshImport: (jobId: string) => Promise<void>;
}

const STORAGE_KEY = "zyon.imports.v1";
const POLL_INTERVAL_MS = 2000;
const MAX_AGE_MS = 30 * 60 * 1000;

type GetImportJobFn = (merchantId: string, jobId: string) => Promise<ImportJobStatus>;

const ImportProgressContext = createContext<ImportProgressApi | null>(null);

function safeReadStorage(): BackgroundImportJob[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const cutoff = Date.now() - MAX_AGE_MS;
    const kept: BackgroundImportJob[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const jobId = typeof item.jobId === "string" ? item.jobId : null;
      if (!jobId) continue;
      if (typeof item.startedAt !== "number") continue;
      if (item.status !== "processing" && item.startedAt < cutoff) continue;
      kept.push({
        jobId,
        fileName: typeof item.fileName === "string" ? item.fileName : "",
        merchantId: typeof item.merchantId === "string" ? item.merchantId : "",
        status: item.status === "completed" || item.status === "failed" ? item.status : "processing",
        totalRows: typeof item.totalRows === "number" ? item.totalRows : undefined,
        successRows: typeof item.successRows === "number" ? item.successRows : undefined,
        failedRows: typeof item.failedRows === "number" ? item.failedRows : undefined,
        errors: Array.isArray(item.errors) ? item.errors : undefined,
        startedAt: item.startedAt,
        settledAt: typeof item.settledAt === "number" ? item.settledAt : undefined,
        reason: typeof item.reason === "string" ? item.reason : undefined,
        job: item.job,
      });
    }
    return kept;
  } catch {
    return null;
  }
}

function safeWriteStorage(jobs: BackgroundImportJob[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    /* storage may be full or disabled */
  }
}

function pruneJobs(jobs: BackgroundImportJob[]): BackgroundImportJob[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return jobs.filter((j) => {
    if (j.status === "processing") return true;
    const ts = j.settledAt ?? j.startedAt;
    return ts >= cutoff;
  });
}

export interface ImportProgressProviderProps {
  children: React.ReactNode;
  getImportJob: GetImportJobFn;
}

export function ImportProgressProvider({ children, getImportJob }: ImportProgressProviderProps) {
  const [imports, setImports] = useState<BackgroundImportJob[]>(() => {
    const hydrated = safeReadStorage();
    return hydrated ?? [];
  });
  const inflightRef = useRef<Set<string>>(new Set());
  const getImportJobRef = useRef(getImportJob);
  getImportJobRef.current = getImportJob;

  useEffect(() => {
    setImports((prev) => pruneJobs(prev));
  }, []);

  const updateJob = useCallback((jobId: string, patch: Partial<BackgroundImportJob>) => {
    setImports((prev) => prev.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)));
  }, []);

  const pollOne = useCallback(
    async (jobId: string) => {
      if (inflightRef.current.has(jobId)) return;
      const target = importsRef.current.find((j) => j.jobId === jobId);
      if (!target) return;
      if (target.status !== "processing") return;
      const fn = getImportJobRef.current;
      if (!fn) return;
      inflightRef.current.add(jobId);
      try {
        const job = await fn(target.merchantId, jobId);
        if (job.status === "completed") {
          const success = job.successRows ?? 0;
          showToast("success", `Importação concluída: ${success} produto${success !== 1 ? "s" : ""}`);
          updateJob(jobId, {
            status: "completed",
            job,
            totalRows: job.totalRows,
            successRows: job.successRows,
            failedRows: job.failedRows,
            errors: job.errors,
            settledAt: Date.now(),
          });
        } else if (job.status === "failed") {
          const first = job.errors?.[0]?.reason ?? "Falha ao processar planilha";
          showToast("error", `Falha na importação: ${first}`);
          updateJob(jobId, {
            status: "failed",
            job,
            reason: first,
            totalRows: job.totalRows,
            successRows: job.successRows,
            failedRows: job.failedRows,
            errors: job.errors,
            settledAt: Date.now(),
          });
        } else {
          updateJob(jobId, { job });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast("error", `Erro ao consultar importação: ${msg}`);
      } finally {
        inflightRef.current.delete(jobId);
      }
    },
    [updateJob],
  );

  const importsRef = useRef<BackgroundImportJob[]>(imports);
  importsRef.current = imports;

  const processingIdsKey = useMemo(
    () => imports.filter((j) => j.status === "processing").map((j) => j.jobId).sort().join("|"),
    [imports],
  );

  useEffect(() => {
    if (!processingIdsKey) return;
    const ids = processingIdsKey.split("|");
    const interval = setInterval(() => {
      for (const id of ids) void pollOne(id);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [processingIdsKey, pollOne]);

  // Persist after every change (skip initial empty if no items at all)
  useEffect(() => {
    safeWriteStorage(pruneJobs(imports));
  }, [imports]);

  const startImport = useCallback((jobId: string, fileName: string, merchantId: string) => {
    setImports((prev) => {
      const filtered = prev.filter((j) => j.jobId !== jobId);
      return [
        ...filtered,
        {
          jobId,
          fileName,
          merchantId,
          status: "processing",
          startedAt: Date.now(),
        },
      ];
    });
  }, []);

  const dismissImport = useCallback((jobId: string) => {
    setImports((prev) => prev.filter((j) => j.jobId !== jobId));
  }, []);

  const refreshImport = useCallback(
    async (jobId: string) => {
      await pollOne(jobId);
    },
    [pollOne],
  );

  const value = useMemo<ImportProgressApi>(
    () => ({ imports, startImport, dismissImport, refreshImport }),
    [imports, startImport, dismissImport, refreshImport],
  );

  return <ImportProgressContext.Provider value={value}>{children}</ImportProgressContext.Provider>;
}

export function useImportProgress(): ImportProgressApi {
  const ctx = useContext(ImportProgressContext);
  if (!ctx) {
    throw new Error("useImportProgress deve ser usado dentro de <ImportProgressProvider>");
  }
  return ctx;
}
