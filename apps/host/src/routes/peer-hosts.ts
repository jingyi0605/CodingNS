import type { FastifyInstance } from "fastify";

import type {
  HostApiProxyController,
  PeerHostController,
} from "../modules/peer-host/peer-host-controller.js";

export async function registerPeerHostRoutes(
  app: FastifyInstance,
  peerHostController: PeerHostController,
  hostApiProxyController: HostApiProxyController,
): Promise<void> {
  app.get("/api/peer-hosts", peerHostController.list);
  app.post("/api/peer-hosts", peerHostController.create);
  app.get(
    "/api/peer-hosts/workspace-bindings",
    peerHostController.listWorkspaceBindings,
  );
  app.put(
    "/api/peer-hosts/workspace-bindings/:workspaceKey",
    peerHostController.saveWorkspaceBinding,
  );
  app.get("/api/peer-hosts/:peerHostId", peerHostController.get);
  app.put("/api/peer-hosts/:peerHostId", peerHostController.update);
  app.delete("/api/peer-hosts/:peerHostId", peerHostController.delete);
  app.post("/api/peer-hosts/:peerHostId/check", peerHostController.check);
  app.post("/api/peer-hosts/:peerHostId/login", peerHostController.login);
  app.delete(
    "/api/peer-hosts/:peerHostId/session",
    peerHostController.deleteSession,
  );

  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    url: "/api/host-proxy/hosts/:peerHostId/*",
    handler: hostApiProxyController.proxy,
  });
}
