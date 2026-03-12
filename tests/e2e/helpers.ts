import { expect, type Page } from "@playwright/test";

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
