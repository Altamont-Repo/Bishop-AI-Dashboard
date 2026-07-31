import type { Dataset } from "../domain/types";

/**
 * The data seam. Release 1 uses an in-memory implementation; a Supabase-backed
 * implementation will satisfy the same contract later (BRD FR-ERP-1 — order
 * intake / persistence abstracted behind a service). Keeping this async means
 * the swap to Supabase requires no changes above this layer.
 */
export interface Repository {
  load(): Promise<Dataset>;
  /** Persist a full snapshot. In-memory: no-op. Supabase: upsert/diff. */
  save(ds: Dataset): Promise<void>;
}
