import { expect, test } from "@playwright/test";

import { expectNoClientErrors, seedRelayTestSession } from "./helpers";

test("remote web mounts the shared workspace over the relay bridge", async ({ page }) => {
  const finish = await expectNoClientErrors(page);

  await seedRelayTestSession(page);
  await expect(page.getByRole("heading", { name: "Connected Devices" })).toBeVisible();
  await expect(page.getByText("Online")).toBeVisible();

  await page.getByRole("button", { name: "Open Workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/projects\/\d+$/);

  await page.locator('a[href="/chat/projects/1/threads/1"]').click();
  await expect(page).toHaveURL(/\/chat\/projects\/1\/threads\/1$/);
  await expect(page.getByText("remote relay 연결이 제대로 되는지 확인해줘.")).toBeVisible();
  await expect(page.getByText("relay를 통해 로컬 워크스페이스가 정상적으로 노출되고 있습니다.")).toBeVisible();

  await page.locator('a[href="/chat/projects/1/threads/2"]').click();
  await expect(page.getByText("평문은 relay에 남기지 않고 암호화된 envelope만 전달합니다.")).toBeVisible();

  await finish();
});
