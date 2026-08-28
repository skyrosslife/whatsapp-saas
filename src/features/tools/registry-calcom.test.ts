import { describe, it, expect } from "vitest";
import { registry } from "./index";

describe("registry — Cal.com tools", () => {
  it("has all four calcom tools registered", () => {
    const names = registry.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "calcom_check_availability",
        "calcom_book",
        "calcom_reschedule",
        "calcom_cancel",
      ]),
    );
  });

  it("keeps the existing HighLevel tools registered", () => {
    const names = registry.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["check_availability", "schedule_highlevel"]),
    );
  });
});
