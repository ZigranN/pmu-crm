import { expect, test } from "@playwright/test";

test("protected page redirects anonymous visitor to a usable login form", async ({ page }) => {
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fclients$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeEnabled();
});

test("login displays rejected credentials without navigating into CRM", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }),
  }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("invalid-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("HTTP: anonymous protected route redirects without database access", async ({ request }) => {
  const response = await request.get("/clients", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(new URL(response.headers().location, response.url()).href).toBe("http://127.0.0.1:3100/login?callbackUrl=%2Fclients");
});

test("HTTP: login renders and anonymous auth session is empty", async ({ request }) => {
  const login = await request.get("/login");
  expect(login.status()).toBe(200);
  expect(await login.text()).toContain('id="email"');
  const session = await request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toBeNull();
});

test("HTTP: forged session cookie cannot open client data", async ({ request }) => {
  const response = await request.get("/clients", {
    headers: { cookie: "better-auth.session_token=forged" }, maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(new URL(response.headers().location, response.url()).pathname).toBe("/login");
});
