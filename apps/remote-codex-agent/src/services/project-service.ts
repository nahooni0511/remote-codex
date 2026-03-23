import {
  createProject,
  createThread,
  deleteProject,
  getProjectById,
  listCronJobs,
  saveProjectTelegramConnection,
  updateProject,
} from "../db";
import { HttpError } from "../lib/http";
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
  getProjectGitState,
  listProjectFileTree,
  stopScheduledCronJob,
  switchProjectGitBranch,
  syncScopedBotCommandsForProject,
} from "./runtime";

export async function createWorkspaceProject(input: {
  createTelegramBinding: boolean;
  folderPath: string;
  name: string;
}) {
  const project = createProject({
    name: input.name,
    folderPath: input.folderPath,
  });

  if (input.createTelegramBinding) {
    const authConfig = getAuthConfigOrThrow();
    const botConfig = getBotConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);

    const createdGroup = await createForumSupergroup(client, {
      title: input.name,
      about: `Codex project: ${input.name}`,
    });

    await inviteUserToSupergroup(
      client,
      {
        telegramChatId: createdGroup.telegramChannelId,
        telegramAccessHash: createdGroup.telegramAccessHash,
      },
      botConfig.botUserName,
    );

    saveProjectTelegramConnection(project.id, {
      telegramChatId: createdGroup.telegramChannelId,
      telegramAccessHash: createdGroup.telegramAccessHash,
      telegramChatTitle: createdGroup.telegramTitle,
      forumEnabled: createdGroup.forumEnabled,
    });
    await syncScopedBotCommandsForProject(getProjectById(project.id)!);
  }

  broadcastWorkspaceUpdated({
    projectId: project.id,
  });

  return getProjectById(project.id);
}

export function getWorkspaceProject(projectId: number) {
  const project = getProjectById(projectId);
  if (!project) {
    throw new HttpError(404, "Project not found.");
  }

  return project;
}

export async function getWorkspaceProjectGit(projectId: number) {
  const project = getWorkspaceProject(projectId);
  return {
    git: await getProjectGitState(project),
  };
}

export async function switchWorkspaceProjectBranch(input: {
  branchName: string;
  createNew: boolean;
  projectId: number;
}) {
  const project = getWorkspaceProject(input.projectId);
  const git = await switchProjectGitBranch({
    project,
    branchName: input.branchName,
    createNew: input.createNew,
  });

  broadcastWorkspaceUpdated({ projectId: project.id });
  return { git };
}

export function getWorkspaceProjectFileTree(projectId: number, currentPath?: string) {
  const project = getWorkspaceProject(projectId);
  return listProjectFileTree(project, currentPath);
}

export function updateWorkspaceProjectFolder(input: { folderPath: string; projectId: number }) {
  const project = getWorkspaceProject(input.projectId);
  const updatedProject = updateProject(input.projectId, {
    name: project.name,
    folderPath: input.folderPath,
  });

  broadcastWorkspaceUpdated({ projectId: input.projectId });
  return updatedProject;
}

export function deleteWorkspaceProject(projectId: number) {
  for (const job of listCronJobs().filter((entry) => entry.projectId === projectId)) {
    stopScheduledCronJob(job.id);
  }

  if (!deleteProject(projectId)) {
    throw new HttpError(404, "Project not found.");
  }

  broadcastWorkspaceUpdated({ projectId });
}

export async function createWorkspaceProjectThread(input: {
  createTelegramBinding: boolean;
  projectId: number;
  title: string;
}) {
  const project = getWorkspaceProject(input.projectId);

  const shouldCreateTelegramTopic =
    input.createTelegramBinding === true &&
    project.connection?.telegramChatId &&
    project.connection.telegramAccessHash;

  const createdThread = shouldCreateTelegramTopic
    ? await (async () => {
        const authConfig = getAuthConfigOrThrow();
        const client = await getAuthenticatedClient(authConfig);
        const topic = await createForumTopic(
          client,
          {
            telegramChatId: project.connection!.telegramChatId!,
            telegramAccessHash: project.connection!.telegramAccessHash!,
          },
          input.title,
        );

        return createThread({
          projectId: input.projectId,
          title: topic.title,
          telegramTopicId: topic.telegramTopicId,
          telegramTopicName: topic.title,
          origin: "app",
        });
      })()
    : createThread({
        projectId: input.projectId,
        title: input.title,
        origin: "app",
      });

  broadcastWorkspaceUpdated({
    projectId: input.projectId,
    threadId: createdThread.id,
  });

  return createdThread;
}
