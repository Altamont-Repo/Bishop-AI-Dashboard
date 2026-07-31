import type { Dataset } from "../domain/types";
import type { Repository } from "./repository";
import { buildSeed } from "./seed";

/**
 * In-memory repository — seeds a fresh dataset on load, no persistence.
 * (User decision: data resets on refresh in this build.)
 */
export class MemoryRepository implements Repository {
  async load(): Promise<Dataset> {
    return buildSeed();
  }
  async save(_ds: Dataset): Promise<void> {
    // no-op: session-only. A SupabaseRepository will implement real writes here.
  }
}

export const repository: Repository = new MemoryRepository();
