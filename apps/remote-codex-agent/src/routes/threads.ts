import { Router } from "express";

import { createRouteHandler } from "../controllers/route-handler";
import {
  createThreadMessage,
  deleteThread,
  getMessageAttachment,
  getThreadComposerSettings,
  getThreadMessages,
  interruptThread,
  patchThreadComposerSettings,
  respondToThreadUserInputRequest,
  undoThreadTurn,
  uploadThreadAttachment,
} from "../controllers/threads-controller";

export const threadsRouter = Router();

threadsRouter.get("/api/messages/:messageId/attachment", createRouteHandler(getMessageAttachment));
threadsRouter.get("/api/threads/:threadId/messages", createRouteHandler(getThreadMessages));
threadsRouter.post("/api/threads/:threadId/messages", createRouteHandler(createThreadMessage));
threadsRouter.get("/api/threads/:threadId/composer-settings", createRouteHandler(getThreadComposerSettings));
threadsRouter.patch("/api/threads/:threadId/composer-settings", createRouteHandler(patchThreadComposerSettings));
threadsRouter.post("/api/threads/:threadId/attachments/upload", createRouteHandler(uploadThreadAttachment));
threadsRouter.post(
  "/api/threads/:threadId/user-input-requests/:requestId/respond",
  createRouteHandler(respondToThreadUserInputRequest),
);
threadsRouter.post("/api/threads/:threadId/interrupt", createRouteHandler(interruptThread));
threadsRouter.post("/api/threads/:threadId/turns/:turnRunId/undo", createRouteHandler(undoThreadTurn));
threadsRouter.delete("/api/threads/:threadId", createRouteHandler(deleteThread));
