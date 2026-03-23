import { Router } from "express";

import { createRouteHandler } from "../controllers/route-handler";
import {
  createProject,
  createProjectThread,
  deleteProject,
  getProject,
  getProjectFileTree,
  getProjectGit,
  switchProjectBranch,
  updateProject,
} from "../controllers/projects-controller";

export const projectsRouter = Router();

projectsRouter.post("/api/projects", createRouteHandler(createProject));
projectsRouter.get("/api/projects/:projectId", createRouteHandler(getProject));
projectsRouter.get("/api/projects/:projectId/git", createRouteHandler(getProjectGit));
projectsRouter.post("/api/projects/:projectId/git/branch", createRouteHandler(switchProjectBranch));
projectsRouter.get("/api/projects/:projectId/files/tree", createRouteHandler(getProjectFileTree));
projectsRouter.put("/api/projects/:projectId", createRouteHandler(updateProject));
projectsRouter.delete("/api/projects/:projectId", createRouteHandler(deleteProject));
projectsRouter.post("/api/projects/:projectId/threads", createRouteHandler(createProjectThread));
