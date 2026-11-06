import { describe, expect, it } from "vitest";

import { planChangeRefusal, roleChangeRefusal } from "./admin";

describe("who may change a role", () => {
  it("never your own", () => {
    expect(roleChangeRefusal("a", "a", "USER", 3, "ADMIN")).toMatchObject({ code: "SELF_ROLE" });
  });
  it("never withdraws the last administrator", () => {
    expect(roleChangeRefusal("a", "b", "USER", 1, "ADMIN")).toMatchObject({ code: "LAST_ADMIN" });
  });
  it("lets an administrator withdraw another while one remains, and grant the role", () => {
    expect(roleChangeRefusal("a", "b", "USER", 2, "ADMIN")).toBeNull();
    expect(roleChangeRefusal("a", "b", "ADMIN", 1, "USER")).toBeNull();
  });
  it("treats a change to the role already held as nothing to refuse", () => {
    expect(roleChangeRefusal("a", "a", "ADMIN", 1, "ADMIN")).toBeNull();
  });
});

describe("who may put an account on a plan by hand (verikora#252)", () => {
  it("only a development environment: in production the plan follows the subscription", () => {
    expect(planChangeRefusal("prod")).toMatchObject({ code: "PLAN_BY_HAND_IN_PRODUCTION" });
    expect(planChangeRefusal("dev")).toBeNull();
  });
});
