import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { AppBootstrap, CronJobsResponse, ProjectTreeRecord, ThreadListItem, ThreadMessagesResponse } from "@remote-codex/contracts";

import { expectNoClientErrors } from "./helpers";

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:3000";

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${apiBaseUrl}${path}`);
  expect(response.ok(), `${path} should return 2xx`).toBeTruthy();
  return (await response.json()) as T;
}

async function findUsableThread(
  request: APIRequestContext,
  projects: ProjectTreeRecord[],
): Promise<{ project: ProjectTreeRecord; thread: ThreadListItem; messages: ThreadMessagesResponse } | null> {
  for (const project of projects) {
    for (const thread of project.threads) {
      const messages = await getJson<ThreadMessagesResponse>(request, `/api/threads/${thread.id}/messages?limit=30`);
      if (messages.messages.length) {
        return { project, thread, messages };
      }
    }
  }

  const fallbackProject = projects.find((project) => project.threads.length);
  if (!fallbackProject) {
    return null;
  }

  const fallbackThread = fallbackProject.threads[0];
  const messages = await getJson<ThreadMessagesResponse>(request, `/api/threads/${fallbackThread.id}/messages?limit=30`);
  return { project: fallbackProject, thread: fallbackThread, messages };
}

test("real-data workspace renders existing projects and thread history", async ({ page, request }) => {
  const finish = await expectNoClientErrors(page);
  const bootstrap = await getJson<AppBootstrap>(request, "/api/bootstrap");

  expect(bootstrap.setupComplete).toBe(true);
  expect(bootstrap.projects.length).toBeGreaterThan(0);

  const selected = await findUsableThread(request, bootstrap.projects);
  expect(selected, "at least one thread should exist in the real-data snapshot").not.toBeNull();

  const { project, thread, messages } = selected!;

  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/projects\/\d+$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.locator(`a[href="/chat/projects/${project.id}"]`).click();
  await expect(page.locator(`a[href="/chat/projects/${project.id}/threads/${thread.id}"]`)).toBeVisible();

  await page.locator(`a[href="/chat/projects/${project.id}/threads/${thread.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/chat/projects/${project.id}/threads/${thread.id}$`));
  await expect(page.getByRole("heading", { name: thread.title, exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("후속 변경 사항을 부탁하세요")).toBeVisible();

  if (messages.messages.length) {
    await expect(page.locator("article")).not.toHaveCount(0);
  }

  await finish();
});

test("real-data configuration view loads existing credentials", async ({ page, request }) => {
  const finish = await expectNoClientErrors(page);
  await getJson<AppBootstrap>(request, "/api/bootstrap");

  await page.goto("/config");
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
  await expect(page.getByLabel("Device Name")).toBeVisible();
  await expect(page.getByLabel("Host")).toBeVisible();
  await expect(page.getByLabel("Telegram")).toBeVisible();

  await finish();
});

test("real-data cron page renders current job inventory", async ({ page, request }) => {
  const finish = await expectNoClientErrors(page);
  const jobsResponse = await getJson<CronJobsResponse>(request, "/api/cron-jobs");

  await page.goto("/cron-jobs");
  await expect(page.getByRole("heading", { name: "Cron Jobs", exact: true })).toBeVisible();

  if (!jobsResponse.jobs.length) {
    await expect(page.getByRole("heading", { name: "No cron jobs" })).toBeVisible();
    await finish();
    return;
  }

  const job = jobsResponse.jobs[0];
  await page.getByPlaceholder("Search cron jobs...").fill(job.name);
  await expect(page.getByText(job.name)).toBeVisible();
  await expect(page.getByText(job.enabled ? "Active" : "Disabled")).toBeVisible();

  await finish();
});
