import { describe, expect, it } from "vitest";

import { findPage } from "./page-finder";
import type { Gray } from "./deskew";
import { VERIKORA_IMAGE_RULES } from "./rules";

const rules = VERIKORA_IMAGE_RULES.pageFinder;

/** A frame of `grey` with a white rectangle (text rows left white at 70 %). */
function frame(
  width: number,
  height: number,
  box: { left: number; top: number; right: number; bottom: number },
  grey = 200,
): Gray {
  const data = new Uint8Array(width * height).fill(grey);
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      data[y * width + x] = y % 6 < 2 && x % 10 < 3 ? 20 : 255;
    }
  }
  return { data, width, height };
}

describe("finding a rendered page", () => {
  it("finds the white rectangle inside a grey viewer, ink and all", () => {
    const box = findPage(frame(400, 800, { left: 20, top: 300, right: 379, bottom: 620 }), rules);
    expect(box).toEqual({ left: 20, top: 300, right: 379, bottom: 620 });
  });

  it("finds nothing when no rectangle is white enough or large enough", () => {
    expect(findPage(frame(400, 800, { left: 20, top: 300, right: 379, bottom: 620 }, 255 - 3), rules)).toBeNull();
    expect(findPage(frame(400, 800, { left: 150, top: 300, right: 200, bottom: 340 }), rules)).toBeNull();
    expect(findPage({ data: new Uint8Array(400 * 800).fill(120), width: 400, height: 800 }, rules)).toBeNull();
  });
});
