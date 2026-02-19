import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: () => <div data-test="next-image-mock" />,
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiRequest: apiRequestMock,
  };
});

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: vi.fn(() => ({ auth: { getSession: vi.fn() } })),
}));

vi.mock("@/components/toast-provider", () => ({
  useAppToast: () => ({ show: vi.fn() }),
}));

import LibraryPageClient from "@/app/(app)/library/library-page-client";

const SAMPLE_ITEMS = [
  {
    id: "item-1",
    work_id: "work-1",
    work_title: "The Left Hand of Darkness",
    work_description: "An envoy enters a strange winter world.",
    author_names: ["Ursula K. Le Guin"],
    status: "reading",
    visibility: "private",
    rating: 8,
    tags: ["sci-fi"],
    created_at: "2026-02-01T00:00:00Z",
  },
];

function buildLocalStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
}

function setupApiMock(status: "reading" | "to_read" = "reading") {
  const items = SAMPLE_ITEMS.map((item) => ({ ...item, status }));
  apiRequestMock.mockImplementation(
    async (_supabase: unknown, path: string) => {
      if (path === "/api/v1/me") {
        return { default_source_language: "eng" };
      }
      if (path === "/api/v1/library/items") {
        return {
          items,
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
        };
      }
      if (path.startsWith("/api/v1/library/items/item-1")) {
        return items[0];
      }
      if (path === "/api/v1/works/work-1/editions") {
        return {
          items: [{ id: "edition-1", title: "Default Edition", format: null }],
        };
      }
      if (path === "/api/v1/works/work-1/cover-metadata/sources") {
        return {
          items: [
            {
              provider: "openlibrary",
              source_id: "/books/OL1M",
              openlibrary_work_key: "/works/OL1W",
              title: "The Left Hand of Darkness",
              authors: ["Ursula K. Le Guin"],
              publisher: "Ace",
              publish_date: "1969-01-01",
              language: "eng",
              identifier: "9780441478129",
              cover_url: "https://covers.openlibrary.org/b/id/1-M.jpg",
              source_label: "Open Library",
            },
          ],
          prefetch_compare: {
            "openlibrary:/books/OL1M": {
              selected_source: {
                provider: "openlibrary",
                source_id: "/books/OL1M",
                source_label: "Open Library OL1M",
                edition_id: null,
              },
              fields: [
                {
                  field_key: "edition.publisher",
                  field_label: "Publisher",
                  current_value: "Current publisher",
                  selected_value: "Ace",
                  selected_available: true,
                  provider: "openlibrary",
                  provider_id: "/books/OL1M",
                },
              ],
            },
          },
        };
      }
      if (path === "/api/v1/works/work-1/cover-metadata/compare") {
        return { fields: [] };
      }
      throw new Error(`Unhandled apiRequest call: ${path}`);
    },
  );
}

async function openFromOverflowTrigger() {
  const trigger = (await screen.findAllByLabelText("Open actions menu"))[0];
  if (!trigger) throw new Error("Missing overflow trigger");
  fireEvent.click(trigger);
}

async function setViewMode(mode: "List" | "Grid" | "Table") {
  const trigger = await waitFor(() =>
    document.querySelector(
      `[data-test=\"library-view-select\"] [aria-label=\"${mode}\"]`,
    ),
  );
  if (!trigger) throw new Error(`Missing ${mode} view toggle`);
  fireEvent.click(trigger);
}

describe("Library context menu", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    vi.stubGlobal("localStorage", buildLocalStorageMock());
    setupApiMock("reading");
    window.history.replaceState({}, "", "/library");
  });
  afterEach(() => {
    cleanup();
  });

  it("opens from list right-click and renders 4 actions in order", async () => {
    localStorage.setItem("seedbed.library.viewMode", "list");
    render(<LibraryPageClient initialAuthed />);

    const listTitle = await screen.findByText("The Left Hand of Darkness");

    fireEvent.contextMenu(listTitle);

    await screen.findByText("Set Cover and Metadata");
    const labels = Array.from(
      document.querySelectorAll(".p-menuitem-text"),
    ).map((node) => node.textContent?.trim());
    expect(labels).toEqual([
      "Set Cover and Metadata",
      "Log Progress",
      "Add Note",
      "Add Review",
    ]);
  });

  it("hides Log Progress when item status is not reading", async () => {
    setupApiMock("to_read");
    localStorage.setItem("seedbed.library.viewMode", "list");
    render(<LibraryPageClient initialAuthed />);

    const listTitle = await screen.findByText("The Left Hand of Darkness");
    fireEvent.contextMenu(listTitle);

    await screen.findByText("Set Cover and Metadata");
    const labels = Array.from(
      document.querySelectorAll(".p-menuitem-text"),
    ).map((node) => node.textContent?.trim());
    expect(labels).toEqual([
      "Set Cover and Metadata",
      "Add Note",
      "Add Review",
    ]);
    expect(screen.queryByText("Log Progress")).not.toBeInTheDocument();
  });

  it("opens from grid overflow trigger and opens merged workflow dialog without navigation", async () => {
    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Grid");

    await openFromOverflowTrigger();
    fireEvent.click(await screen.findByText("Set Cover and Metadata"));

    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-test="library-workflow-set-cover-and-metadata-dialog"]',
        ),
      ).toBeTruthy(),
    );
    expect(window.location.pathname).toBe("/library");
  });

  it("opens from table row right-click and opens Log Progress dialog", async () => {
    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Table");

    const titleLink = await screen.findByText("The Left Hand of Darkness");
    const row = titleLink.closest("tr");
    if (!row) throw new Error("Missing table row");

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText("Log Progress"));

    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-test="library-workflow-log-progress-dialog"]',
        ),
      ).toBeTruthy(),
    );
  });

  it("supports keyboard context menu trigger (Shift+F10) for list cards", async () => {
    localStorage.setItem("seedbed.library.viewMode", "list");
    render(<LibraryPageClient initialAuthed />);

    const titleLink = await screen.findByText("The Left Hand of Darkness");
    const listCard = titleLink.closest(".p-card");
    if (!listCard) throw new Error("Missing list card");

    fireEvent.keyDown(listCard, { key: "F10", shiftKey: true });

    expect(await screen.findByText("Add Review")).toBeInTheDocument();
  });

  it("closes menu after action selection", async () => {
    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Grid");

    await openFromOverflowTrigger();
    fireEvent.click(await screen.findByText("Add Note"));

    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-test="library-workflow-add-note-dialog"]',
        ),
      ).toBeTruthy(),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Set Cover and Metadata"),
      ).not.toBeInTheDocument();
    });
  });

  it("uses prefetched compare cache when selecting a prefetched tile", async () => {
    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Grid");

    await openFromOverflowTrigger();
    fireEvent.click(await screen.findByText("Set Cover and Metadata"));

    const prefetchedTile = await screen.findByRole("button", {
      name: /Open Library/i,
    });
    fireEvent.click(prefetchedTile);

    await screen.findByText("Publisher");
    const compareCalls = apiRequestMock.mock.calls.filter(
      (entry) => entry[1] === "/api/v1/works/work-1/cover-metadata/compare",
    );
    expect(compareCalls).toHaveLength(0);
  });

  it("sends openlibrary work key when requesting compare for an openlibrary tile", async () => {
    const items = SAMPLE_ITEMS.map((item) => ({ ...item, status: "reading" }));
    apiRequestMock.mockImplementation(
      async (
        _supabase: unknown,
        path: string,
        opts?: {
          query?: Record<string, string | number | boolean | null | undefined>;
        },
      ) => {
        if (path === "/api/v1/library/items") {
          return {
            items,
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
          };
        }
        if (path === "/api/v1/me") {
          return { default_source_language: "eng" };
        }
        if (path.startsWith("/api/v1/library/items/item-1")) return items[0];
        if (path === "/api/v1/works/work-1/editions") {
          return {
            items: [
              { id: "edition-1", title: "Default Edition", format: null },
            ],
          };
        }
        if (path === "/api/v1/works/work-1/cover-metadata/sources") {
          expect(String(opts?.query?.languages ?? "")).toContain("eng");
          expect(opts?.query?.language).toBeUndefined();
          return {
            items: [
              {
                provider: "openlibrary",
                source_id: "/books/OL1M",
                openlibrary_work_key: "/works/OL1W",
                title: "The Left Hand of Darkness",
                authors: ["Ursula K. Le Guin"],
                publisher: "Ace",
                publish_date: "1969-01-01",
                language: "eng",
                identifier: "9780441478129",
                cover_url: "https://covers.openlibrary.org/b/id/1-M.jpg",
                source_label: "Open Library",
              },
            ],
            prefetch_compare: {},
          };
        }
        if (path === "/api/v1/works/work-1/cover-metadata/compare") {
          expect(opts?.query?.openlibrary_work_key).toBe("/works/OL1W");
          return {
            fields: [
              {
                field_key: "edition.publisher",
                field_label: "Publisher",
                current_value: "Current publisher",
                selected_value: "Ace",
                selected_available: true,
                provider: "openlibrary",
                provider_id: "/books/OL1M",
              },
            ],
          };
        }
        throw new Error(`Unhandled apiRequest call: ${path}`);
      },
    );

    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Grid");

    await openFromOverflowTrigger();
    fireEvent.click(await screen.findByText("Set Cover and Metadata"));
    const tile = await screen.findByRole("button", { name: /Open Library/i });
    fireEvent.click(tile);

    await screen.findByText("Publisher");
    const compareCalls = apiRequestMock.mock.calls.filter(
      (entry) => entry[1] === "/api/v1/works/work-1/cover-metadata/compare",
    );
    expect(compareCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of compareCalls) {
      const options = call[2] as {
        query?: Record<string, string | number | boolean | null | undefined>;
      };
      expect(options?.query?.openlibrary_work_key).toBe("/works/OL1W");
    }
  });

  it("sends title override when refreshing source lookup", async () => {
    const sourceTitles: string[] = [];
    apiRequestMock.mockImplementation(
      async (
        _supabase: unknown,
        path: string,
        opts?: {
          query?: Record<string, string | number | boolean | null | undefined>;
        },
      ) => {
        if (path === "/api/v1/me") return { default_source_language: "eng" };
        if (path === "/api/v1/library/items") {
          return {
            items: SAMPLE_ITEMS,
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
          };
        }
        if (path.startsWith("/api/v1/library/items/item-1"))
          return SAMPLE_ITEMS[0];
        if (path === "/api/v1/works/work-1/editions") {
          return {
            items: [
              { id: "edition-1", title: "Default Edition", format: null },
            ],
          };
        }
        if (path === "/api/v1/works/work-1/cover-metadata/sources") {
          sourceTitles.push(String(opts?.query?.title ?? ""));
          return { items: [], prefetch_compare: {} };
        }
        throw new Error(`Unhandled apiRequest call: ${path}`);
      },
    );

    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Grid");
    await openFromOverflowTrigger();
    fireEvent.click(await screen.findByText("Set Cover and Metadata"));

    const titleInput = await screen.findByLabelText("Search title");
    fireEvent.change(titleInput, { target: { value: "Da Vinci Code" } });
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));

    await waitFor(() => expect(sourceTitles.length).toBeGreaterThanOrEqual(2));
    expect(sourceTitles[0]).toBe("The Left Hand of Darkness");
    expect(sourceTitles.at(-1)).toBe("Da Vinci Code");
  });

  it("renders current cover when compare returns a relative cover path", async () => {
    apiRequestMock.mockImplementation(
      async (
        _supabase: unknown,
        path: string,
        opts?: {
          query?: Record<string, string | number | boolean | null | undefined>;
        },
      ) => {
        if (path === "/api/v1/me") {
          return { default_source_language: "eng" };
        }
        if (path === "/api/v1/library/items") {
          return {
            items: SAMPLE_ITEMS,
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
          };
        }
        if (path.startsWith("/api/v1/library/items/item-1")) {
          return SAMPLE_ITEMS[0];
        }
        if (path === "/api/v1/works/work-1/editions") {
          return {
            items: [
              { id: "edition-1", title: "Default Edition", format: null },
            ],
          };
        }
        if (path === "/api/v1/works/work-1/cover-metadata/sources") {
          expect(String(opts?.query?.languages ?? "")).toContain("eng");
          return {
            items: [
              {
                provider: "openlibrary",
                source_id: "/books/OL1M",
                openlibrary_work_key: "/works/OL1W",
                title: "The Left Hand of Darkness",
                authors: ["Ursula K. Le Guin"],
                publisher: "Ace",
                publish_date: "1969-01-01",
                language: "eng",
                identifier: "9780441478129",
                cover_url: "https://covers.openlibrary.org/b/id/1-M.jpg",
                source_label: "Open Library",
              },
            ],
            prefetch_compare: {},
          };
        }
        if (path === "/api/v1/works/work-1/cover-metadata/compare") {
          return {
            fields: [
              {
                field_key: "work.cover_url",
                field_label: "Cover",
                current_value: "/storage/v1/object/public/covers/current.jpg",
                selected_value: "https://covers.openlibrary.org/b/id/1-L.jpg",
                selected_available: true,
                provider: "openlibrary",
                provider_id: "/books/OL1M",
              },
            ],
          };
        }
        throw new Error(`Unhandled apiRequest call: ${path}`);
      },
    );

    render(<LibraryPageClient initialAuthed />);
    await setViewMode("Grid");
    await openFromOverflowTrigger();
    fireEvent.click(await screen.findByText("Set Cover and Metadata"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Open Library/i }),
    );

    await screen.findByText("Cover");
    expect(screen.queryByText("No current cover")).not.toBeInTheDocument();
  });
});
