import { Router } from "express";

import { HttpError } from "../lib/http";
import { applyAppUpdate, getAppUpdateStatus } from "../services/runtime";
import { canScheduleRuntimeRestart, scheduleRuntimeRestart } from "../services/runtime/process-control";

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
    const result = await applyAppUpdate();
    const autoRestart = result.restartRequired && canScheduleRuntimeRestart();
    const payload = autoRestart
      ? {
          ...result,
          reason: result.targetVersion
            ? `v${result.targetVersion} 업데이트를 설치했습니다. 런타임을 자동으로 재시작합니다.`
            : "업데이트를 설치했습니다. 런타임을 자동으로 재시작합니다.",
        }
      : result;

    if (autoRestart) {
      response.once("finish", () => {
        scheduleRuntimeRestart("system update");
      });
    }

    response.json(payload);
  } catch (error) {
    next(error);
  } finally {
    systemUpdateInProgress = false;
  }
});
