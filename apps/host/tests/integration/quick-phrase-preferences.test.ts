import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("快捷短语偏好持久化", () => {
  it("会把快捷短语按用户写入数据库，并在重启后继续保留", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const firstHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(firstHosted);
    await firstHosted.app.ready();

    const firstAccessToken = await bootstrapAndLogin(firstHosted);
    const initialList = await firstHosted.app.inject({
      method: "GET",
      url: "/api/preferences/quick-phrases",
      headers: {
        authorization: `Bearer ${firstAccessToken}`
      }
    });

    expect(initialList.statusCode).toBe(200);
    expect(initialList.json().items).toHaveLength(3);

    const replaceResponse = await firstHosted.app.inject({
      method: "PUT",
      url: "/api/preferences/quick-phrases",
      headers: {
        authorization: `Bearer ${firstAccessToken}`
      },
      payload: {
        items: [
          {
            id: "builtin-group-commits",
            text: "分析当前项目中的未提交文件，按照功能模块进行分类提交，提交信息格式请参考我最近的提交记录"
          },
          {
            text: "请整理当前改动的风险并给出验证建议"
          }
        ]
      }
    });

    expect(replaceResponse.statusCode).toBe(200);
    expect(replaceResponse.json().items).toEqual([
      expect.objectContaining({
        id: "builtin-group-commits"
      }),
      expect.objectContaining({
        text: "请整理当前改动的风险并给出验证建议"
      })
    ]);

    await firstHosted.app.close();
    activeServers.pop();

    const secondHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(secondHosted);
    await secondHosted.app.ready();

    const secondAccessToken = await login(secondHosted);
    const persistedList = await secondHosted.app.inject({
      method: "GET",
      url: "/api/preferences/quick-phrases",
      headers: {
        authorization: `Bearer ${secondAccessToken}`
      }
    });

    expect(persistedList.statusCode).toBe(200);
    expect(persistedList.json().items).toEqual([
      {
        id: "builtin-group-commits",
        text: "分析当前项目中的未提交文件，按照功能模块进行分类提交，提交信息格式请参考我最近的提交记录"
      },
      expect.objectContaining({
        text: "请整理当前改动的风险并给出验证建议"
      })
    ]);
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return await login(hosted);
}

async function login(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json().accessToken as string;
}
