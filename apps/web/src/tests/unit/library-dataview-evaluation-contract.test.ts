import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIBRARY_CLIENT_PATH = path.join(
  process.cwd(),
  "src/app/(app)/library/library-page-client.tsx",
);

describe("library DataView evaluation contract", () => {
  it("keeps the three explicit view-mode branches used by the evaluation", () => {
    const source = fs.readFileSync(LIBRARY_CLIENT_PATH, "utf8");

    expect(source).toContain(
      'type LibraryViewMode = "list" | "grid" | "table"',
    );
    expect(source).toContain('{viewMode === "table" ? (');
    expect(source).toContain('{viewMode === "list" ? (');
    expect(source).toContain('{viewMode === "grid" ? (');
  });

  it("keeps selector and interaction anchors referenced by the evaluation", () => {
    const source = fs.readFileSync(LIBRARY_CLIENT_PATH, "utf8");

    expect(source).toContain('data-test="library-view-select"');
    expect(source).toContain('data-test="library-data-view"');
    expect(source).toContain('data-test="library-items-grid"');
    expect(source).toContain('data-test="library-paginator"');
    expect(source).toContain("openContextMenuForItem");
    expect(source).toContain("openContextMenuFromKeyboard");
    expect(source).toContain("<Paginator");
    expect(source).toContain("onPageChange={(event) => {");
    expect(source).toContain("status: statusFilter || undefined");
    expect(source).toContain("visibility: visibilityFilter || undefined");
    expect(source).toContain("tag: tagFilter || undefined");
  });
});
