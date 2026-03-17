import { Router } from "express";

import { assertNonEmptyString } from "../lib/http";
import { createDirectoryNode, listDirectoryNodes, normalizeExistingDirectoryPath } from "../services/runtime";

export const fsRouter = Router();

fsRouter.get("/api/fs/list", (request, response, next) => {
  try {
    const targetPath = typeof request.query.path === "string" ? request.query.path : undefined;
    response.json({
      path: normalizeExistingDirectoryPath(targetPath),
      entries: listDirectoryNodes(targetPath || "/"),
    });
  } catch (error) {
    next(error);
  }
});

fsRouter.post("/api/fs/directories", (request, response, next) => {
  try {
    const parentPath = typeof request.body.parentPath === "string" ? request.body.parentPath : undefined;
    const entry = createDirectoryNode(parentPath || "/", assertNonEmptyString(request.body.name, "Directory name"));
    response.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});
