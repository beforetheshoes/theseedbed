import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock, imageRenderMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  imageRenderMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next/image", () => ({
  default: (props: ComponentPropsWithoutRef<"img">) => {
    imageRenderMock(props);
    const { src, alt, className, width, height, sizes } = props;
    return (
      <div
        data-test="next-image-mock"
        data-alt={alt}
        data-class={className}
        data-height={String(height)}
        data-sizes={sizes}
        data-src={String(src)}
        data-width={String(width)}
      />
    );
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

import { AppTopBarBookSearch } from "@/components/app-topbar-book-search";

async function runSearch(query: string) {
  const { container } = render(<AppTopBarBookSearch />);
  const input = container.querySelector(
    '[data-test="topbar-search-input"]',
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  if (!input) throw new Error("Expected topbar search input");
  fireEvent.change(input, { target: { value: query } });
  await waitFor(() => {
    expect(apiRequestMock).toHaveBeenCalled();
  });
  return container;
}

describe("AppTopBarBookSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders next/image cover thumbnail when cover_url is present", async () => {
    apiRequestMock.mockImplementation(
      async (_supabase: unknown, path: string) => {
        if (path === "/api/v1/library/search") {
          return { items: [] };
        }
        if (path === "/api/v1/books/search") {
          return {
            items: [
              {
                source: "openlibrary",
                source_id: "OL1W",
                work_key: "OL1W",
                title: "Parable of the Sower",
                author_names: ["Octavia E. Butler"],
                cover_url: "https://covers.openlibrary.org/b/id/1234-M.jpg",
              },
            ],
          };
        }
        throw new Error(`Unexpected path in test: ${path}`);
      },
    );

    const container = await runSearch("parable");

    await waitFor(() => {
      expect(
        container.querySelector('[data-test="next-image-mock"]'),
      ).toBeInTheDocument();
    });
    const image = container.querySelector('[data-test="next-image-mock"]');
    expect(image).toHaveAttribute(
      "data-src",
      "https://covers.openlibrary.org/b/id/1234-M.jpg",
    );
    expect(image).toHaveAttribute("data-alt", "");
    expect(image).toHaveAttribute("data-class", "h-full w-full object-cover");
    expect(imageRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 44,
        height: 64,
        sizes: "44px",
        unoptimized: false,
      }),
    );
  });

  it("falls back to unoptimized for unknown cover hosts", async () => {
    apiRequestMock.mockImplementation(
      async (_supabase: unknown, path: string) => {
        if (path === "/api/v1/library/search") {
          return { items: [] };
        }
        if (path === "/api/v1/books/search") {
          return {
            items: [
              {
                source: "openlibrary",
                source_id: "OL3W",
                work_key: "OL3W",
                title: "Fledgling",
                author_names: ["Octavia E. Butler"],
                cover_url:
                  "https://legacy-cdn.example.com/covers/fledgling.jpg",
              },
            ],
          };
        }
        throw new Error(`Unexpected path in test: ${path}`);
      },
    );

    await runSearch("fledgling");

    await waitFor(() => {
      expect(imageRenderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          src: "https://legacy-cdn.example.com/covers/fledgling.jpg",
          unoptimized: true,
        }),
      );
    });
  });

  it("renders no-cover fallback when cover_url is missing", async () => {
    apiRequestMock.mockImplementation(
      async (_supabase: unknown, path: string) => {
        if (path === "/api/v1/library/search") {
          return { items: [] };
        }
        if (path === "/api/v1/books/search") {
          return {
            items: [
              {
                source: "openlibrary",
                source_id: "OL2W",
                work_key: "OL2W",
                title: "Kindred",
                author_names: ["Octavia E. Butler"],
                cover_url: null,
              },
            ],
          };
        }
        throw new Error(`Unexpected path in test: ${path}`);
      },
    );

    const container = await runSearch("kindred");

    expect(await screen.findByText("No cover")).toBeInTheDocument();
    expect(
      container.querySelector('[data-test="next-image-mock"]'),
    ).not.toBeInTheDocument();
  });
});
