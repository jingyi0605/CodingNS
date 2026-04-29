import http from "node:http";

type QrStatus = "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";

interface PollBatch {
  cursor?: string;
  msgs?: Record<string, unknown>[];
}

export interface WechatClawUpstreamStub {
  readonly baseUrl: string;
  readonly calls: {
    getBotQrCode: number;
    getQrCodeStatus: number;
    getConfig: number;
    getUpdates: number;
    sendMessage: number;
    sendBodies: Record<string, unknown>[];
  };
  setQrStatuses(statuses: QrStatus[]): void;
  setPollBatches(batches: PollBatch[]): void;
  close(): Promise<void>;
}

export async function createWechatClawUpstreamStub(): Promise<WechatClawUpstreamStub> {
  let qrStatuses: QrStatus[] = ["wait"];
  let pollBatches: PollBatch[] = [];
  const calls = {
    getBotQrCode: 0,
    getQrCodeStatus: 0,
    getConfig: 0,
    getUpdates: 0,
    sendMessage: 0,
    sendBodies: [] as Record<string, unknown>[]
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/ilink/bot/get_bot_qrcode") {
      calls.getBotQrCode += 1;
      replyJson(response, {
        qrcode: "qr-session-1",
        qrcode_img_content: `${stub.baseUrl}/mock-qr.png`
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock-qr.png") {
      response.statusCode = 200;
      response.setHeader("content-type", "image/png");
      response.end(Buffer.from(MOCK_QR_PNG_BASE64, "base64"));
      return;
    }

    if (request.method === "GET" && url.pathname === "/ilink/bot/get_qrcode_status") {
      calls.getQrCodeStatus += 1;
      const status = qrStatuses.length > 1 ? qrStatuses.shift() ?? "wait" : qrStatuses[0] ?? "wait";

      if (status === "confirmed") {
        replyJson(response, {
          status,
          bot_token: "bot-token-1",
          ilink_bot_id: "bot-1",
          ilink_user_id: "wx-user-1",
          baseurl: stub.baseUrl
        });
        return;
      }

      replyJson(response, {
        status,
        baseurl: stub.baseUrl
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/ilink/bot/getconfig") {
      calls.getConfig += 1;
      replyJson(response, {
        ret: 0,
        errmsg: "",
        typing_ticket: "typing-ticket-1"
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/ilink/bot/getupdates") {
      calls.getUpdates += 1;
      const batch = pollBatches.length > 0
        ? pollBatches.shift() ?? {}
        : {};
      replyJson(response, {
        ret: 0,
        errmsg: "",
        msgs: batch.msgs ?? [],
        get_updates_buf: batch.cursor ?? `cursor-${calls.getUpdates}`
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/ilink/bot/sendmessage") {
      calls.sendMessage += 1;
      const body = await readJsonBody(request);
      calls.sendBodies.push(body);
      replyJson(response, {
        ret: 0,
        errmsg: ""
      });
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("wechat claw upstream stub 启动失败");
  }

  const stub: WechatClawUpstreamStub = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    setQrStatuses(statuses) {
      qrStatuses = statuses.length > 0 ? [...statuses] : ["wait"];
    },
    setPollBatches(batches) {
      pollBatches = [...batches];
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };

  return stub;
}

const MOCK_QR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";

function replyJson(response: http.ServerResponse, payload: Record<string, unknown>): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) {
    return {};
  }

  return JSON.parse(body) as Record<string, unknown>;
}
