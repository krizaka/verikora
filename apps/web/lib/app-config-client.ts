"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { z } from "zod";

const config = z.object({
  config: z.object({
    maxFileBytes: z.number(),
    allowedTypes: z.array(z.string()),
    features: z.object({
      keepDocuments: z.boolean(),
      ownStorage: z.boolean(),
      documentInsight: z.boolean(),
      assistant: z.boolean(),
      batches: z.boolean().default(false),
    }),
    payments: z.object({ enabled: z.boolean(), display: z.string() }),
    avatars: z.object({
      enabled: z.boolean(),
      maxBytes: z.number(),
      seeds: z.array(z.string()),
      canUpload: z.boolean(),
    }),
  }),
});
export type ClientAppConfig = z.infer<typeof config>["config"];

/** The configuration that applies to this person, as the server resolved it (the browser never decides; it only reflects). */
export function useAppConfig(): ClientAppConfig | undefined {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: () => krizakaFetch("/api/me/app", { schema: config }).then((r) => r.config),
    staleTime: 30_000,
    throwOnError: false,
    retry: false,
  }).data;
}
