import type { PickedFile } from "@verikora/client";
import { File } from "expo-file-system";

/** One file as the multipart body the API reads. Expo's fetch takes a `File` as a part, not React Native's `{ uri, name, type }`. */
export function uploadForm(file: PickedFile): FormData {
  const form = new FormData();
  form.append("file", new File(file.uri), file.name);
  form.append("kind", "auto");
  return form;
}
