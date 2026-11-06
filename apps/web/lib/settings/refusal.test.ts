import { describe, expect, it } from "vitest";

import { settingsRefusal } from "./refusal";
import { SettingsError } from "./service";

describe("a setting refused is a clean answer, whatever copy of the class threw it (verikora#252)", () => {
  it("the service's own error becomes its status and code", () => {
    expect(
      settingsRefusal(new SettingsError(400, "BAD_SCOPE", "plans.free.apiKeys cannot be set at the user level")),
    ).toMatchObject({ status: 400, body: { code: "BAD_SCOPE" } });
  });

  it("so does an error of another copy of the class — the case that answered 500", () => {
    class Foreign extends Error {
      name = "SettingsError";
      status = 400;
      code = "BAD_SCOPE";
    }
    expect(settingsRefusal(new Foreign("cannot be set at the user level"))).toMatchObject({
      status: 400,
      body: { code: "BAD_SCOPE" },
    });
  });

  it("anything else stays unexpected (a 500 that leaks nothing)", () => {
    for (const error of [
      new Error("boom"),
      null,
      "SettingsError",
      { name: "SettingsError" },
      { name: "SettingsError", status: "400", code: "X" },
    ])
      expect(settingsRefusal(error)).toBeNull();
  });
});
