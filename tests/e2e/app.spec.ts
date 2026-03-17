import type { CronJobsResponse } from "@remote-codex/contracts";
import { expect, test } from "@playwright/test";

import { expectNoClientErrors } from "./helpers";

test("chat workspace loads and navigates between seeded threads", async ({ page }) => {
  const finish = await expectNoClientErrors(page);

  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/projects\/\d+$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.locator('a[href="/chat/projects/1"]').click();
  await expect(page.locator('a[href="/chat/projects/1/threads/1"]')).toBeVisible();
  await page.locator('a[href="/chat/projects/1/threads/1"]').click();
  await expect(page).toHaveURL(/\/chat\/projects\/1\/threads\/1$/);
  await expect(page.getByText("현재 프로젝트 구조를 점검해줘.")).toBeVisible();
  await expect(page.getByText("구조를 점검했고, local-web와 local-agent를 분리하는 편이 유지보수에 유리합니다.")).toBeVisible();
  await expect(page.getByPlaceholder("후속 변경 사항을 부탁하세요")).toBeVisible();

  await expect(page.locator('a[href="/chat/projects/1/threads/2"]')).toBeVisible();
  await page.locator('a[href="/chat/projects/1/threads/2"]').click();
  await expect(page).toHaveURL(/\/chat\/projects\/1\/threads\/2$/);
  await expect(page.getByText("수정이 필요한 파일은 3개입니다.")).toBeVisible();

  await finish();
});

test("config page loads and settings can be saved and restored", async ({ page }) => {
  const finish = await expectNoClientErrors(page);

  await page.goto("/config");
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
  await expect(page.getByLabel("Response Language")).toHaveValue("Korean");
  await expect(page.getByLabel("Default Model Reasoning Effort")).toHaveValue("medium");

  await page.getByLabel("Default Model Reasoning Effort").selectOption("high");
  await page.getByRole("button", { name: "Apply Configuration" }).click();
  await expect(page.getByText("설정을 저장했습니다.")).toBeVisible();

  await page.getByLabel("Default Model Reasoning Effort").selectOption("medium");
  await page.getByRole("button", { name: "Apply Configuration" }).click();
  await expect(page.getByText("설정을 저장했습니다.")).toBeVisible();

  await finish();
});

test("cron page renders seeded jobs and toggle can round-trip", async ({ page, request }) => {
  const finish = await expectNoClientErrors(page);

  await page.goto("/cron-jobs");
  await expect(page.getByRole("heading", { name: "Cron Jobs", exact: true })).toBeVisible();
  await expect(page.getByText("Morning status")).toBeVisible();
  await expect(page.getByText("Bug sweep")).toBeVisible();

  await page.getByPlaceholder("Search cron jobs...").fill("Bug sweep");
  await expect(page.getByText("Morning status")).toHaveCount(0);
  await expect(page.getByText("Bug sweep")).toBeVisible();

  const jobsResponse = (await (await request.get("/api/cron-jobs")).json()) as CronJobsResponse;
  const bugSweep = jobsResponse.jobs.find((job) => job.name === "Bug sweep");
  expect(bugSweep).toBeTruthy();
  const jobCard = page.locator("article").filter({ has: page.getByText("Bug sweep", { exact: true }) }).first();

  await request.patch(`/api/cron-jobs/${bugSweep!.id}`, { data: { enabled: true } });
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(jobCard.getByText("Active", { exact: true })).toBeVisible();

  await request.patch(`/api/cron-jobs/${bugSweep!.id}`, { data: { enabled: false } });
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(jobCard.getByText("Disabled", { exact: true })).toBeVisible();

  await finish();
});
