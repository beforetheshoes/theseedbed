import { expect, test, type Page } from "@playwright/test";

async function forceDarkModeCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "colorMode",
      value: "dark",
      domain: "localhost",
      path: "/",
    },
  ]);
}

test("redirects root to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('[data-test="login-card"]')).toBeVisible();
});

test("renders public placeholder routes", async ({ page }) => {
  await page.goto("/book/test-work");
  await expect(page.locator('[data-test="public-book-work-id"]')).toHaveText(
    "test-work",
  );

  await page.goto("/review/test-review");
  await expect(page.locator('[data-test="public-review-id"]')).toHaveText(
    "test-review",
  );

  await page.goto("/u/test-user");
  await expect(page.locator('[data-test="public-profile-handle"]')).toHaveText(
    "test-user",
  );
});

test("uses dark-mode surfaces on public placeholder routes", async ({
  page,
}) => {
  await forceDarkModeCookie(page);

  await page.goto("/book/test-work");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator('[data-test="public-book-card"]')).toHaveClass(
    /bg-\[var\(--surface-card\)\]/,
  );
  await expect(page.locator('[data-test="public-book-card"]')).not.toHaveClass(
    /bg-white|border-slate|text-slate/,
  );

  await page.goto("/review/test-review");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator('[data-test="public-review-card"]')).toHaveClass(
    /bg-\[var\(--surface-card\)\]/,
  );
  await expect(
    page.locator('[data-test="public-review-card"]'),
  ).not.toHaveClass(/bg-white|border-slate|text-slate/);

  await page.goto("/u/test-user");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator('[data-test="public-profile-card"]')).toHaveClass(
    /bg-\[var\(--surface-card\)\]/,
  );
  await expect(
    page.locator('[data-test="public-profile-card"]'),
  ).not.toHaveClass(/bg-white|border-slate|text-slate/);
});

test("uses tokenized dark-mode surfaces on book details route shell", async ({
  page,
}) => {
  await forceDarkModeCookie(page);
  await page.goto("/books/test-work");

  await expect(page.locator("html")).toHaveClass(/dark/);
  const card = page.locator('[data-test="book-detail-card"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/bg-\[var\(--surface-card\)\]/);
  await expect(card).toHaveClass(/border-\[var\(--p-content-border-color\)\]/);
  await expect(card).not.toHaveClass(/bg-white|border-slate/);
});
