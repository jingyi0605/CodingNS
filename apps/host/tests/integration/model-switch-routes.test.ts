import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const activeDirs: string[] = [];

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

  while (activeDirs.length > 0) {
    const dir = activeDirs.pop();

    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("model switch routes", () => {
  it("可以返回四个应用的模型管理快照，并在切换后刷新当前预设", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const toolDir = mkdtempSync(path.join(os.tmpdir(), "codingns-cc-switch-"));
    activeDirs.push(toolDir);
    const ccSwitchDbPath = path.join(toolDir, "cc-switch.db");
    const ccSwitchCliPath = path.join(toolDir, "cc-switch");

    seedCcSwitchDb(ccSwitchDbPath);
    writeFakeCcSwitchCli(ccSwitchCliPath);
    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite"),
      ccSwitchCliPath,
      ccSwitchDbPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const overviewResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/system/model-switch",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          app: "codex",
          status: "ready",
          currentPresetId: "codex-gpt54",
          currentModel: "gpt-5.4"
        }),
        expect.objectContaining({
          app: "claude-code",
          status: "ready",
          currentPresetId: "claude-kimi",
          currentModel: "kimi-k2.5"
        }),
        expect.objectContaining({
          app: "gemini",
          status: "unconfigured",
          cliAvailable: true
        }),
        expect.objectContaining({
          app: "opencode",
          status: "ready",
          currentPresetId: "opencode-openai",
          currentModel: "openai/gpt-5.4"
        })
      ])
    });

    const switchResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/model-switch",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        app: "codex",
        presetId: "codex-gpt53"
      }
    });

    expect(switchResponse.statusCode).toBe(200);
    expect(switchResponse.json()).toMatchObject({
      app: "codex",
      currentPresetId: "codex-gpt53",
      currentModel: "gpt-5.3-codex"
    });
  });

  it("找不到 cc-switch 命令时会返回不可用状态", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const toolDir = mkdtempSync(path.join(os.tmpdir(), "codingns-cc-switch-missing-"));
    activeDirs.push(toolDir);
    const ccSwitchDbPath = path.join(toolDir, "cc-switch.db");

    seedCcSwitchDb(ccSwitchDbPath);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite"),
      ccSwitchCliPath: path.join(toolDir, "missing-cc-switch"),
      ccSwitchDbPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/system/model-switch",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          app: "codex",
          status: "unavailable",
          cliAvailable: false
        })
      ])
    );
  });
});

function seedCcSwitchDb(dbPath: string): void {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      website_url TEXT,
      category TEXT,
      created_at INTEGER,
      sort_index INTEGER,
      notes TEXT,
      icon TEXT,
      icon_color TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      is_current BOOLEAN NOT NULL DEFAULT 0,
      in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
      cost_multiplier TEXT NOT NULL DEFAULT '1.0',
      limit_daily_usd TEXT,
      limit_monthly_usd TEXT,
      provider_type TEXT,
      PRIMARY KEY (id, app_type)
    );
  `);

  const insert = db.prepare(`
    INSERT INTO providers (id, app_type, name, settings_config, created_at, sort_index, is_current, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
  `);

  insert.run(
    "codex-gpt54",
    "codex",
    "Codex GPT-5.4",
    JSON.stringify({
      config: 'model = "gpt-5.4"\nmodel_provider = "api"\n'
    }),
    1,
    0,
    1
  );
  insert.run(
    "codex-gpt53",
    "codex",
    "Codex GPT-5.3",
    JSON.stringify({
      config: 'model = "gpt-5.3-codex"\nmodel_provider = "api"\n'
    }),
    2,
    1,
    0
  );
  insert.run(
    "claude-kimi",
    "claude",
    "Claude Kimi",
    JSON.stringify({
      env: {
        ANTHROPIC_MODEL: "kimi-k2.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k2.5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k2.5"
      }
    }),
    3,
    0,
    1
  );
  insert.run(
    "opencode-openai",
    "opencode",
    "OpenCode GPT-5.4",
    JSON.stringify({
      model: "openai/gpt-5.4"
    }),
    4,
    0,
    1
  );

  db.close();
}

function writeFakeCcSwitchCli(filePath: string): void {
  writeFileSync(
    filePath,
    `#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DB_PATH="$SCRIPT_DIR/cc-switch.db"

if [ "$#" -lt 5 ]; then
  echo "unsupported command" >&2
  exit 1
fi

APP_TYPE="$4"
PRESET_ID="$5"

if [ "$APP_TYPE" = "open-code" ]; then
  APP_TYPE="opencode"
fi

sqlite3 "$DB_PATH" "UPDATE providers SET is_current = 0 WHERE app_type = '$APP_TYPE';"
sqlite3 "$DB_PATH" "UPDATE providers SET is_current = 1 WHERE app_type = '$APP_TYPE' AND id = '$PRESET_ID';"
echo "ok"
`,
    "utf8"
  );
  chmodSync(filePath, 0o755);
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return loginResponse.json().accessToken as string;
}
