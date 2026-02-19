import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
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

import SettingsPageClient from "@/app/(app)/settings/settings-page-client";

type ImportIssueSeed = {
  row_number: number;
  field: "title" | "authors" | "read_status";
  issue_code: "missing_authors" | "missing_title" | "missing_read_status";
  required: boolean;
  title: string | null;
  uid: string | null;
  suggested_value: string | null;
  suggestion_source: string | null;
  suggestion_confidence: "high" | "medium" | null;
};

const profileResponse = {
  handle: "reader",
  display_name: "Reader",
  avatar_url: null,
  enable_google_books: false,
  theme_primary_color: "#6366F1",
  theme_accent_color: "#14B8A6",
  theme_font_family: "ibm_plex_sans",
  theme_heading_font_family: "ibm_plex_sans",
  default_progress_unit: "pages_read",
};

function setupApiMock({
  storygraphItems = [],
  goodreadsItems = [],
}: {
  storygraphItems?: ImportIssueSeed[];
  goodreadsItems?: ImportIssueSeed[];
} = {}) {
  apiRequestMock.mockImplementation(
    async (_supabase: unknown, path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (path === "/api/v1/me" && method === "GET") return profileResponse;
      if (path === "/api/v1/me" && method === "PATCH") return {};
      if (
        path === "/api/v1/imports/storygraph/missing-authors" &&
        method === "POST"
      ) {
        return { items: storygraphItems };
      }
      if (
        path === "/api/v1/imports/goodreads/missing-required" &&
        method === "POST"
      ) {
        return { items: goodreadsItems };
      }
      if (path === "/api/v1/imports/storygraph" && method === "POST") {
        return {
          job_id: "sg-job",
          status: "queued",
          total_rows: 1,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
        };
      }
      if (path === "/api/v1/imports/goodreads" && method === "POST") {
        return {
          job_id: "gr-job",
          status: "queued",
          total_rows: 1,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
        };
      }
      if (path === "/api/v1/imports/storygraph/sg-job") {
        return {
          job_id: "sg-job",
          status: "completed",
          total_rows: 1,
          processed_rows: 1,
          imported_rows: 1,
          failed_rows: 0,
          skipped_rows: 0,
          error_summary: null,
          rows_preview: [],
        };
      }
      if (path === "/api/v1/imports/goodreads/gr-job") {
        return {
          job_id: "gr-job",
          status: "completed",
          total_rows: 1,
          processed_rows: 1,
          imported_rows: 1,
          failed_rows: 0,
          skipped_rows: 0,
          error_summary: null,
          rows_preview: [],
        };
      }
      throw new Error(`Unhandled apiRequest call: ${method} ${path}`);
    },
  );
}

function getUploaderInput(container: HTMLElement, testId: string) {
  const input = container.querySelector<HTMLInputElement>(
    `[data-test="${testId}"] input[type=\"file\"]`,
  );
  if (!input) throw new Error(`Missing uploader input for ${testId}`);
  return input;
}

async function uploadCsv(
  container: HTMLElement,
  uploaderTestId: string,
  selectedFileTestId: string,
  fileName: string,
) {
  const input = getUploaderInput(container, uploaderTestId);
  const file = new File(["a,b"], fileName, { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    const selectedFile = container.querySelector(
      `[data-test="${selectedFileTestId}"]`,
    );
    expect(selectedFile).toBeTruthy();
    expect(selectedFile).toHaveTextContent(fileName);
  });
}

describe("Settings page import + header UX", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("renders Save settings in the page header area", async () => {
    setupApiMock();

    const { container } = render(<SettingsPageClient />);
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        expect.anything(),
        "/api/v1/me",
      ),
    );

    const heading = screen.getByRole("heading", {
      name: /profile and settings/i,
    });
    const saveButton = screen.getByRole("button", { name: /save settings/i });

    expect(heading.parentElement).toBeTruthy();
    expect(heading.parentElement).toContainElement(saveButton);
    expect(
      container.querySelectorAll('[data-test="settings-save"]'),
    ).toHaveLength(1);
  });

  it("hides StoryGraph issue actions after resolving and shows Start import below issues", async () => {
    setupApiMock({
      storygraphItems: [
        {
          row_number: 1,
          field: "authors",
          issue_code: "missing_authors",
          required: true,
          title: "Dune",
          uid: null,
          suggested_value: "Frank Herbert",
          suggestion_source: "openlibrary:search",
          suggestion_confidence: "high",
        },
      ],
    });

    const { container } = render(<SettingsPageClient />);
    await uploadCsv(
      container,
      "storygraph-file-input",
      "storygraph-selected-file",
      "storygraph.csv",
    );

    expect(
      container.querySelector('[data-test="storygraph-import-start"]'),
    ).toBeNull();

    const useSuggestion = await screen.findByRole("button", {
      name: /use suggestion/i,
    });
    fireEvent.click(useSuggestion);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /use suggestion/i }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /mark skip/i })).toBeNull();
      expect(screen.getByText("Resolved")).toBeInTheDocument();
    });

    const issuesPanel = container.querySelector(
      '[data-test="storygraph-issues-panel"]',
    );
    const startButtons = container.querySelectorAll(
      '[data-test="storygraph-import-start"]',
    );

    expect(issuesPanel).toBeTruthy();
    expect(startButtons).toHaveLength(1);
    if (!issuesPanel || !startButtons[0]) {
      throw new Error("Expected StoryGraph issues panel and start button");
    }
    expect(
      issuesPanel.compareDocumentPosition(startButtons[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Goodreads issue actions after skip and shows Start import below issues", async () => {
    setupApiMock({
      goodreadsItems: [
        {
          row_number: 1,
          field: "title",
          issue_code: "missing_title",
          required: true,
          title: null,
          uid: "9780441172719",
          suggested_value: null,
          suggestion_source: null,
          suggestion_confidence: null,
        },
      ],
    });

    const { container } = render(<SettingsPageClient />);
    await uploadCsv(
      container,
      "goodreads-file-input",
      "goodreads-selected-file",
      "goodreads.csv",
    );

    expect(
      container.querySelector('[data-test="goodreads-import-start"]'),
    ).toBeNull();

    const markSkip = await screen.findByRole("button", { name: /mark skip/i });
    fireEvent.click(markSkip);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /mark skip/i })).toBeNull();
      expect(screen.getByText("Skipped")).toBeInTheDocument();
    });

    const issuesPanel = container.querySelector(
      '[data-test="goodreads-issues-panel"]',
    );
    const startButtons = container.querySelectorAll(
      '[data-test="goodreads-import-start"]',
    );

    expect(issuesPanel).toBeTruthy();
    expect(startButtons).toHaveLength(1);
    if (!issuesPanel || !startButtons[0]) {
      throw new Error("Expected Goodreads issues panel and start button");
    }
    expect(
      issuesPanel.compareDocumentPosition(startButtons[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
