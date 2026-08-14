import type { FastifyInstance } from "fastify";

import type { GitController } from "../modules/git/git-controller.js";

export async function registerGitRoutes(
  app: FastifyInstance,
  gitController: GitController
): Promise<void> {
  app.get("/api/git/status", gitController.getStatus);
  app.post("/api/git/init", gitController.initializeRepository);
  app.get("/api/git/diff", gitController.getDiff);
  app.get("/api/git/commit-detail", gitController.getCommitDetail);
  app.post("/api/git/stage", gitController.stage);
  app.post("/api/git/unstage", gitController.unstage);
  app.post("/api/git/discard", gitController.discard);
  app.post("/api/git/ignore", gitController.addToGitIgnore);
  app.get("/api/git/rules", gitController.getRules);
  app.put("/api/git/rules", gitController.saveRules);
  app.post("/api/git/commit/draft", gitController.createCommitDraft);
  app.post("/api/git/commit/validate", gitController.validateCommit);
  app.post("/api/git/commit", gitController.commit);
  app.post("/api/git/commit/undo", gitController.undoLastCommit);
  app.get("/api/git/history", gitController.getHistory);
  app.get("/api/git/branches", gitController.getBranches);
  app.get("/api/git/tags", gitController.getTags);
  app.post("/api/git/branches/switch", gitController.switchBranch);
  app.get("/api/git/remotes", gitController.getRemotes);
  app.post("/api/git/remote/sync", gitController.syncRemote);
}
