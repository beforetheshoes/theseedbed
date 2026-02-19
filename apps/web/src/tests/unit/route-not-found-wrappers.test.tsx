import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiRequestWithAccessTokenMock,
  bootstrapAppRouteAccessTokenMock,
  notFoundMock,
} = vi.hoisted(() => ({
  apiRequestWithAccessTokenMock: vi.fn(),
  bootstrapAppRouteAccessTokenMock: vi.fn(async () => ({
    kind: "authed" as const,
    accessToken: "access-token",
  })),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/lib/app-route-server-bootstrap", () => ({
  bootstrapAppRouteAccessToken: bootstrapAppRouteAccessTokenMock,
}));

vi.mock("@/app/(app)/books/[workId]/book-detail-page-client", () => ({
  default: ({ initialWorkId }: { initialWorkId: string }) => (
    <div data-test="book-detail-client">{initialWorkId}</div>
  ),
}));

vi.mock("@/lib/api", () => {
  class MockApiClientError extends Error {
    code: string;
    status?: number;

    constructor(message: string, code: string, status?: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  return {
    ApiClientError: MockApiClientError,
    apiRequestWithAccessToken: apiRequestWithAccessTokenMock,
  };
});

import BookDetailPage from "@/app/(app)/books/[workId]/page";
import PublicBookPage from "@/app/(public)/book/[workId]/page";
import PublicProfilePage from "@/app/(public)/u/[handle]/page";
import PublicReviewPage from "@/app/(public)/review/[reviewId]/page";
import { ApiClientError } from "@/lib/api";

describe("route notFound wrappers", () => {
  beforeEach(() => {
    apiRequestWithAccessTokenMock.mockReset();
    bootstrapAppRouteAccessTokenMock.mockClear();
    notFoundMock.mockClear();
  });

  it("renders app book detail for valid work IDs", async () => {
    apiRequestWithAccessTokenMock.mockResolvedValueOnce({ id: "work-1" });

    const ui = await BookDetailPage({
      params: Promise.resolve({ workId: "work-1" }),
    });
    const { container } = render(ui);

    expect(bootstrapAppRouteAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(apiRequestWithAccessTokenMock).toHaveBeenCalledWith(
      "access-token",
      "/api/v1/works/work-1",
    );
    expect(
      container.querySelector('[data-test="book-detail-client"]'),
    ).toHaveTextContent("work-1");
  });

  it("calls notFound when work ID is blank", async () => {
    await expect(
      BookDetailPage({ params: Promise.resolve({ workId: "  " }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalled();
    expect(apiRequestWithAccessTokenMock).not.toHaveBeenCalled();
  });

  it("calls notFound on upstream 404", async () => {
    apiRequestWithAccessTokenMock.mockRejectedValueOnce(
      new ApiClientError("Missing", "not_found", 404),
    );

    await expect(
      BookDetailPage({ params: Promise.resolve({ workId: "missing-id" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("rethrows non-404 app route errors", async () => {
    apiRequestWithAccessTokenMock.mockRejectedValueOnce(
      new ApiClientError("Server down", "request_failed", 500),
    );

    await expect(
      BookDetailPage({ params: Promise.resolve({ workId: "work-1" }) }),
    ).rejects.toThrow("Server down");
  });

  it("applies public route param validation and notFound behavior", async () => {
    await expect(
      PublicBookPage({ params: Promise.resolve({ workId: "" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      PublicReviewPage({ params: Promise.resolve({ reviewId: "bad id" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      PublicProfilePage({ params: Promise.resolve({ handle: "bad/handle" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    const validBookUi = await PublicBookPage({
      params: Promise.resolve({ workId: "work_123" }),
    });
    const validReviewUi = await PublicReviewPage({
      params: Promise.resolve({ reviewId: "review-123" }),
    });
    const validProfileUi = await PublicProfilePage({
      params: Promise.resolve({ handle: "reader.name" }),
    });

    const { container } = render(
      <>
        {validBookUi}
        {validReviewUi}
        {validProfileUi}
      </>,
    );

    expect(
      container.querySelector('[data-test="public-book-work-id"]'),
    ).toHaveTextContent("work_123");
    expect(
      container.querySelector('[data-test="public-review-id"]'),
    ).toHaveTextContent("review-123");
    expect(
      container.querySelector('[data-test="public-profile-handle"]'),
    ).toHaveTextContent("reader.name");
  });
});
