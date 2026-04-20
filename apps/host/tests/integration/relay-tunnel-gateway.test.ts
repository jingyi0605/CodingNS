import http from "node:http";
import { AddressInfo } from "node:net";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import type { RelayTunnelGatewayPacket } from "../../src/modules/relay-tunnel/crypto/relay-tunnel-packets.js";
import { RelayTunnelGatewayService } from "../../src/modules/relay-tunnel/relay-tunnel-gateway-service.js";

const resources: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (resources.length > 0) {
    const dispose = resources.pop();

    if (dispose) {
      await dispose();
    }
  }
});

describe("RelayTunnelGatewayService", () => {
  it("可以把加密通道里的 HTTP 请求转发到本地业务 Host", async () => {
    const upstream = await createLocalEchoServer();
    const packets: RelayTunnelGatewayPacket[] = [];
    const gateway = new RelayTunnelGatewayService({
      localTargetBaseUrl: upstream.baseUrl,
      onPacket: (packet) => {
        packets.push(packet);
      }
    });

    await gateway.handlePacket({
      type: "http.request",
      streamId: "stream-http-1",
      method: "POST",
      path: "/echo?mode=tunnel",
      headers: {
        authorization: "Bearer relay-demo",
        "content-type": "application/json"
      },
      bodyBase64Url: Buffer.from(JSON.stringify({ hello: "world" }), "utf8").toString("base64url")
    });

    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({
      type: "http.response",
      streamId: "stream-http-1",
      status: 200,
      headers: expect.objectContaining({
        "content-type": "application/json",
        "x-echo-method": "POST",
        "x-echo-auth": "Bearer relay-demo"
      }),
      bodyBase64Url: expect.any(String)
    });
    expect(
      JSON.parse(
        Buffer.from(
          (packets[0] as Extract<RelayTunnelGatewayPacket, { type: "http.response" }>).bodyBase64Url!,
          "base64url"
        ).toString("utf8")
      )
    ).toEqual({
      method: "POST",
      path: "/echo?mode=tunnel",
      authorization: "Bearer relay-demo",
      bodyText: JSON.stringify({ hello: "world" })
    });

    gateway.close();
  });

  it("可以把加密通道里的 WebSocket 流量转发到本地业务 /ws", async () => {
    const upstream = await createLocalEchoServer();
    const packets: RelayTunnelGatewayPacket[] = [];
    const gateway = new RelayTunnelGatewayService({
      localTargetBaseUrl: upstream.baseUrl,
      onPacket: (packet) => {
        packets.push(packet);
      }
    });

    await gateway.handlePacket({
      type: "ws.open",
      streamId: "stream-ws-1",
      path: "/ws-echo?token=demo",
      headers: {
        "x-tunnel-test": "1"
      },
      protocols: ["vite-hmr"]
    });

    await waitFor(
      () => packets.find((packet) => packet.type === "ws.opened" && packet.streamId === "stream-ws-1"),
      "等待 ws.opened 超时"
    );

    await gateway.handlePacket({
      type: "ws.message",
      streamId: "stream-ws-1",
      binary: false,
      dataBase64Url: Buffer.from("ping", "utf8").toString("base64url")
    });

    const messagePacket = await waitFor(
      () =>
        packets.find(
          (packet): packet is Extract<RelayTunnelGatewayPacket, { type: "ws.message" }> =>
            packet.type === "ws.message" && packet.streamId === "stream-ws-1"
        ),
      "等待 ws.message 超时"
    );
    expect(Buffer.from(messagePacket.dataBase64Url, "base64url").toString("utf8")).toBe("pong:ping");
    const openedPacket = packets.find(
      (packet): packet is Extract<RelayTunnelGatewayPacket, { type: "ws.opened" }> =>
        packet.type === "ws.opened" && packet.streamId === "stream-ws-1"
    );
    expect(openedPacket?.selectedProtocol).toBe("vite-hmr");

    await gateway.handlePacket({
      type: "ws.closed",
      streamId: "stream-ws-1",
      code: 1000,
      reason: "done"
    });

    const closePacket = await waitFor(
      () =>
        packets.find(
          (packet): packet is Extract<RelayTunnelGatewayPacket, { type: "ws.closed" }> =>
            packet.type === "ws.closed" && packet.streamId === "stream-ws-1"
        ),
      "等待 ws.closed 超时"
    );
    expect(closePacket.code).toBe(1000);

    gateway.close();
  });
});

async function createLocalEchoServer(): Promise<{
  baseUrl: string;
}> {
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith("/echo")) {
      const bodyChunks: Buffer[] = [];

      for await (const chunk of request) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const bodyText = Buffer.concat(bodyChunks).toString("utf8");

      response.writeHead(200, {
        "content-type": "application/json",
        "x-echo-method": request.method ?? "GET",
        "x-echo-auth": request.headers.authorization ?? ""
      });
      response.end(
        JSON.stringify({
          method: request.method ?? "GET",
          path: request.url ?? "/",
          authorization: request.headers.authorization ?? null,
          bodyText
        })
      );
      return;
    }

    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      if (protocols.has("vite-hmr")) {
        return "vite-hmr";
      }

      return false;
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/ws-echo") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (payload) => {
        client.send(`pong:${payload.toString()}`);
      });
      client.on("close", () => {
        client.close();
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  resources.push(async () => {
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function waitFor<T>(
  loader: () => T | undefined,
  detail: string
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 3_000) {
    const loaded = loader();

    if (loaded !== undefined) {
      return loaded;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(detail);
}
