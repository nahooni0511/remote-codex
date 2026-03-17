import { expect, type Page } from "@playwright/test";

const RELAY_AUTH_STORAGE_KEY = "remote-codex:relay-auth";

export async function expectNoClientErrors(page: Page) {
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`.trim());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return async () => {
    expect.soft(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
    expect.soft(requestFailures, `request failures: ${requestFailures.join("\n")}`).toEqual([]);
    expect.soft(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  };
}

export async function seedRelayTestSession(page: Page, token = "remote-e2e-test-token") {
  await page.addInitScript((input) => {
    window.localStorage.setItem(
      input.storageKey,
      JSON.stringify({
        idToken: input.token,
        accessToken: input.token,
        refreshToken: null,
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    );
  }, { storageKey: RELAY_AUTH_STORAGE_KEY, token });

  await page.goto("/devices");
}
