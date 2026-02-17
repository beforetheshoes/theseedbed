import { describe, expect, it } from "vitest";
import { appNavItems } from "@/lib/navigation";

describe("navigation config", () => {
  it("includes key app routes", () => {
    expect(appNavItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Library", to: "/library" }),
        expect.objectContaining({ label: "Settings", to: "/settings" }),
      ]),
    );
  });
});
