import { expect, test } from "@playwright/test";

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
