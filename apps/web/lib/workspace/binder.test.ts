import { describe, expect, it } from "vitest";

import { binderPlan } from "./binder";
import { DECISION } from "./decl";
import { DECISION_SET } from "./defaults";

describe("the binder's plan (verikora#334)", () => {
  const plan = binderPlan(DECISION_SET, ["t1", "t2"], { tags: ["t1"], status: [DECISION.selected] });

  it("makes a tab per state of the set, after « Tous », in the set's order", () => {
    expect(plan.tabs.map((t) => t.state)).toEqual([null, DECISION.toDecide, DECISION.selected, DECISION.notSelected]);
    expect(plan.tabs.map((t) => t.hue)).toEqual(["accent", "warning", "success", "neutral"]);
  });

  it("opens each tab on the address's other filters with the tab's decision, and « Tous » without any", () => {
    expect(plan.tabs[0]!.filters).toEqual({ tags: ["t1"] });
    expect(plan.tabs[1]!.filters).toEqual({ tags: ["t1"], status: [DECISION.toDecide] });
    expect(plan.activeState).toBe(DECISION.selected);
  });

  it("toggles a tag chip, and counts it within the rest of the address", () => {
    const [on, off] = plan.chips;
    expect(on).toMatchObject({
      id: "t1",
      on: true,
      filters: { status: [DECISION.selected] },
      countFilters: { tags: ["t1"], status: [DECISION.selected] },
    });
    expect(off).toMatchObject({
      id: "t2",
      on: false,
      filters: { tags: ["t1", "t2"], status: [DECISION.selected] },
      countFilters: { tags: ["t1", "t2"], status: [DECISION.selected] },
    });
  });

  it("has no active state without a decision filter", () => {
    expect(binderPlan(DECISION_SET, [], {}).activeState).toBeNull();
    expect(binderPlan(DECISION_SET, [], { status: [DECISION.toDecide, DECISION.selected] }).activeState).toBe(
      "multiple",
    );
  });
});
