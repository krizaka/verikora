import type { SectionId } from "@verikora/core";

/**
 * The URL is the state, in the window too: the screen is the hash, so a refresh, the back button and a link kept in the
 * notes all come back to the same place.
 *
 *   #/library                  the folders
 *   #/library/<folder>         one folder's documents (the folder's path, encoded)
 *   #/check/<document>/<run>   a check being followed
 *   #/documents/<document>     a document's checks (its latest opens)
 *   #/batches                  the batches
 *   #/batches/<batch>          a batch being followed
 *   #/reports                  the documents checked, with their reports
 *   #/settings
 */
export type Route =
  | { screen: "library"; folder: string | null }
  | { screen: "check"; documentId: string; analysisId: string }
  | { screen: "document"; documentId: string }
  | { screen: "batches" }
  | { screen: "batch"; batchId: string }
  | { screen: "reports" }
  | { screen: "settings" };

export type Screen = Route["screen"];

export const HOME: Route = { screen: "library", folder: null };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (first === "check" && second && third) return { screen: "check", documentId: second, analysisId: third };
  if (first === "documents" && second) return { screen: "document", documentId: second };
  if (first === "batches") return second ? { screen: "batch", batchId: second } : { screen: "batches" };
  if (first === "reports") return { screen: "reports" };
  if (first === "settings") return { screen: "settings" };
  if (first === "library" && second) return { screen: "library", folder: second };
  return HOME;
}

export function hashOf(route: Route): string {
  switch (route.screen) {
    case "check":
      return `#/check/${encodeURIComponent(route.documentId)}/${encodeURIComponent(route.analysisId)}`;
    case "document":
      return `#/documents/${encodeURIComponent(route.documentId)}`;
    case "batches":
      return "#/batches";
    case "batch":
      return `#/batches/${encodeURIComponent(route.batchId)}`;
    case "reports":
      return "#/reports";
    case "settings":
      return "#/settings";
    case "library":
      return route.folder ? `#/library/${encodeURIComponent(route.folder)}` : "#/library";
  }
}

/**
 * The screen a web link opens (`verikora://app/…` or `https://www.verikora.com/app/…`, already turned into a path by the
 * native side): the same place as on the web. A path the Mac app has no screen for opens the library.
 */
export function routeOfLink(link: string): Route {
  const path = link.split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "app") return HOME;
  const [, section, id] = parts;
  if (section === "documents" && id) return { screen: "document", documentId: id };
  if ((section === "check" && id === "batches") || (section === "verifier" && id === "lots"))
    return parts[3] ? { screen: "batch", batchId: parts[3] } : { screen: "batches" };
  if (section === "verifications")
    return new URLSearchParams(link.split("?")[1]?.split("#")[0] ?? "").get("tab") === "lots"
      ? { screen: "batches" }
      : { screen: "reports" };
  if (section === "settings") return { screen: "settings" };
  return HOME;
}

/** The sidebar entry a screen belongs to: a destination of the section map (the batches are a tab of Vérifications), or the settings. */
export function sectionOf(route: Route): Extract<SectionId, "library" | "checks"> | "settings" {
  switch (route.screen) {
    case "batches":
    case "batch":
    case "reports":
    case "document":
      return "checks";
    case "settings":
      return "settings";
    default:
      return "library";
  }
}
