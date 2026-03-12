import { Router } from "express";

import { listDirectoryNodes, normalizeExistingDirectoryPath } from "../services/runtime";

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
