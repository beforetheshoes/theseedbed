import { render, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock, chartRenderMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  chartRenderMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
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

vi.mock("primereact/chart", () => ({
  Chart: (props: Record<string, unknown>) => {
    chartRenderMock(props);
    return <div data-test="mock-progress-chart" />;
  },
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

vi.mock("@/components/books/book-discovery-section", () => ({
  BookDiscoverySection: () => <div data-test="book-discovery-section" />,
}));

vi.mock("@/components/cover-placeholder", () => ({
  CoverPlaceholder: () => <div data-test="cover-placeholder" />,
}));

vi.mock("@/components/toast-provider", () => ({
  useAppToast: () => ({ show: vi.fn() }),
}));

import BookDetailPage from "@/app/(app)/books/[workId]/page";

function setupApiMock() {
  apiRequestMock.mockImplementation(
    async (_supabase: unknown, path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected method in test: ${method} ${path}`);
      }
      if (path === "/api/v1/me") {
        return { default_progress_unit: "pages_read" };
      }
      if (path === "/api/v1/works/test-work") {
        return {
          id: "work-1",
          title: "Test Work",
          description: "A test description",
          cover_url: null,
          total_pages: 100,
          total_audio_minutes: 0,
          authors: [{ id: "a1", name: "Test Author" }],
        };
      }
      if (path === "/api/v1/library/items/by-work/test-work") {
        return {
          id: "item-1",
          work_id: "work-1",
          preferred_edition_id: "ed-1",
          status: "reading",
          visibility: "private",
        };
      }
      if (path === "/api/v1/works/test-work/editions") {
        return {
          items: [
            { id: "ed-1", title: "Default Edition", format: "Paperback" },
          ],
        };
      }
      if (path === "/api/v1/library/items/item-1/read-cycles") {
        return {
          items: [{ id: "cycle-1", started_at: "2025-01-01T00:00:00Z" }],
        };
      }
      if (path === "/api/v1/read-cycles/cycle-1/progress-logs") {
        return {
          items: [
            {
              id: "log-1",
              logged_at: "2025-01-02T00:00:00Z",
              unit: "pages_read",
              value: 12,
              note: null,
              canonical_percent: 12,
            },
          ],
        };
      }
      if (path === "/api/v1/library/items/item-1/notes") {
        return { items: [] };
      }
      if (path === "/api/v1/library/items/item-1/highlights") {
        return { items: [] };
      }
      if (path === "/api/v1/me/reviews") {
        return { items: [] };
      }
      if (path === "/api/v1/library/items/item-1/statistics") {
        return {
          totals: { total_pages: 100, total_audio_minutes: 0 },
          current: {
            pages_read: 12,
            canonical_percent: 12,
            minutes_listened: 0,
          },
          timeline: [],
          data_quality: { has_missing_totals: false },
        };
      }
      throw new Error(`Unhandled apiRequest call: ${method} ${path}`);
    },
  );
}

describe("Book detail dark-mode surfaces", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    chartRenderMock.mockReset();
    setupApiMock();
  });

  it("uses tokenized surface classes and themed chart colors", async () => {
    const { container } = render(
      <BookDetailPage params={Promise.resolve({ workId: "test-work" })} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-test="book-detail-card"]'),
      ).toBeTruthy();
      expect(chartRenderMock).toHaveBeenCalled();
    });

    const card = container.querySelector('[data-test="book-detail-card"]');
    const cover = container.querySelector('[data-test="book-detail-cover"]');

    expect(card).toHaveClass("border-[var(--p-content-border-color)]");
    expect(card).toHaveClass("bg-[var(--surface-card)]");
    expect(cover).toHaveClass("bg-[var(--surface-hover)]");

    expect(container.innerHTML).not.toContain("bg-white");
    expect(container.innerHTML).not.toContain("border-slate");
    expect(container.innerHTML).not.toContain("bg-slate");
    expect(container.innerHTML).not.toContain("bg-red-50");

    const lastChartProps = chartRenderMock.mock.calls.at(-1)?.[0] as {
      data: {
        datasets: Array<{ borderColor?: string; backgroundColor?: string }>;
      };
      options: {
        scales: {
          x: { ticks: { color: string }; grid: { color: string } };
          y: { ticks: { color: string }; grid: { color: string } };
        };
      };
    };

    expect(lastChartProps.data.datasets[0]?.borderColor).toBe("#3b82f6");
    expect(lastChartProps.data.datasets[0]?.backgroundColor).toBe(
      "rgba(59, 130, 246, 0.3)",
    );
    expect(lastChartProps.options.scales.x.ticks.color).toBe("#64748b");
    expect(lastChartProps.options.scales.y.ticks.color).toBe("#64748b");
    expect(lastChartProps.options.scales.x.grid.color).toBe(
      "rgba(148, 163, 184, 0.5)",
    );
    expect(lastChartProps.options.scales.y.grid.color).toBe(
      "rgba(148, 163, 184, 0.5)",
    );
  });
});
