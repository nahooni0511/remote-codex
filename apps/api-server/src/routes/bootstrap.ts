import { Router } from "express";

import { getAppState } from "../services/runtime";

export const bootstrapRouter = Router();

bootstrapRouter.get("/api/bootstrap", async (_request, response, next) => {
  try {
    response.json(await getAppState());
  } catch (error) {
    next(error);
  }
});
