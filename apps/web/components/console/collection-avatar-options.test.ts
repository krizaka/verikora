import { defaultAvatarUrl } from "@krizaka/ui/avatar/defaults";
import { describe, expect, it } from "vitest";

import { folderAvatarOptions } from "./collection-avatar-options";

describe("a folder's avatar tiles (verikora#433)", () => {
  const options = folderAvatarOptions(["a", "b", "c", "d"], (n) => `Avatar ${n}`);

  it("are all of the folder kind: a folder never lists a person avatar", () => {
    expect(options).toHaveLength(4);
    for (const o of options) {
      expect(o.kind).toBe("folder");
      expect(o.defaultAvatar?.kind).toBe("folder");
      expect(o.defaultAvatar?.kind).not.toBe("person");
    }
  });

  it("draw a folder glyph in the page (a data URL), never a person's silhouette picture of the CDN", () => {
    for (const o of options) {
      const url = defaultAvatarUrl(o.defaultAvatar!);
      expect(url.startsWith("data:image/svg+xml,")).toBe(true);
      expect(decodeURIComponent(url)).not.toContain("<circle");
      expect(url).not.toContain("people/defaults");
    }
  });

  it("are named for assistive technology, one name each, the seed is the value", () => {
    expect(options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(new Set(options.map((o) => o.label)).size).toBe(4);
  });
});
