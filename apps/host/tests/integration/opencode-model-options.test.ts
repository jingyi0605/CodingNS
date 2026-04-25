import { chmodSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyFixture, createTestApp, destroyFixture } from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeClosers: Array<() => Promise<void>> = [];
const activeFixtures: Array<{ rootDir: string }> = [];

describe("OpenCode model capabilities", () => {
  afterEach(async () => {
    while (activeServers.length > 0) {
      const hosted = activeServers.pop();

      if (hosted) {
        await hosted.app.close();
      }
    }

    while (activeClosers.length > 0) {
      const closer = activeClosers.pop();

      if (closer) {
        await closer();
      }
    }

    while (activeFixtures.length > 0) {
      const fixture = activeFixtures.pop();

      if (fixture) {
        destroyFixture(fixture);
      }
    }
  });

  it("会通过 provider capabilities 路由返回 OpenCode server 的多供应商模型列表", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const requestedDirectories: string[] = [];
    const server = createServer((request, response) => {
      handleConfigProvidersRequest(request, response, fixture.workspaceDir, requestedDirectories);
    });
    const baseUrl = await listenHttpServer(server);
    activeClosers.push(() => closeHttpServer(server));

    const hosted = createTestApp(fixture, {
      opencodeBaseUrl: baseUrl
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const response = await hosted.app.inject({
      method: "GET",
      url: `/api/providers/opencode/capabilities?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(requestedDirectories).toEqual([fixture.workspaceDir]);
    expect(response.json().modelOptions).toEqual([
      {
        id: "provider-default",
        name: "跟随 OpenCode 默认模型",
        usesProviderDefault: true
      },
      {
        id: "openai/gpt-5",
        name: "openai/gpt-5"
      },
      {
        id: "openai/gpt-5-mini",
        name: "openai/gpt-5-mini"
      },
      {
        id: "deepseek/deepseek-chat",
        name: "deepseek/deepseek-chat"
      },
      {
        id: "deepseek/deepseek-reasoner",
        name: "deepseek/deepseek-reasoner"
      }
    ]);
  });

  it("OpenCode server 不可达时会回退到 CLI 的多供应商模型列表", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const commandPath = createMockOpenCodeCli(fixture.rootDir, [
      "openai/gpt-5",
      "openai/gpt-5-mini",
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner"
    ]);
    const hosted = createTestApp(fixture, {
      opencodeBaseUrl: "http://127.0.0.1:1",
      opencodeCliPath: commandPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const response = await hosted.app.inject({
      method: "GET",
      url: `/api/providers/opencode/capabilities?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().modelOptions).toEqual([
      {
        id: "provider-default",
        name: "跟随 OpenCode 默认模型",
        usesProviderDefault: true
      },
      {
        id: "openai/gpt-5",
        name: "openai/gpt-5"
      },
      {
        id: "openai/gpt-5-mini",
        name: "openai/gpt-5-mini"
      },
      {
        id: "deepseek/deepseek-chat",
        name: "deepseek/deepseek-chat"
      },
      {
        id: "deepseek/deepseek-reasoner",
        name: "deepseek/deepseek-reasoner"
      }
    ]);
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  const login = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  return login.json().accessToken as string;
}

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const imported = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "OpenCode Fixture Workspace"
    }
  });

  expect(imported.statusCode).toBe(201);
  return imported.json().id as string;
}


function handleConfigProvidersRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceDir: string,
  requestedDirectories: string[]
): void {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname !== "/config/providers") {
    response.statusCode = 404;
    response.end("NOT_FOUND");
    return;
  }

  requestedDirectories.push(requestUrl.searchParams.get("directory") ?? "");
  expect(requestUrl.searchParams.get("directory")).toBe(workspaceDir);

  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-5": {
              id: "gpt-5",
              name: "gpt-5"
            },
            "gpt-5-mini": {
              id: "gpt-5-mini",
              name: "gpt-5-mini"
            }
          }
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          models: {
            "deepseek-chat": {
              id: "deepseek-chat",
              name: "deepseek-chat"
            },
            "deepseek-reasoner": {
              id: "deepseek-reasoner",
              name: "deepseek-reasoner"
            }
          }
        }
      ],
      default: {
        openai: "gpt-5",
        deepseek: "deepseek-chat"
      }
    })
  );
}

function listenHttpServer(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("HTTP_SERVER_ADDRESS_INVALID"));
        return;
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function createMockOpenCodeCli(rootDir: string, models: string[]): string {
  const commandPath = path.join(rootDir, "opencode-mock.js");

  writeFileSync(
    commandPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "models" && args[1] === "opencode") {
  process.stdout.write(${JSON.stringify(models.join("\n"))} + "\\n");
  process.exit(0);
}
if (args[0] === "models" && args.length === 1) {
  process.stdout.write(${JSON.stringify(models.join("\n"))} + "\\n");
  process.exit(0);
}
process.stderr.write("UNSUPPORTED_COMMAND\\n");
process.exit(1);
`,
    "utf8"
  );
  chmodSync(commandPath, 0o755);

  return commandPath;
}
