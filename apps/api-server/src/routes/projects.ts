import { Router } from "express";

import {
  createProject,
  deleteProject,
  getProjectById,
  listCronJobs,
  saveProjectTelegramConnection,
  updateProject,
} from "../db";
import { assertNonEmptyString, parseNumericId, validateFolderPath, HttpError } from "../lib/http";
import {
  createForumSupergroup,
  createForumTopic,
  getAuthenticatedClient,
  inviteUserToSupergroup,
} from "../mtproto";
import {
  broadcastWorkspaceUpdated,
  getAuthConfigOrThrow,
  getBotConfigOrThrow,
  stopScheduledCronJob,
  syncScopedBotCommandsForProject,
} from "../services/runtime";
import { createThread } from "../db";

export const projectsRouter = Router();

projectsRouter.post("/api/projects", async (request, response, next) => {
  try {
    const groupName = assertNonEmptyString(request.body.groupName, "Group name");
    const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));
    const authConfig = getAuthConfigOrThrow();
    const botConfig = getBotConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);

    const createdGroup = await createForumSupergroup(client, {
      title: groupName,
      about: `Codex project: ${groupName}`,
    });

    await inviteUserToSupergroup(
      client,
      {
        telegramChatId: createdGroup.telegramChannelId,
        telegramAccessHash: createdGroup.telegramAccessHash,
      },
      botConfig.botUserName,
    );

    const project = createProject({
      name: groupName,
      folderPath,
    });

    saveProjectTelegramConnection(project.id, {
      telegramChatId: createdGroup.telegramChannelId,
      telegramAccessHash: createdGroup.telegramAccessHash,
      telegramChatTitle: createdGroup.telegramTitle,
      forumEnabled: createdGroup.forumEnabled,
    });
    await syncScopedBotCommandsForProject(getProjectById(project.id)!);

    broadcastWorkspaceUpdated({
      projectId: project.id,
    });

    response.status(201).json(getProjectById(project.id));
  } catch (error) {
    next(error);
  }
});

projectsRouter.get("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    response.json(project);
  } catch (error) {
    next(error);
  }
});

projectsRouter.put("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));
    const updatedProject = updateProject(projectId, {
      name: project.name,
      folderPath,
    });

    broadcastWorkspaceUpdated({ projectId });
    response.json(updatedProject);
  } catch (error) {
    next(error);
  }
});

projectsRouter.delete("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);

    for (const job of listCronJobs().filter((entry) => entry.projectId === projectId)) {
      stopScheduledCronJob(job.id);
    }

    if (!deleteProject(projectId)) {
      throw new HttpError(404, "Project not found.");
    }

    broadcastWorkspaceUpdated({ projectId });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

projectsRouter.post("/api/projects/:projectId/threads", async (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const title = assertNonEmptyString(request.body.title, "Thread title");
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    if (!project.connection?.telegramChatId || !project.connection.telegramAccessHash) {
      throw new HttpError(400, "Project Telegram connection is missing.");
    }

    const authConfig = getAuthConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);
    const topic = await createForumTopic(
      client,
      {
        telegramChatId: project.connection.telegramChatId,
        telegramAccessHash: project.connection.telegramAccessHash,
      },
      title,
    );

    const createdThread = createThread({
      projectId,
      title: topic.title,
      telegramTopicId: topic.telegramTopicId,
      telegramTopicName: topic.title,
      origin: "app",
    });

    broadcastWorkspaceUpdated({
      projectId,
      threadId: createdThread.id,
    });

    response.status(201).json(createdThread);
  } catch (error) {
    next(error);
  }
});
