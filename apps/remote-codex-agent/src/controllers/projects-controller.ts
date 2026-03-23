import type { Request, Response } from "express";

import { assertNonEmptyString, parseNumericId, validateFolderPath } from "../lib/http";
import {
  createWorkspaceProject,
  createWorkspaceProjectThread,
  deleteWorkspaceProject,
  getWorkspaceProject,
  getWorkspaceProjectFileTree,
  getWorkspaceProjectGit,
  switchWorkspaceProjectBranch,
  updateWorkspaceProjectFolder,
} from "../services/project-service";

function getParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value;
}

export async function createProject(request: Request, response: Response) {
  const projectName = assertNonEmptyString(request.body.name ?? request.body.groupName, "Project name");
  const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));

  response.status(201).json(
    await createWorkspaceProject({
      createTelegramBinding: request.body.createTelegramBinding === true,
      folderPath,
      name: projectName,
    }),
  );
}

export function getProject(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  response.json(getWorkspaceProject(projectId));
}

export async function getProjectGit(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  response.json(await getWorkspaceProjectGit(projectId));
}

export async function switchProjectBranch(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  const branchName = assertNonEmptyString(request.body.branchName, "Branch name");

  response.json(
    await switchWorkspaceProjectBranch({
      branchName,
      createNew: request.body.createNew === true,
      projectId,
    }),
  );
}

export function getProjectFileTree(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  const currentPath = typeof request.query.path === "string" ? request.query.path : undefined;

  response.json(getWorkspaceProjectFileTree(projectId, currentPath));
}

export function updateProject(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));

  response.json(
    updateWorkspaceProjectFolder({
      folderPath,
      projectId,
    }),
  );
}

export function deleteProject(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  deleteWorkspaceProject(projectId);
  response.status(204).end();
}

export async function createProjectThread(request: Request, response: Response) {
  const projectId = parseNumericId(getParam(request.params.projectId));
  const title = assertNonEmptyString(request.body.title, "Thread title");

  response.status(201).json(
    await createWorkspaceProjectThread({
      createTelegramBinding: request.body.createTelegramBinding === true,
      projectId,
      title,
    }),
  );
}
