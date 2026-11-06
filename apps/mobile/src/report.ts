import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { Locale } from "@/domain/links";

import { verikora } from "./config";

/** Downloads the signed report (the same PDF as the web's, SHA-256 attested) and opens the share sheet on it. */
export async function shareSignedReport(documentId: string, analysisId: string, locale: Locale): Promise<void> {
  const { url, headers } = await verikora.reportRequest(documentId, analysisId, locale);
  const file = await File.downloadFileAsync(url, Paths.cache, { headers, idempotent: true });
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}
