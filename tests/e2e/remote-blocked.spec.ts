import { expect, test } from "@playwright/test";

import { expectNoClientErrors, seedRelayTestSession } from "./helpers";

test("remote web blocks incompatible workspace protocols but keeps update actions visible", async ({ page }) => {
  const finish = await expectNoClientErrors(page);

  await seedRelayTestSession(page);
  await page.getByRole("button", { name: "Open Workspace" }).click();

  await expect(page.getByText("Protocol Blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check Update" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Update" })).toBeVisible();
  await expect(page.getByText(/incompatible with device protocol/i)).toBeVisible();

  await finish();
});
