import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { readPluginManifest, validatePluginManifest } from "../../src/modules/plugins/plugin-manifest.js";

function createPluginRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-manifest-"));
}

describe("plugin-manifest", () => {
  it("能校验合法 manifest", () => {
    const root = createPluginRoot();
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>", "utf8");
    fs.writeFileSync(path.join(root, "action.js"), "export default {}", "utf8");

    const manifest = validatePluginManifest({
      id: "demo.plugin",
      name: "演示插件",
      version: "1.0.0",
      frontend: {
        entry: "index.html",
        mode: "static_html"
      },
      backend: {
        runtime: "node",
        actions: [
          {
            id: "hello",
            title: "Hello",
            entry: "action.js",
            timeoutMs: 3000
          }
        ]
      },
      permissions: {
        workspaceRead: true,
        desktop: ["open_file"]
      },
      schedules: [
        {
          id: "hourly",
          actionId: "hello",
          everySeconds: 3600
        }
      ]
    }, root);

    expect(manifest.id).toBe("demo.plugin");
    expect(manifest.frontend?.entry).toBe("index.html");
    expect(manifest.backend?.actions[0]?.entry).toBe("action.js");
    expect(manifest.permissions.desktop).toEqual(["open_file"]);
  });

  it("会拒绝越出插件目录的 entry", () => {
    const root = createPluginRoot();
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>", "utf8");

    expect(() => validatePluginManifest({
      id: "demo.plugin",
      name: "演示插件",
      version: "1.0.0",
      frontend: {
        entry: "../escape.html"
      },
      permissions: {}
    }, root)).toThrowError(AppError);
  });

  it("会从磁盘读取 plugin.json", () => {
    const root = createPluginRoot();
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>", "utf8");
    fs.writeFileSync(path.join(root, "plugin.json"), JSON.stringify({
      id: "reader.plugin",
      name: "读取插件",
      version: "1.0.0",
      frontend: {
        entry: "index.html"
      },
      permissions: {}
    }, null, 2), "utf8");

    const parsed = readPluginManifest(root);

    expect(parsed.installRoot).toBe(root);
    expect(parsed.manifest.id).toBe("reader.plugin");
  });
});
