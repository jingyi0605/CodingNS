#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(packageRoot, "dist");

const [command, ...argv] = process.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp(0);
}

switch (command) {
  case "start":
    await runStartCommand(argv);
    break;
  case "assistant":
    await runAssistantCommand(argv);
    break;
  case "skills":
    await runSkillsCommand(argv);
    break;
  default:
    console.error(`[codingns] 不支持的命令：${command}`);
    printHelp(1);
}

async function runStartCommand(argv) {
  const options = parseArgs(argv, {
    supportedOptions: ["host", "port", "data-dir"],
    supportedFlags: ["demo"]
  });

  if (options.help) {
    printHelp(0);
  }

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      console.error(`[codingns] ${error}`);
    }
    printHelp(1);
  }

  const host = readStringOption(
    options.values.host,
    process.env.HOST,
    process.env.CODINGNS_HOST,
    "0.0.0.0"
  );
  const port = parsePort(
    readStringOption(options.values.port, process.env.PORT, process.env.CODINGNS_PORT, "3002")
  );
  const dataDir = resolveDataDir(
    readStringOption(
      options.values["data-dir"],
      process.env.CODINGNS_DATA_DIR,
      path.join(os.homedir(), ".codingns")
    )
  );
  const demoMode = options.flags.demo || process.env.DEMO_MODE === "true";

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "releases"), { recursive: true });

  const { startHost } = await import("../dist/server/server/start-host.js");

  await startHost({
    host,
    port,
    webUiDir: path.join(distRoot, "public"),
    webUiPort: port,
    databasePath: path.join(dataDir, "host.sqlite"),
    releaseManifestRoot: path.join(dataDir, "releases"),
    serverUpdatePackageName: "@jingyi0605/codingns",
    demoMode
  });
}

async function runAssistantCommand(argv) {
  const [group, action, ...rest] = argv;

  if (!group || group === "help" || group === "--help" || group === "-h") {
    const topic = buildAssistantHelpTopic(action, rest);
    printAssistantHelpTopic(topic, 0);
  }

  if (!action || action === "help" || action === "--help" || action === "-h") {
    printAssistantHelpTopic(group, 0);
  }

  if (rest.length > 0 && isHelpToken(rest[0])) {
    printAssistantHelpTopic(`${group}.${action}`, 0);
  }

  switch (`${group}:${action ?? ""}`) {
    case "capabilities:list":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/capabilities",
        argv: rest,
        helpTopic: "capabilities.list"
      }));
      return;
    case "projects:list":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/projects",
        argv: rest,
        supportedOptions: ["workspace-id", "status", "risk-level"],
        helpTopic: "projects.list"
      }, (options) => ({
        workspaceId: readOptionalTrimmedValue(options.values["workspace-id"]),
        status: readOptionalTrimmedValue(options.values.status),
        riskLevel: readOptionalTrimmedValue(options.values["risk-level"])
      })));
      return;
    case "projects:get": {
      const [projectId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/projects/${requirePositional(projectId, "projectId")}`,
        argv: tail,
        helpTopic: "projects.get"
      }));
      return;
    }
    case "sessions:list": {
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/projects/${requireOptionPositional(rest, "--project", "projectId")}/sessions`,
        argv: stripConsumedOption(rest, "--project"),
        supportedOptions: [],
        helpTopic: "sessions.list"
      }));
      return;
    }
    case "sessions:start": {
      const projectId = requireOptionPositional(rest, "--project", "projectId");
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/projects/${projectId}/sessions`,
        argv: stripConsumedOption(rest, "--project"),
        supportedOptions: ["message", "provider", "model", "reasoning-level", "permission-mode"],
        helpTopic: "sessions.start"
      }, (options) => ({
        content: requireOptionValue(options.values.message, "message"),
        providerId: readOptionalTrimmedValue(options.values.provider),
        model: readOptionalTrimmedValue(options.values.model),
        reasoningLevel: readOptionalTrimmedValue(options.values["reasoning-level"]),
        permissionMode: readOptionalTrimmedValue(options.values["permission-mode"])
      })));
      return;
    }
    case "sessions:get": {
      const [sessionId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/sessions/${requirePositional(sessionId, "sessionId")}`,
        argv: tail,
        helpTopic: "sessions.get"
      }));
      return;
    }
    case "sessions:messages": {
      const [sessionId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/sessions/${requirePositional(sessionId, "sessionId")}/messages`,
        argv: tail,
        supportedOptions: ["cursor", "limit", "direction"],
        helpTopic: "sessions.messages"
      }, (options) => ({
        cursor: readOptionalTrimmedValue(options.values.cursor),
        limit: readOptionalTrimmedValue(options.values.limit),
        direction: readOptionalTrimmedValue(options.values.direction)
      })));
      return;
    }
    case "sessions:runtime": {
      const [sessionId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/sessions/${requirePositional(sessionId, "sessionId")}/runtime`,
        argv: tail,
        helpTopic: "sessions.runtime"
      }));
      return;
    }
    case "sessions:send": {
      const [sessionId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/sessions/${requirePositional(sessionId, "sessionId")}/messages`,
        argv: tail,
        supportedOptions: ["message", "client-request-id", "model", "reasoning-level", "permission-mode"],
        helpTopic: "sessions.send"
      }, (options) => ({
        content: requireOptionValue(options.values.message, "message"),
        clientRequestId: readOptionalTrimmedValue(options.values["client-request-id"]),
        model: readOptionalTrimmedValue(options.values.model),
        reasoningLevel: readOptionalTrimmedValue(options.values["reasoning-level"]),
        permissionMode: readOptionalTrimmedValue(options.values["permission-mode"])
      })));
      return;
    }
    case "sessions:fork": {
      const [sessionId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/sessions/${requirePositional(sessionId, "sessionId")}/forks`,
        argv: tail,
        supportedOptions: ["source-type", "message-id", "strategy", "target-provider"],
        helpTopic: "sessions.fork"
      }, (options) => ({
        sourceType: readOptionalTrimmedValue(options.values["source-type"]),
        sourceMessageId: readOptionalTrimmedValue(options.values["message-id"]),
        strategy: readOptionalTrimmedValue(options.values.strategy),
        targetProvider: readOptionalTrimmedValue(options.values["target-provider"])
      })));
      return;
    }
    case "timers:list":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/timers",
        argv: rest,
        supportedOptions: ["status", "control-session-id"],
        helpTopic: "timers.list"
      }, (options) => ({
        status: readOptionalTrimmedValue(options.values.status),
        controlSessionId: readOptionalTrimmedValue(options.values["control-session-id"])
      })));
      return;
    case "timers:get": {
      const [timerId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/timers/${requirePositional(timerId, "timerId")}`,
        argv: tail,
        helpTopic: "timers.get"
      }));
      return;
    }
    case "timers:create":
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: "/api/assistant/timers",
        argv: rest,
        supportedOptions: [
          "message",
          "title",
          "due-at",
          "after-seconds",
          "control-session-id",
          "project-id",
          "session-id"
        ],
        helpTopic: "timers.create"
      }, (options) => ({
        content: requireOptionValue(options.values.message, "message"),
        title: readOptionalTrimmedValue(options.values.title),
        dueAt: readOptionalTrimmedValue(options.values["due-at"]),
        afterSeconds: readOptionalTrimmedValue(options.values["after-seconds"]),
        controlSessionId: readOptionalTrimmedValue(options.values["control-session-id"]),
        projectId: readOptionalTrimmedValue(options.values["project-id"]),
        targetSessionId: readOptionalTrimmedValue(options.values["session-id"])
      })));
      return;
    case "timers:cancel": {
      const [timerId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/timers/${requirePositional(timerId, "timerId")}/cancel`,
        argv: tail,
        helpTopic: "timers.cancel"
      }));
      return;
    }
    case "terminals:list":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/terminals",
        argv: rest,
        supportedOptions: ["workspace-id", "project-id"],
        helpTopic: "terminals.list"
      }, (options) => ({
        workspaceId: readOptionalTrimmedValue(options.values["workspace-id"]),
        projectId: readOptionalTrimmedValue(options.values["project-id"])
      })));
      return;
    case "terminals:history": {
      const [terminalId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/terminals/${requirePositional(terminalId, "terminalId")}/history`,
        argv: tail,
        supportedOptions: ["before-seq", "limit"],
        helpTopic: "terminals.history"
      }, (options) => ({
        beforeSeq: readOptionalTrimmedValue(options.values["before-seq"]),
        limit: readAssistantTerminalHistoryLimitOption(options.values.limit)
      })));
      return;
    }
    case "terminals:send": {
      const [terminalId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/terminals/${requirePositional(terminalId, "terminalId")}/input`,
        argv: tail,
        supportedOptions: ["input"],
        helpTopic: "terminals.send"
      }, (options) => ({
        content: requireOptionValue(options.values.input, "input")
      })));
      return;
    }
    case "terminals:close": {
      const [terminalId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "DELETE",
        path: `/api/assistant/terminals/${requirePositional(terminalId, "terminalId")}`,
        argv: tail,
        helpTopic: "terminals.close"
      }));
      return;
    }
    case "debug-targets:compatibility-matrix":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/debug-targets/compatibility-matrix",
        argv: rest,
        helpTopic: "debug-targets.compatibility-matrix"
      }));
      return;
    case "debug-targets:analyze":
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: "/api/assistant/debug-targets/analyze",
        argv: rest,
        supportedOptions: ["workspace-id", "root-path", "command-hint"],
        repeatableOptions: ["command-hint"],
        helpTopic: "debug-targets.analyze"
      }, (options) => ({
        workspaceId: requireOptionValue(options.values["workspace-id"], "workspace-id"),
        rootPath: requireOptionValue(options.values["root-path"], "root-path"),
        commandHints: readMultiOptionValues(options.values["command-hint"])
      })));
      return;
    case "debug-targets:framework-analysis": {
      const [targetId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/debug-targets/${requirePositional(targetId, "targetId")}/framework-analysis`,
        argv: tail,
        helpTopic: "debug-targets.framework-analysis"
      }));
      return;
    }
    case "debug-targets:refresh-framework-analysis": {
      const [targetId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/debug-targets/${requirePositional(targetId, "targetId")}/framework-analysis/refresh`,
        argv: tail,
        helpTopic: "debug-targets.refresh-framework-analysis"
      }));
      return;
    }
    case "debug-targets:launch-plan": {
      const [targetId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/debug-targets/${requirePositional(targetId, "targetId")}/launch-plan`,
        argv: tail,
        supportedOptions: ["port-request"],
        repeatableOptions: ["port-request"],
        helpTopic: "debug-targets.launch-plan"
      }, (options) => ({
        portRequests: parseDebugPortRequests(options.values["port-request"])
      })));
      return;
    }
    case "debug-targets:run": {
      const [targetId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/debug-targets/${requirePositional(targetId, "targetId")}/run`,
        argv: tail,
        supportedOptions: ["shell", "runtime-type", "port-request"],
        repeatableOptions: ["port-request"],
        helpTopic: "debug-targets.run"
      }, (options) => ({
        shell: readOptionalTrimmedValue(options.values.shell),
        runtimeType: readOptionalTrimmedValue(options.values["runtime-type"]),
        portRequests: parseDebugPortRequests(options.values["port-request"])
      })));
      return;
    }
    case "debug-targets:runtime-latest": {
      const [targetId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/debug-targets/${requirePositional(targetId, "targetId")}/runtime-latest`,
        argv: tail,
        helpTopic: "debug-targets.runtime-latest"
      }));
      return;
    }
    case "debug-targets:runtimes": {
      const [targetId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/debug-targets/${requirePositional(targetId, "targetId")}/runtimes`,
        argv: tail,
        supportedOptions: ["limit"],
        helpTopic: "debug-targets.runtimes"
      }, (options) => ({
        limit: readOptionalTrimmedValue(options.values.limit)
      })));
      return;
    }
    case "debug-runtimes:get": {
      const [runtimeId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/debug-runtimes/${requirePositional(runtimeId, "runtimeId")}`,
        argv: tail,
        helpTopic: "debug-runtimes.get"
      }));
      return;
    }
    case "workspaces:list":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/workspaces",
        argv: rest,
        helpTopic: "workspaces.list"
      }));
      return;
    case "workspaces:browse":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/workspaces/browse",
        argv: rest,
        supportedOptions: ["path"],
        helpTopic: "workspaces.browse"
      }, (options) => ({
        path: readOptionalTrimmedValue(options.values.path)
      })));
      return;
    case "workspaces:mkdir":
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: "/api/assistant/workspaces/directories",
        argv: rest,
        supportedOptions: ["parent-path", "directory-name"],
        helpTopic: "workspaces.mkdir"
      }, (options) => ({
        parentPath: requireOptionValue(options.values["parent-path"], "parent-path"),
        directoryName: requireOptionValue(options.values["directory-name"], "directory-name")
      })));
      return;
    case "workspaces:import":
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: "/api/assistant/workspaces/import",
        argv: rest,
        supportedOptions: ["path", "name"],
        helpTopic: "workspaces.import"
      }, (options) => ({
        path: requireOptionValue(options.values.path, "path"),
        name: readOptionalTrimmedValue(options.values.name)
      })));
      return;
    case "workspaces:clone":
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: "/api/assistant/workspaces/clone",
        argv: rest,
        supportedOptions: [
          "repository-url",
          "parent-path",
          "directory-name",
          "name",
          "auth-mode",
          "username",
          "password",
          "auth-token"
        ],
        helpTopic: "workspaces.clone"
      }, (options) => ({
        repositoryUrl: requireOptionValue(options.values["repository-url"], "repository-url"),
        parentPath: requireOptionValue(options.values["parent-path"], "parent-path"),
        directoryName: readOptionalTrimmedValue(options.values["directory-name"]),
        name: readOptionalTrimmedValue(options.values.name),
        auth: buildWorkspaceCloneAuth(options.values)
      })));
      return;
    case "workspaces:reorder":
      await printAssistantResponse(await requestAssistant({
        method: "PUT",
        path: "/api/assistant/workspaces/reorder",
        argv: rest,
        supportedOptions: ["workspace-id"],
        repeatableOptions: ["workspace-id"],
        helpTopic: "workspaces.reorder"
      }, (options) => ({
        workspaceIds: requireMultiOptionValues(options.values["workspace-id"], "workspace-id")
      })));
      return;
    case "workspaces:management": {
      const [workspaceId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: `/api/assistant/workspaces/${requirePositional(workspaceId, "workspaceId")}/management`,
        argv: tail,
        helpTopic: "workspaces.management"
      }));
      return;
    }
    case "workspaces:nav-state": {
      const [workspaceId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "PUT",
        path: `/api/assistant/workspaces/${requirePositional(workspaceId, "workspaceId")}/navigation-state`,
        argv: tail,
        supportedOptions: ["collapsed", "background-color"],
        helpTopic: "workspaces.nav-state"
      }, (options) => {
        const payload = {};
        const collapsed = readOptionalTrimmedValue(options.values.collapsed);
        const backgroundColor = readOptionalTrimmedValue(options.values["background-color"]);

        if (collapsed !== null) {
          payload.collapsed = parseBooleanOption(collapsed, "collapsed");
        }

        if (backgroundColor !== null) {
          payload.backgroundColor = normalizeBackgroundColorOption(backgroundColor);
        }

        return payload;
      }));
      return;
    }
    case "workspaces:remove": {
      const [workspaceId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "DELETE",
        path: `/api/assistant/workspaces/${requirePositional(workspaceId, "workspaceId")}`,
        argv: tail,
        helpTopic: "workspaces.remove"
      }));
      return;
    }
    case "worktrees:tree":
      await printAssistantResponse(await requestAssistant({
        method: "GET",
        path: "/api/assistant/worktrees/tree",
        argv: rest,
        supportedOptions: ["root-workspace-id"],
        helpTopic: "worktrees.tree"
      }, (options) => ({
        rootWorkspaceId: requireOptionValue(options.values["root-workspace-id"], "root-workspace-id")
      })));
      return;
    case "worktrees:create":
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: "/api/assistant/worktrees",
        argv: rest,
        supportedOptions: ["source-workspace-id", "branch-name", "display-name", "base-ref"],
        helpTopic: "worktrees.create"
      }, (options) => ({
        sourceWorkspaceId: requireOptionValue(options.values["source-workspace-id"], "source-workspace-id"),
        branchName: requireOptionValue(options.values["branch-name"], "branch-name"),
        displayName: readOptionalTrimmedValue(options.values["display-name"]),
        baseRef: readOptionalTrimmedValue(options.values["base-ref"])
      })));
      return;
    case "worktrees:merge-preview": {
      const [workspaceId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/worktrees/${requirePositional(workspaceId, "workspaceId")}/merge-preview`,
        argv: tail,
        helpTopic: "worktrees.merge-preview"
      }));
      return;
    }
    case "worktrees:merge": {
      const [workspaceId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/worktrees/${requirePositional(workspaceId, "workspaceId")}/merge-into-parent`,
        argv: tail,
        helpTopic: "worktrees.merge"
      }));
      return;
    }
    case "worktrees:cleanup": {
      const [workspaceId, ...tail] = rest;
      await printAssistantResponse(await requestAssistant({
        method: "POST",
        path: `/api/assistant/worktrees/${requirePositional(workspaceId, "workspaceId")}/cleanup`,
        argv: tail,
        supportedFlags: ["delete-branch"],
        helpTopic: "worktrees.cleanup"
      }, (options) => ({
        deleteBranch: options.flags["delete-branch"] === true
      })));
      return;
    }
    default:
      console.error(`[codingns] 不支持的 assistant 子命令：${group}${action ? ` ${action}` : ""}`);
      printAssistantHelpTopic("assistant", 1);
  }
}

async function runSkillsCommand(argv) {
  const [action, ...rest] = argv;

  if (!action || action === "help" || action === "--help" || action === "-h") {
    printSkillsHelpTopic(buildSkillsHelpTopic(rest[0]), 0);
  }

  if (rest.length > 0 && isHelpToken(rest[0])) {
    printSkillsHelpTopic(buildSkillsHelpTopic(action), 0);
  }

  switch (action) {
    case "overview":
      await printAssistantResponse(await requestSkills({
        method: "GET",
        path: "/api/skills/overview",
        argv: rest,
        supportedOptions: ["target"],
        repeatableOptions: ["target"],
        helpTopic: "skills.overview"
      }, (options) => {
        const targets = readMultiOptionValues(options.values.target);

        return targets.length > 0
          ? { targetCli: targets.join(",") }
          : null;
      }));
      return;
    case "add":
      await printAssistantResponse(await requestSkills({
        method: "POST",
        path: "/api/skills",
        argv: rest,
        supportedOptions: ["source", "target", "source-type"],
        repeatableOptions: ["target"],
        helpTopic: "skills.add"
      }, (options) => ({
        sourcePath: requireOptionValue(options.values.source, "source"),
        targetCli: requireMultiOptionValues(options.values.target, "target"),
        sourceType: readOptionalTrimmedValue(options.values["source-type"]) ?? "local-import"
      })));
      return;
    case "import":
      await printAssistantResponse(await requestSkills({
        method: "POST",
        path: "/api/skills/import",
        argv: rest,
        supportedOptions: ["cli", "path", "expected-hash", "target"],
        repeatableOptions: ["target"],
        helpTopic: "skills.import"
      }, (options) => ({
        targetCli: requireOptionValue(options.values.cli, "cli"),
        directoryPath: requireOptionValue(options.values.path, "path"),
        expectedContentHash: readOptionalTrimmedValue(options.values["expected-hash"]),
        additionalTargetCli: readMultiOptionValues(options.values.target)
      })));
      return;
    case "sync": {
      const [skillId, ...tail] = rest;
      await printAssistantResponse(await requestSkills({
        method: "POST",
        path: "/api/skills/sync",
        argv: tail,
        supportedOptions: ["target"],
        repeatableOptions: ["target"],
        helpTopic: "skills.sync"
      }, (options) => ({
        skillId: requirePositional(skillId, "skillId"),
        targetCli: requireMultiOptionValues(options.values.target, "target")
      })));
      return;
    }
    default:
      console.error(`[codingns] 不支持的 skills 子命令：${action}`);
      printSkillsHelpTopic("skills", 1);
  }
}

async function requestAssistant(command, buildPayload) {
  const options = parseArgs(command.argv, {
    supportedOptions: [
      "base-url",
      "token",
      ...(command.supportedOptions ?? [])
    ],
    repeatableOptions: command.repeatableOptions ?? [],
    supportedFlags: command.supportedFlags ?? []
  });

  if (options.help) {
    printAssistantHelpTopic(command.helpTopic ?? "assistant", 0);
  }

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      console.error(`[codingns] ${error}`);
    }
    printAssistantHelpTopic(command.helpTopic ?? "assistant", 1);
  }

  const baseUrl = resolveAssistantBaseUrl(options.values["base-url"]);
  const accessToken = resolveAssistantAccessToken(options.values.token);
  const url = new URL(command.path, appendTrailingSlash(baseUrl));
  const payload = buildPayload ? buildPayload(options) : null;

  if (command.method === "GET" && payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }

  let response;

  try {
    const usesJsonBody = command.method === "POST" || command.method === "PUT";
    response = await fetch(url, {
      method: command.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(usesJsonBody ? { "Content-Type": "application/json" } : {})
      },
      body: usesJsonBody ? JSON.stringify(payload ?? {}) : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    console.error(JSON.stringify({
      ok: false,
      detail: `助手能力请求失败：${message}`,
      target: url.toString()
    }, null, 2));
    process.exit(1);
  }

  const rawBody = await response.text();
  const responseBody = tryParseJson(rawBody);

  if (!response.ok) {
    const detail = typeof responseBody?.detail === "string"
      ? responseBody.detail
      : `HTTP ${response.status}`;
    console.error(JSON.stringify({
      ok: false,
      status: response.status,
      detail,
      body: responseBody ?? rawBody
    }, null, 2));
    process.exit(1);
  }

  return responseBody ?? rawBody;
}

async function requestSkills(command, buildPayload) {
  const options = parseArgs(command.argv, {
    supportedOptions: [
      "base-url",
      "token",
      ...(command.supportedOptions ?? [])
    ],
    repeatableOptions: command.repeatableOptions ?? []
  });

  if (options.help) {
    printSkillsHelpTopic(command.helpTopic ?? "skills", 0);
  }

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      console.error(`[codingns] ${error}`);
    }
    printSkillsHelpTopic(command.helpTopic ?? "skills", 1);
  }

  const baseUrl = resolveAssistantBaseUrl(options.values["base-url"]);
  const accessToken = resolveAssistantAccessToken(options.values.token);
  const url = new URL(command.path, appendTrailingSlash(baseUrl));
  const payload = buildPayload ? buildPayload(options) : null;

  if (command.method === "GET" && payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }

  let response;

  try {
    response = await fetch(url, {
      method: command.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(command.method === "POST" ? { "Content-Type": "application/json" } : {})
      },
      body: command.method === "POST" ? JSON.stringify(payload ?? {}) : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    console.error(JSON.stringify({
      ok: false,
      detail: `Skill 管理请求失败：${message}`,
      target: url.toString()
    }, null, 2));
    process.exit(1);
  }

  const rawBody = await response.text();
  const responseBody = tryParseJson(rawBody);

  if (!response.ok) {
    const detail = typeof responseBody?.detail === "string"
      ? responseBody.detail
      : `HTTP ${response.status}`;
    console.error(JSON.stringify({
      ok: false,
      status: response.status,
      detail,
      body: responseBody ?? rawBody
    }, null, 2));
    process.exit(1);
  }

  return responseBody ?? rawBody;
}

async function printAssistantResponse(payload) {
  if (typeof payload === "string") {
    console.log(payload);
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

function parseArgs(argv, input = {}) {
  const values = {};
  const flags = {};
  const errors = [];
  const supportedOptions = new Set(input.supportedOptions ?? []);
  const supportedFlags = new Set(input.supportedFlags ?? []);
  const repeatableOptions = new Set(input.repeatableOptions ?? []);
  let index = 0;

  while (index < argv.length) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      return {
        help: true,
        values,
        flags,
        errors
      };
    }

    if (!token.startsWith("--")) {
      errors.push(`无效参数：${token}`);
      index += 1;
      continue;
    }

    const [rawName, inlineValue] = token.slice(2).split("=", 2);

    if (!rawName) {
      errors.push(`无效参数：${token}`);
      index += 1;
      continue;
    }

    // 布尔标志（不需要值）
    if (supportedFlags.has(rawName)) {
      flags[rawName] = true;
      index += 1;
      continue;
    }

    if (!supportedOptions.has(rawName)) {
      errors.push(`不支持的参数：${token}`);
      index += 1;
      continue;
    }

    if (inlineValue !== undefined) {
      if (repeatableOptions.has(rawName)) {
        const current = values[rawName];
        values[rawName] = Array.isArray(current) ? [...current, inlineValue] : current ? [current, inlineValue] : [inlineValue];
      } else {
        values[rawName] = inlineValue;
      }
      index += 1;
      continue;
    }

    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      errors.push(`参数 ${token} 缺少取值`);
      index += 1;
      continue;
    }

    if (repeatableOptions.has(rawName)) {
      const current = values[rawName];
      values[rawName] = Array.isArray(current) ? [...current, nextValue] : current ? [current, nextValue] : [nextValue];
    } else {
      values[rawName] = nextValue;
    }
    index += 2;
  }

  return {
    help: false,
    values,
    flags,
    errors
  };
}

function resolveAssistantBaseUrl(input) {
  const configuredBaseUrl = readStringOption(
    input,
    process.env.CODINGNS_BASE_URL,
    process.env.CODINGNS_SERVER_BASE_URL
  );
  const baseUrl = readStringOption(
    configuredBaseUrl,
    configuredBaseUrl ? "" : readAssistantCredentialField("apiBaseUrl"),
    "http://127.0.0.1:3002"
  );

  try {
    return new URL(baseUrl).toString();
  } catch {
    fail(`助手调用 baseUrl 非法：${baseUrl}`);
  }
}

function resolveAssistantAccessToken(input) {
  const configuredAccessToken = readStringOption(
    input,
    process.env.CODINGNS_ACCESS_TOKEN,
    process.env.CODINGNS_TOKEN
  );
  const accessToken = readStringOption(
    configuredAccessToken,
    configuredAccessToken ? "" : readAssistantCredentialField("accessToken")
  );

  if (!accessToken) {
    fail(
      "缺少助手调用 access token，请传 --token、设置 CODINGNS_ACCESS_TOKEN，或在当前目录/上级目录提供 BUTLER_AUTH.json（也可用 CODINGNS_AUTH_FILE 指定）"
    );
  }

  return accessToken;
}

var cachedAssistantCredential;

function readAssistantCredentialField(field) {
  const credential = readAssistantCredential();

  if (!credential) {
    return "";
  }

  const value = credential[field];
  return typeof value === "string" ? value : "";
}

function readAssistantCredential() {
  if (cachedAssistantCredential !== undefined) {
    return cachedAssistantCredential;
  }

  const credentialFilePath = resolveAssistantCredentialFilePath();

  if (!credentialFilePath) {
    cachedAssistantCredential = null;
    return cachedAssistantCredential;
  }

  let rawContent;

  try {
    rawContent = fs.readFileSync(credentialFilePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    fail(`读取助手认证文件失败：${credentialFilePath}（${message}）`);
  }

  let parsed;

  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    fail(`助手认证文件不是合法 JSON：${credentialFilePath}（${message}）`);
  }

  cachedAssistantCredential = {
    filePath: credentialFilePath,
    accessToken: typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "",
    apiBaseUrl: typeof parsed?.apiBaseUrl === "string" ? parsed.apiBaseUrl.trim() : ""
  };
  return cachedAssistantCredential;
}

function resolveAssistantCredentialFilePath() {
  const configuredPath = readStringOption(
    process.env.CODINGNS_AUTH_FILE,
    process.env.BUTLER_AUTH_FILE
  );

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  return findFileUpward(process.cwd(), "BUTLER_AUTH.json");
}

function findFileUpward(startPath, fileName) {
  let currentPath = path.resolve(startPath);

  while (true) {
    const candidatePath = path.join(currentPath, fileName);

    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      return candidatePath;
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

function readStringOption(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function readOptionalTrimmedValue(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function readAssistantTerminalHistoryLimitOption(value) {
  const normalized = readOptionalTrimmedValue(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return normalized;
  }

  if (parsed <= 100) {
    return normalized;
  }

  console.warn("[codingns] assistant terminals history 的 --limit 最大为 100，已自动收敛到 100。");
  return "100";
}

function readMultiOptionValues(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function requireOptionValue(value, field) {
  const normalized = readOptionalTrimmedValue(value);

  if (!normalized) {
    fail(`参数 --${field} 不能为空`);
  }

  return normalized;
}

function requireMultiOptionValues(value, field) {
  const normalized = readMultiOptionValues(value);

  if (normalized.length === 0) {
    fail(`参数 --${field} 不能为空`);
  }

  return normalized;
}

function requirePositional(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    fail(`缺少位置参数：${field}`);
  }

  return normalized;
}

function requireOptionPositional(argv, optionName, field) {
  const index = argv.findIndex((token) => token === optionName || token.startsWith(`${optionName}=`));

  if (index < 0) {
    fail(`缺少必要参数：${optionName}`);
  }

  const token = argv[index];

  if (token.includes("=")) {
    return requirePositional(token.split("=", 2)[1], field);
  }

  return requirePositional(argv[index + 1], field);
}

function stripConsumedOption(argv, optionName) {
  const index = argv.findIndex((token) => token === optionName || token.startsWith(`${optionName}=`));

  if (index < 0) {
    return argv;
  }

  const token = argv[index];

  if (token.includes("=")) {
    return argv.filter((_, currentIndex) => currentIndex !== index);
  }

  return argv.filter((_, currentIndex) => currentIndex !== index && currentIndex !== index + 1);
}

function appendTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function tryParseJson(input) {
  if (!input) {
    return null;
  }

  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function parsePort(input) {
  const port = Number.parseInt(input, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`端口非法：${input}，允许范围为 1-65535`);
  }

  return port;
}

function resolveDataDir(input) {
  const normalized = input.trim();

  if (!normalized) {
    fail("数据目录不能为空");
  }

  if (normalized === "~") {
    return os.homedir();
  }

  if (normalized.startsWith(`~${path.sep}`) || normalized.startsWith("~/")) {
    return path.join(os.homedir(), normalized.slice(2));
  }

  return path.resolve(process.cwd(), normalized);
}

function printHelp(exitCode) {
  const output = `
codingns 用法：

  codingns start [--host 0.0.0.0] [--port 3002] [--data-dir ~/.codingns] [--demo]
  codingns assistant <group> <action> [options]
  codingns skills <action> [options]

说明：

  --host      服务监听地址，默认 0.0.0.0
  --port      服务监听端口，默认 3002
  --data-dir  数据目录，默认 ~/.codingns
  --demo      以演示模式启动（自动创建 demo 账户、15 分钟会话超时、开放 CORS）
  --help      显示帮助

assistant 例子：

  codingns assistant capabilities list --token <token>
  codingns assistant projects list --status active --token <token>
  codingns assistant workspaces list --token <token>
  codingns assistant debug-targets analyze --workspace-id <id> --root-path <path> --token <token>
  codingns assistant debug-targets launch-plan <targetId> --port-request role=backend,cwd=apps/api,port=44001 --token <token>
  codingns assistant worktrees tree --root-workspace-id <id> --token <token>
  codingns assistant sessions send <sessionId> --message "继续修复类型错误" --token <token>
  codingns assistant terminals send <terminalId> --input "npm test\\n" --token <token>
  codingns assistant terminals close <terminalId> --token <token>

skills 例子：

  codingns skills overview --token <token>
  codingns skills add --source ./my-skill --target codex --token <token>
  codingns skills sync <skillId> --target gemini --token <token>
`.trim();

  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }

  process.exit(exitCode);
}

function printAssistantHelpTopic(topic, exitCode) {
  const output = getAssistantHelpText(topic);

  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }

  process.exit(exitCode);
}

function printSkillsHelpTopic(topic, exitCode) {
  const output = getSkillsHelpText(topic);

  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }

  process.exit(exitCode);
}

function getAssistantHelpText(topic) {
  switch (topic) {
    case "capabilities":
    case "capabilities.list":
      return `
codingns assistant capabilities

用途：
  查看当前 Host 开放了哪些助手能力，以及版本和限制。

用法：
  codingns assistant capabilities list [--base-url http://127.0.0.1:3002] --token <token>
`.trim();
    case "projects":
      return `
codingns assistant projects

可用动作：
  list    列出托管项目
  get     读取单个项目详情

示例：
  codingns assistant projects list --status active --token <token>
  codingns assistant projects get <projectId> --token <token>
`.trim();
    case "projects.list":
      return `
codingns assistant projects list

用途：
  按工作区、生命周期、风险等级筛选托管项目。

用法：
  codingns assistant projects list [--workspace-id <id>] [--status active|paused|archived] [--risk-level low|medium|high] --token <token>
`.trim();
    case "projects.get":
      return `
codingns assistant projects get

用途：
  读取项目详情、概况，以及该项目下可操作会话。

用法：
  codingns assistant projects get <projectId> --token <token>
`.trim();
    case "workspaces":
      return `
codingns assistant workspaces

可用动作：
  list        列出当前工作区
  browse      浏览可导入目录
  mkdir       创建目录
  import      导入工作区
  clone       克隆并导入工作区
  reorder     调整工作区顺序
  management  读取工作区管理摘要
  nav-state   更新导航状态
  remove      移除工作区

示例：
  codingns assistant workspaces list --token <token>
  codingns assistant workspaces import --path /repo/demo --token <token>
`.trim();
    case "workspaces.list":
      return `
codingns assistant workspaces list

用途：
  列出当前可见工作区。

用法：
  codingns assistant workspaces list --token <token>
`.trim();
    case "workspaces.browse":
      return `
codingns assistant workspaces browse

用途：
  浏览本地目录，给导入或 clone 选目标位置。

用法：
  codingns assistant workspaces browse [--path <path>] --token <token>
`.trim();
    case "workspaces.mkdir":
      return `
codingns assistant workspaces mkdir

用途：
  在指定父目录下创建新目录。

用法：
  codingns assistant workspaces mkdir --parent-path <path> --directory-name <name> --token <token>
`.trim();
    case "workspaces.import":
      return `
codingns assistant workspaces import

用途：
  把已有目录导入成工作区。

用法：
  codingns assistant workspaces import --path <path> [--name <name>] --token <token>
`.trim();
    case "workspaces.clone":
      return `
codingns assistant workspaces clone

用途：
  克隆 Git 仓库并导入成工作区。

用法：
  codingns assistant workspaces clone --repository-url <url> --parent-path <path> [--directory-name <name>] [--name <name>] [--auth-mode none|basic|token] [--username <name>] [--password <password>] [--auth-token <token>] --token <token>
`.trim();
    case "workspaces.reorder":
      return `
codingns assistant workspaces reorder

用途：
  调整工作区显示顺序，必须提交当前全部可见工作区。

用法：
  codingns assistant workspaces reorder --workspace-id <id> [--workspace-id <id>] --token <token>
`.trim();
    case "workspaces.management":
      return `
codingns assistant workspaces management

用途：
  读取工作区 Git 和代码构成摘要。

用法：
  codingns assistant workspaces management <workspaceId> --token <token>
`.trim();
    case "workspaces.nav-state":
      return `
codingns assistant workspaces nav-state

用途：
  更新工作区导航状态，比如折叠状态和背景色。

用法：
  codingns assistant workspaces nav-state <workspaceId> [--collapsed true|false] [--background-color #RRGGBB|none] --token <token>
`.trim();
    case "workspaces.remove":
      return `
codingns assistant workspaces remove

用途：
  移除工作区入口，不直接删除磁盘目录。

用法：
  codingns assistant workspaces remove <workspaceId> --token <token>
`.trim();
    case "sessions":
      return `
codingns assistant sessions

可用动作：
  list      列出指定项目下的会话
  start     按当前助手配置新建项目会话
  get       读取会话详情
  messages  读取消息窗口
  runtime   读取运行态
  send      向真实项目会话发送消息
  fork      从会话或消息点 fork 新会话

示例：
  codingns assistant sessions list --project <projectId> --token <token>
  codingns assistant sessions start --project <projectId> --message "继续处理这个问题" --token <token>
  codingns assistant sessions send <sessionId> --message "继续修复" --token <token>
`.trim();
    case "sessions.list":
      return `
codingns assistant sessions list

用途：
  列出指定项目下当前可操作的真实会话。

用法：
  codingns assistant sessions list --project <projectId> --token <token>
`.trim();
    case "sessions.start":
      return `
codingns assistant sessions start

用途：
  在指定项目下新建真实会话；如果不显式传 provider/model，会默认继承当前助手控制会话的配置。

用法：
  codingns assistant sessions start --project <projectId> --message "..." [--provider <provider>] [--model <model>] [--reasoning-level <level>] [--permission-mode <mode>] --token <token>
`.trim();
    case "sessions.get":
      return `
codingns assistant sessions get

用途：
  读取会话详情，包括当前状态和可继续操作的引用。

用法：
  codingns assistant sessions get <sessionId> --token <token>
`.trim();
    case "sessions.messages":
      return `
codingns assistant sessions messages

用途：
  分页读取某个会话的消息窗口。

用法：
  codingns assistant sessions messages <sessionId> [--cursor <cursor>] [--limit 40] [--direction forward|backward] --token <token>
`.trim();
    case "sessions.runtime":
      return `
codingns assistant sessions runtime

用途：
  读取会话当前运行态，用来判断能否继续发送或是否还在执行。

用法：
  codingns assistant sessions runtime <sessionId> --token <token>
`.trim();
    case "sessions.send":
      return `
codingns assistant sessions send

用途：
  向真实项目会话发送消息，推进开发，但不直接改本地代码。

用法：
  codingns assistant sessions send <sessionId> --message "..." [--client-request-id <id>] [--model <model>] [--reasoning-level <level>] [--permission-mode <mode>] --token <token>
`.trim();
    case "sessions.fork":
      return `
codingns assistant sessions fork

用途：
  从现有会话或消息点 fork 一个新分支会话。

用法：
  codingns assistant sessions fork <sessionId> [--source-type session|message] [--message-id <id>] [--strategy auto|native-only|reconstruct-only] [--target-provider <provider>] --token <token>
`.trim();
    case "timers":
      return `
codingns assistant timers

可用动作：
  list    列出当前助手会话相关的计时器
  get     读取单个计时器详情
  create  创建到点后继续助手会话的计时器
  cancel  取消计时器

示例：
  codingns assistant timers create --after-seconds 300 --message "5 分钟后检查真实会话最新回复" --session-id <sessionId> --project-id <projectId> --token <token>
  codingns assistant timers list --status active --token <token>
`.trim();
    case "timers.list":
      return `
codingns assistant timers list

用途：
  查看当前助手会话下仍在等待、已完成或已失败的计时器。

用法：
  codingns assistant timers list [--status active|completed|cancelled|failed] [--control-session-id <id>] --token <token>
`.trim();
    case "timers.get":
      return `
codingns assistant timers get

用途：
  读取单个计时器详情，包括计划触发时间和最后错误。

用法：
  codingns assistant timers get <timerId> --token <token>
`.trim();
    case "timers.create":
      return `
codingns assistant timers create

用途：
  创建一个一次性计时器；到期后系统会自动向同一个助手控制会话发送消息，继续工作。

用法：
  codingns assistant timers create --message "..." [--title <title>] [--due-at <isoTime> | --after-seconds <seconds>] [--control-session-id <id>] [--project-id <projectId>] [--session-id <sessionId>] --token <token>
`.trim();
    case "timers.cancel":
      return `
codingns assistant timers cancel

用途：
  取消一个尚未触发的计时器。

用法：
  codingns assistant timers cancel <timerId> --token <token>
`.trim();
    case "terminals":
      return `
codingns assistant terminals

可用动作：
  list     列出项目或工作区下的终端
  history  读取终端历史输出
  send     向受控终端发送输入
  close    关闭受控终端

示例：
  codingns assistant terminals list --project-id <projectId> --token <token>
  codingns assistant terminals send <terminalId> --input "npm test\\n" --token <token>
`.trim();
    case "terminals.list":
      return `
codingns assistant terminals list

用途：
  列出指定项目或工作区下的受控终端。

用法：
  codingns assistant terminals list [--workspace-id <id> | --project-id <id>] --token <token>
`.trim();
    case "terminals.history":
      return `
codingns assistant terminals history

用途：
  分页读取终端历史输出。

用法：
  codingns assistant terminals history <terminalId> [--before-seq <n>] [--limit 20] --token <token>
`.trim();
    case "terminals.send":
      return `
codingns assistant terminals send

用途：
  向受控终端发送输入，比如测试命令或构建命令。

用法：
  codingns assistant terminals send <terminalId> --input "npm test\\n" --token <token>
`.trim();
    case "terminals.close":
      return `
codingns assistant terminals close

用途：
  关闭指定受控终端，常用于停止调试进程或回收运行资源。

用法：
  codingns assistant terminals close <terminalId> --token <token>
`.trim();
    case "debug-targets":
      return `
codingns assistant debug-targets

可用动作：
  compatibility-matrix       读取框架兼容矩阵
  analyze                    分析工作区调试目标
  framework-analysis         读取框架分析结果
  refresh-framework-analysis 刷新框架分析结果
  launch-plan                生成启动计划，可显式请求端口
  run                        启动调试目标，可显式请求端口
  runtime-latest             读取最近一次运行态
  runtimes                   读取运行历史

示例：
  codingns assistant debug-targets analyze --workspace-id <id> --root-path /repo/demo --token <token>
  codingns assistant debug-targets launch-plan <targetId> --port-request role=backend,cwd=apps/api,port=44001 --token <token>
`.trim();
    case "debug-targets.compatibility-matrix":
      return `
codingns assistant debug-targets compatibility-matrix

用途：
  读取平台当前支持的框架兼容矩阵和建议注入方式。

用法：
  codingns assistant debug-targets compatibility-matrix --token <token>
`.trim();
    case "debug-targets.analyze":
      return `
codingns assistant debug-targets analyze

用途：
  分析指定工作区下的调试目标、服务和框架兼容性。

用法：
  codingns assistant debug-targets analyze --workspace-id <id> --root-path <path> [--command-hint "pnpm dev"] [--command-hint "node server.js"] --token <token>
`.trim();
    case "debug-targets.framework-analysis":
      return `
codingns assistant debug-targets framework-analysis

用途：
  读取指定调试目标当前的框架分析结果。

用法：
  codingns assistant debug-targets framework-analysis <targetId> --token <token>
`.trim();
    case "debug-targets.refresh-framework-analysis":
      return `
codingns assistant debug-targets refresh-framework-analysis

用途：
  刷新指定调试目标的框架分析结果。

用法：
  codingns assistant debug-targets refresh-framework-analysis <targetId> --token <token>
`.trim();
    case "debug-targets.launch-plan":
      return `
codingns assistant debug-targets launch-plan

用途：
  生成调试目标启动计划，可通过重复的 --port-request 显式请求服务端口。

用法：
  codingns assistant debug-targets launch-plan <targetId> [--port-request role=frontend,cwd=apps/web,port=43001] [--port-request role=backend,cwd=apps/api,port=44001] --token <token>
`.trim();
    case "debug-targets.run":
      return `
codingns assistant debug-targets run

用途：
  启动调试目标，可选指定 shell、runtimeType 和显式端口请求。

用法：
  codingns assistant debug-targets run <targetId> [--shell zsh] [--runtime-type tmux|embedded-pty|conpty-powershell|conpty-cmd|conpty-git-bash] [--port-request role=backend,cwd=apps/api,port=44001] --token <token>
`.trim();
    case "debug-targets.runtime-latest":
      return `
codingns assistant debug-targets runtime-latest

用途：
  读取指定调试目标最近一次运行态，没有运行记录时返回 null。

用法：
  codingns assistant debug-targets runtime-latest <targetId> --token <token>
`.trim();
    case "debug-targets.runtimes":
      return `
codingns assistant debug-targets runtimes

用途：
  读取指定调试目标最近几次运行历史。

用法：
  codingns assistant debug-targets runtimes <targetId> [--limit 5] --token <token>
`.trim();
    case "debug-runtimes":
      return `
codingns assistant debug-runtimes

可用动作：
  get  读取单个调试运行时详情

示例：
  codingns assistant debug-runtimes get <runtimeId> --token <token>
`.trim();
    case "debug-runtimes.get":
      return `
codingns assistant debug-runtimes get

用途：
  读取指定调试运行时详情，包括服务、绑定、租约和终端实例。

用法：
  codingns assistant debug-runtimes get <runtimeId> --token <token>
`.trim();
    case "worktrees":
      return `
codingns assistant worktrees

可用动作：
  tree           读取工作树结构
  create         创建子工作树
  merge-preview  读取合并预览
  merge          合并回父工作区
  cleanup        清理子工作树

示例：
  codingns assistant worktrees tree --root-workspace-id <id> --token <token>
  codingns assistant worktrees create --source-workspace-id <id> --branch-name feature/demo --token <token>
`.trim();
    case "worktrees.tree":
      return `
codingns assistant worktrees tree

用途：
  读取某个根工作区下面的工作树结构。

用法：
  codingns assistant worktrees tree --root-workspace-id <id> --token <token>
`.trim();
    case "worktrees.create":
      return `
codingns assistant worktrees create

用途：
  从指定工作区创建新的子工作树。

用法：
  codingns assistant worktrees create --source-workspace-id <id> --branch-name <name> [--display-name <name>] [--base-ref <ref>] --token <token>
`.trim();
    case "worktrees.merge-preview":
      return `
codingns assistant worktrees merge-preview

用途：
  查看子工作树合并回父工作区前的阻塞项和预览。

用法：
  codingns assistant worktrees merge-preview <workspaceId> --token <token>
`.trim();
    case "worktrees.merge":
      return `
codingns assistant worktrees merge

用途：
  把子工作树合并回父工作区。

用法：
  codingns assistant worktrees merge <workspaceId> --token <token>
`.trim();
    case "worktrees.cleanup":
      return `
codingns assistant worktrees cleanup

用途：
  清理已经完成的子工作树，可选同时删除分支。

用法：
  codingns assistant worktrees cleanup <workspaceId> [--delete-branch] --token <token>
`.trim();
    default:
      return `
codingns assistant 用法：

  codingns assistant help [capabilities|projects|sessions|timers|terminals|debug-targets|debug-runtimes|workspaces|worktrees] [action]
  codingns assistant capabilities list [--base-url http://127.0.0.1:3002] --token <token>
  codingns assistant projects list [--workspace-id <id>] [--status active|paused|archived] [--risk-level low|medium|high] --token <token>
  codingns assistant projects get <projectId> [--base-url ...] --token <token>
  codingns assistant debug-targets compatibility-matrix [--base-url ...] --token <token>
  codingns assistant debug-targets analyze --workspace-id <id> --root-path <path> [--command-hint <command>] [--command-hint <command>] [--base-url ...] --token <token>
  codingns assistant debug-targets framework-analysis <targetId> [--base-url ...] --token <token>
  codingns assistant debug-targets refresh-framework-analysis <targetId> [--base-url ...] --token <token>
  codingns assistant debug-targets launch-plan <targetId> [--port-request role=backend,cwd=apps/api,port=44001] [--base-url ...] --token <token>
  codingns assistant debug-targets run <targetId> [--shell zsh] [--runtime-type tmux|embedded-pty|conpty-powershell|conpty-cmd|conpty-git-bash] [--port-request role=backend,cwd=apps/api,port=44001] [--base-url ...] --token <token>
  codingns assistant debug-targets runtime-latest <targetId> [--base-url ...] --token <token>
  codingns assistant debug-targets runtimes <targetId> [--limit 5] [--base-url ...] --token <token>
  codingns assistant debug-runtimes get <runtimeId> [--base-url ...] --token <token>
  codingns assistant workspaces list [--base-url ...] --token <token>
  codingns assistant workspaces browse [--path <path>] [--base-url ...] --token <token>
  codingns assistant workspaces mkdir --parent-path <path> --directory-name <name> [--base-url ...] --token <token>
  codingns assistant workspaces import --path <path> [--name <name>] [--base-url ...] --token <token>
  codingns assistant workspaces clone --repository-url <url> --parent-path <path> [--directory-name <name>] [--name <name>] [--auth-mode none|basic|token] [--username <name>] [--password <password>] [--auth-token <token>] [--base-url ...] --token <token>
  codingns assistant workspaces reorder --workspace-id <id> [--workspace-id <id>] [--base-url ...] --token <token>
  codingns assistant workspaces management <workspaceId> [--base-url ...] --token <token>
  codingns assistant workspaces nav-state <workspaceId> [--collapsed true|false] [--background-color #RRGGBB|none] [--base-url ...] --token <token>
  codingns assistant workspaces remove <workspaceId> [--base-url ...] --token <token>
  codingns assistant sessions list --project <projectId> [--base-url ...] --token <token>
  codingns assistant sessions start --project <projectId> --message "..." [--provider <provider>] [--model <model>] [--reasoning-level <level>] [--permission-mode <mode>] --token <token>
  codingns assistant sessions get <sessionId> [--base-url ...] --token <token>
  codingns assistant sessions messages <sessionId> [--cursor <cursor>] [--limit 40] [--direction forward|backward] --token <token>
  codingns assistant sessions runtime <sessionId> [--base-url ...] --token <token>
  codingns assistant sessions send <sessionId> --message "..." [--client-request-id <id>] [--model <model>] [--reasoning-level <level>] [--permission-mode <mode>] --token <token>
  codingns assistant sessions fork <sessionId> [--source-type session|message] [--message-id <id>] [--strategy auto|native-only|reconstruct-only] [--target-provider <provider>] --token <token>
  codingns assistant timers list [--status active|completed|cancelled|failed] [--control-session-id <id>] --token <token>
  codingns assistant timers get <timerId> [--base-url ...] --token <token>
  codingns assistant timers create --message "..." [--title <title>] [--due-at <isoTime> | --after-seconds <seconds>] [--control-session-id <id>] [--project-id <projectId>] [--session-id <sessionId>] --token <token>
  codingns assistant timers cancel <timerId> [--base-url ...] --token <token>
  codingns assistant terminals list [--workspace-id <id> | --project-id <id>] --token <token>
  codingns assistant terminals history <terminalId> [--before-seq <n>] [--limit 20] --token <token>
  codingns assistant terminals send <terminalId> --input "npm test\\n" --token <token>
  codingns assistant terminals close <terminalId> [--base-url ...] --token <token>
  codingns assistant worktrees tree --root-workspace-id <id> [--base-url ...] --token <token>
  codingns assistant worktrees create --source-workspace-id <id> --branch-name <name> [--display-name <name>] [--base-ref <ref>] [--base-url ...] --token <token>
  codingns assistant worktrees merge-preview <workspaceId> [--base-url ...] --token <token>
  codingns assistant worktrees merge <workspaceId> [--base-url ...] --token <token>
  codingns assistant worktrees cleanup <workspaceId> [--delete-branch] [--base-url ...] --token <token>

环境变量：

  CODINGNS_BASE_URL      默认 Host 地址，未传时默认 http://127.0.0.1:3002
  CODINGNS_ACCESS_TOKEN  默认 Bearer token
  CODINGNS_AUTH_FILE     可选认证文件，支持读取 apiBaseUrl/accessToken
`.trim();
  }
}

function getSkillsHelpText(topic) {
  switch (topic) {
    case "skills.overview":
      return `
codingns skills overview

用途：
  查看当前 Host 聚合后的 skill 概况，包括受管、未纳管、冲突和诊断结果。

用法：
  codingns skills overview [--target codex] [--target gemini] --token <token>
`.trim();
    case "skills.add":
      return `
codingns skills add

用途：
  把本地 skill 目录纳入统一管理，并只同步到你指定的目标 CLI。

用法：
  codingns skills add --source <path> --target <cli> [--target <cli>] [--source-type local-import|builtin|managed-copy] --token <token>
`.trim();
    case "skills.import":
      return `
codingns skills import

用途：
  把某个 CLI 目录里已存在但未纳管的 skill 导入 SSOT，并可顺带同步到其他目标。

用法：
  codingns skills import --cli <cli> --path <directoryPath> [--expected-hash <hash>] [--target <cli>] --token <token>
`.trim();
    case "skills.sync":
      return `
codingns skills sync

用途：
  把指定受管 skill 再同步到一个或多个目标 CLI。

用法：
  codingns skills sync <skillId> --target <cli> [--target <cli>] --token <token>
`.trim();
    default:
      return `
codingns skills 用法：

  codingns skills overview [--target <cli>] --token <token>
  codingns skills add --source <path> --target <cli> [--target <cli>] [--source-type local-import|builtin|managed-copy] --token <token>
  codingns skills import --cli <cli> --path <directoryPath> [--expected-hash <hash>] [--target <cli>] --token <token>
  codingns skills sync <skillId> --target <cli> [--target <cli>] --token <token>

环境变量：

  CODINGNS_BASE_URL      默认 Host 地址，未传时默认 http://127.0.0.1:3002
  CODINGNS_ACCESS_TOKEN  默认 Bearer token
  CODINGNS_AUTH_FILE     可选认证文件，支持读取 apiBaseUrl/accessToken
`.trim();
  }
}

function buildAssistantHelpTopic(action, rest) {
  if (!action || action === "--help" || action === "-h") {
    return "assistant";
  }

  if (rest.length === 0) {
    return action;
  }

  return `${action}.${rest[0]}`;
}

function buildWorkspaceCloneAuth(values) {
  const authMode = readOptionalTrimmedValue(values["auth-mode"]);

  if (!authMode || authMode === "none") {
    return authMode === "none" ? { mode: "none" } : undefined;
  }

  if (authMode === "basic") {
    return {
      mode: "basic",
      username: readOptionalTrimmedValue(values.username),
      password: readOptionalTrimmedValue(values.password)
    };
  }

  if (authMode === "token") {
    return {
      mode: "token",
      username: readOptionalTrimmedValue(values.username),
      token: readOptionalTrimmedValue(values["auth-token"])
    };
  }

  fail(`不支持的 --auth-mode：${authMode}`);
}

function parseDebugPortRequests(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return values
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => parseDebugPortRequest(item));
}

function parseDebugPortRequest(value) {
  const segments = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const request = {
    serviceId: null,
    role: null,
    cwd: null,
    name: null,
    command: null,
    port: null
  };

  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split("=");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const parsedValue = rest.join("=").trim();

    if (!key || !parsedValue) {
      fail(`无效的 --port-request：${value}`);
    }

    switch (key) {
      case "service-id":
        request.serviceId = parsedValue;
        break;
      case "role":
        request.role = parsedValue;
        break;
      case "cwd":
        request.cwd = parsedValue;
        break;
      case "name":
        request.name = parsedValue;
        break;
      case "command":
        request.command = parsedValue;
        break;
      case "port": {
        const port = Number.parseInt(parsedValue, 10);

        if (!Number.isInteger(port)) {
          fail(`--port-request 中的 port 非法：${parsedValue}`);
        }

        request.port = port;
        break;
      }
      default:
        fail(`--port-request 不支持的键：${rawKey}`);
    }
  }

  if (!Number.isInteger(request.port)) {
    fail(`--port-request 缺少 port：${value}`);
  }

  if (!request.serviceId && !request.role && !request.cwd && !request.name && !request.command) {
    fail(`--port-request 至少要提供 service-id、role、cwd、name、command 之一：${value}`);
  }

  return request;
}

function parseBooleanOption(value, field) {
  const normalized = value.toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  fail(`参数 --${field} 只接受 true 或 false`);
}

function normalizeBackgroundColorOption(value) {
  return value.toLowerCase() === "none" ? null : value;
}

function buildSkillsHelpTopic(action) {
  if (!action || action === "--help" || action === "-h") {
    return "skills";
  }

  return `skills.${action}`;
}

function isHelpToken(value) {
  return value === "help" || value === "--help" || value === "-h";
}

function fail(message) {
  console.error(`[codingns] ${message}`);
  process.exit(1);
}
