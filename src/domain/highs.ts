import highsLoader from "highs";
// Vite resolves the package's "./runtime" export (the .wasm) to a served URL.
import wasmUrl from "highs/runtime?url";

export type HighsInstance = Awaited<ReturnType<typeof highsLoader>>;

let instance: Promise<HighsInstance> | null = null;

/** Lazily load the HiGHS WASM solver once and reuse it. */
export function loadHighs(): Promise<HighsInstance> {
  if (!instance) {
    instance = highsLoader({ locateFile: () => wasmUrl });
  }
  return instance;
}
