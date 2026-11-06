import { ApiError } from "@krizaka/app-client";
import { useMutation, useQueryClient } from "@krizaka/query";
import { type BatchCheck, DEFAULT_LIMITS, keys } from "@verikora/client";

import { verikora } from "./config";
import { localDocuments } from "./local-documents";
import { prepare, type Prepared, Refused } from "./prepare";
import { type Route } from "./route";

/** How many files of a batch stayed on this Mac (unreadable, refused by the pre-flight), for its screen. This session only. */
export const keptOnMac = new Map<string, number>();

const PAYWALL_STATUS = 402;
const FORBIDDEN_STATUS = 403;

export interface BatchRequest {
  name: string;
  paths: readonly string[];
  check?: BatchCheck;
}

/**
 * A batch from the Mac (verikora#232): several documents — a folder, the files dropped together, the arrivals of a watched
 * folder — each read and pre-flighted here (a refused file stays on the Mac and is counted), the others sent as one batch.
 * Each row's document is remembered with its file, so its signed report lands next to it.
 */
export function useBatch(onStarted: (route: Route) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      paths,
      check = "compliance",
    }: BatchRequest): Promise<{ route: Route; refused: number }> => {
      const limits = await verikora.fetchLimits().catch(() => DEFAULT_LIMITS);
      // A file that cannot be read or is refused by the pre-flight stays on the Mac; the others go.
      const prepared = await Promise.all(paths.map((path) => prepare(path, limits).catch(() => null)));
      const ready = prepared.filter((file): file is Prepared => file !== null);
      if (ready.length === 0) throw new Refused("unreadable");
      try {
        const batch = await verikora.createBatch(name, ready, check);
        rememberFiles(batch.items, ready);
        keptOnMac.set(batch.id, paths.length - ready.length);
        return { route: { screen: "batch", batchId: batch.id }, refused: paths.length - ready.length };
      } catch (error) {
        if (error instanceof ApiError && error.status === PAYWALL_STATUS) throw new Refused("paywall");
        if (error instanceof ApiError && error.status === FORBIDDEN_STATUS) throw new Refused("feature");
        throw new Refused("failed");
      }
    },
    onSuccess: async ({ route }) => {
      await queryClient.invalidateQueries({ queryKey: keys.batches() });
      onStarted(route);
    },
  });
}

/** Each row's document with the file of the Mac it came from (matched by name, as the server matched the rows). */
export function rememberFiles(
  items: readonly { file: string; documentId: string | null }[],
  files: readonly Pick<Prepared, "name" | "path">[],
): void {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f.path]));
  for (const item of items) {
    const path = byName.get(item.file.toLowerCase());
    if (item.documentId && path) localDocuments.remember(item.documentId, path);
  }
}
