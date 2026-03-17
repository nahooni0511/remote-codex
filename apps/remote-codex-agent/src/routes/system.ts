import { Router } from "express";

import { HttpError } from "../lib/http";
import { applyAppUpdate, getAppUpdateStatus } from "../services/runtime";

export const systemRouter = Router();

let systemUpdateInProgress = false;

systemRouter.post("/api/system/update/check", async (_request, response, next) => {
  try {
    response.json(await getAppUpdateStatus({ fetchRemote: true }));
  } catch (error) {
    next(error);
  }
});

systemRouter.post("/api/system/update/apply", async (_request, response, next) => {
  if (systemUpdateInProgress) {
    next(new HttpError(409, "다른 업데이트 작업이 이미 진행 중입니다."));
    return;
  }

  systemUpdateInProgress = true;

  try {
    response.json(await applyAppUpdate());
  } catch (error) {
    next(error);
  } finally {
    systemUpdateInProgress = false;
  }
});
