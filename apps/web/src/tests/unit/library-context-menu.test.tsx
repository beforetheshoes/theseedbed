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

import LibraryPage from "@/app/(app)/library/page";

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

function setupApiMock() {
  apiRequestMock.mockImplementation(
    async (_supabase: unknown, path: string) => {
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
          items: [{ id: "edition-1", title: "Default Edition", format: null }],
        };
      }
      if (path === "/api/v1/works/work-1/cover-metadata/sources") {
        return {
          items: [
            {
              provider: "openlibrary",
              source_id: "/books/OL1M",
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
    setupApiMock();
    window.history.replaceState({}, "", "/library");
  });
  afterEach(() => {
    cleanup();
  });

  it("opens from list right-click and renders 4 actions in order", async () => {
    localStorage.setItem("seedbed.library.viewMode", "list");
    render(<LibraryPage />);

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

  it("opens from grid overflow trigger and opens merged workflow dialog without navigation", async () => {
    render(<LibraryPage />);
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
    render(<LibraryPage />);
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
    render(<LibraryPage />);

    const titleLink = await screen.findByText("The Left Hand of Darkness");
    const listCard = titleLink.closest(".p-card");
    if (!listCard) throw new Error("Missing list card");

    fireEvent.keyDown(listCard, { key: "F10", shiftKey: true });

    expect(await screen.findByText("Add Review")).toBeInTheDocument();
  });

  it("closes menu after action selection", async () => {
    render(<LibraryPage />);
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
    render(<LibraryPage />);
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
});
