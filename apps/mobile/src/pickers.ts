import type { PickedFile } from "@verikora/client";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";

/** Where a document comes from: a PDF in the Files app, a photo of it, or the camera. */
export const SOURCE = { pdf: "pdf", photo: "photo", camera: "camera" } as const;
export type Source = (typeof SOURCE)[keyof typeof SOURCE];

export const PDF_NAME = (base: string) => `${base.replace(/\.[^.]+$/, "") || "document"}.pdf`;

/** A page of the phone's picture, as an A4 PDF: the check reads files, and a scan is an image of a page. */
export const pageHtml = (base64: string, mime: string): string =>
  `<html><body style="margin:0"><img style="width:100%" src="data:${mime};base64,${base64}"/></body></html>`;

async function imageToPdf(asset: ImagePicker.ImagePickerAsset): Promise<PickedFile> {
  const { uri } = await Print.printToFileAsync({ html: pageHtml(asset.base64 ?? "", asset.mimeType ?? "image/jpeg") });
  return { uri, name: PDF_NAME(asset.fileName ?? "scan"), mimeType: "application/pdf", size: asset.fileSize ?? null };
}

const IMAGE_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.8 };

/** The person's pick, or null when they cancel. */
export async function pick(source: Source): Promise<PickedFile | null> {
  if (source === SOURCE.pdf) {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/plain"],
      copyToCacheDirectory: true,
    });
    const file = result.canceled ? null : result.assets[0];
    return file ? { uri: file.uri, name: file.name, mimeType: file.mimeType ?? null, size: file.size ?? null } : null;
  }
  if (source === SOURCE.camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return null;
  const result = await (source === SOURCE.camera
    ? ImagePicker.launchCameraAsync(IMAGE_OPTIONS)
    : ImagePicker.launchImageLibraryAsync(IMAGE_OPTIONS));
  const asset = result.canceled ? null : result.assets[0];
  return asset ? imageToPdf(asset) : null;
}
