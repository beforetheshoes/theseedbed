import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRouteServerBootstrapResult } from "@/lib/app-route-server-bootstrap";

const { apiRequestWithAccessTokenMock, bootstrapAppRouteAccessTokenMock } =
  vi.hoisted(() => ({
    apiRequestWithAccessTokenMock: vi.fn(),
    bootstrapAppRouteAccessTokenMock: vi.fn<
      () => Promise<AppRouteServerBootstrapResult>
    >(async () => ({
      kind: "authed" as const,
      accessToken: "token-123",
    })),
  }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiRequestWithAccessToken: apiRequestWithAccessTokenMock,
  };
});

vi.mock("@/lib/app-route-server-bootstrap", () => ({
  bootstrapAppRouteAccessToken: bootstrapAppRouteAccessTokenMock,
}));

vi.mock("@/app/(app)/library/library-page-client", () => ({
  default: (props: unknown) => (
    <div data-test="library-client" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("@/app/(app)/books/search/book-search-page-client", () => ({
  default: (props: unknown) => (
    <div data-test="search-client" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("@/app/(app)/settings/settings-page-client", () => ({
  default: (props: unknown) => (
    <div data-test="settings-client" data-props={JSON.stringify(props)} />
  ),
}));

import BookSearchPage from "@/app/(app)/books/search/page";
import LibraryPage from "@/app/(app)/library/page";
import SettingsPage from "@/app/(app)/settings/page";

describe("app route server wrappers", () => {
  beforeEach(() => {
    apiRequestWithAccessTokenMock.mockReset();
    bootstrapAppRouteAccessTokenMock.mockReset();
    bootstrapAppRouteAccessTokenMock.mockResolvedValue({
      kind: "authed",
      accessToken: "token-123",
    });
  });

  it("prefetches library page data on server", async () => {
    apiRequestWithAccessTokenMock.mockResolvedValue({
      items: [
        {
          id: "item-1",
          work_id: "w1",
          work_title: "Book",
          status: "reading",
          visibility: "private",
        },
      ],
      pagination: {
        page: 1,
        page_size: 25,
        total_count: 1,
        total_pages: 1,
        from: 1,
        to: 1,
        has_prev: false,
        has_next: false,
      },
    });

    const ui = await LibraryPage();
    const { container } = render(ui);

    const node = container.querySelector('[data-test="library-client"]');
    expect(node).toBeTruthy();
    expect(apiRequestWithAccessTokenMock).toHaveBeenCalledWith(
      "token-123",
      "/api/v1/library/items",
      expect.anything(),
    );
    const props = JSON.parse(node?.getAttribute("data-props") ?? "{}");
    expect(props.initialAuthed).toBe(true);
    expect(props.initialData.items).toHaveLength(1);
  });

  it("skips library prefetch when unauthenticated", async () => {
    bootstrapAppRouteAccessTokenMock.mockResolvedValue({
      kind: "unauthenticated",
    });

    const ui = await LibraryPage();
    const { container } = render(ui);

    const props = JSON.parse(
      container
        .querySelector('[data-test="library-client"]')
        ?.getAttribute("data-props") ?? "{}",
    );
    expect(props.initialAuthed).toBe(false);
    expect(apiRequestWithAccessTokenMock).not.toHaveBeenCalled();
  });

  it("prefetches search results from URL params", async () => {
    apiRequestWithAccessTokenMock.mockResolvedValue({
      items: [
        {
          source: "openlibrary",
          source_id: "OL123W",
          work_key: "OL123W",
          title: "Dune",
          author_names: ["Frank Herbert"],
          first_publish_year: 1965,
          cover_url: null,
          edition_count: 5,
          languages: ["eng"],
          readable: true,
        },
      ],
      next_page: 2,
    });

    const ui = await BookSearchPage({
      searchParams: Promise.resolve({
        query: "dune",
        author: "herbert",
        sort: "new",
      }),
    });
    const { container } = render(ui);

    const props = JSON.parse(
      container
        .querySelector('[data-test="search-client"]')
        ?.getAttribute("data-props") ?? "{}",
    );
    expect(props.initialFilters.query).toBe("dune");
    expect(props.initialFilters.sort).toBe("new");
    expect(props.initialResults).toHaveLength(1);
    expect(props.initialNextPage).toBe(2);
  });

  it("prefetches settings profile on server", async () => {
    apiRequestWithAccessTokenMock.mockResolvedValue({
      handle: "reader",
      display_name: "Reader",
      avatar_url: null,
      enable_google_books: false,
      theme_primary_color: "#6366F1",
      theme_accent_color: "#14B8A6",
      theme_font_family: "ibm_plex_sans",
      theme_heading_font_family: "ibm_plex_sans",
      default_progress_unit: "pages_read",
    });

    const ui = await SettingsPage();
    const { container } = render(ui);

    const props = JSON.parse(
      container
        .querySelector('[data-test="settings-client"]')
        ?.getAttribute("data-props") ?? "{}",
    );
    expect(props.initialProfile.handle).toBe("reader");
    expect(props.initialError).toBeUndefined();
  });

  it("keeps server route files free of browser client imports", () => {
    const routeFiles = [
      "src/app/(app)/layout.tsx",
      "src/app/(app)/library/page.tsx",
      "src/app/(app)/books/search/page.tsx",
      "src/app/(app)/settings/page.tsx",
      "src/app/(app)/books/[workId]/page.tsx",
    ];

    for (const routeFile of routeFiles) {
      const absolutePath = path.join(process.cwd(), routeFile);
      const content = fs.readFileSync(absolutePath, "utf8");
      expect(content).not.toContain("createBrowserClient");
      expect(content).not.toContain("@/lib/supabase/browser");
    }
  });
});
