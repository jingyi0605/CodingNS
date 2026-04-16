import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ButlerProfile
} from "../../types/domain.js";
import {
  ensureButlerWorkspaceIsolation
} from "./butler-profile-service.js";
import type {
  ButlerPromptContext
} from "./context-aggregator.js";
import type {
  ButlerAuthService,
  ButlerWorkspaceCredential
} from "./butler-auth-service.js";
import type { SkillManagerService } from "../skills/skill-manager-service.js";

export function syncButlerWorkspaceContext(input: {
  profile: ButlerProfile;
  promptContext: ButlerPromptContext;
  userId: string;
  butlerAuthService: Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">;
  skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">;
  codexHomeDir: string | null;
  sourceCodexHomeDir: string | null;
}): void {
  fs.mkdirSync(input.profile.workspacePath, { recursive: true });
  ensureButlerWorkspaceIsolation(input.profile.workspacePath);
  const auth = input.butlerAuthService.ensureWorkspaceCredential(input.profile.workspacePath, input.userId);
  const authFilePath = input.butlerAuthService.getCredentialFilePath(input.profile.workspacePath);

  writeInstructionFiles(input.profile, input.promptContext, auth, authFilePath);
  syncCodexInstructionConfig(
    input.profile,
    input.skillManagerService,
    input.codexHomeDir,
    input.sourceCodexHomeDir
  );
}

function writeInstructionFiles(
  profile: ButlerProfile,
  promptContext: ButlerPromptContext,
  auth: ButlerWorkspaceCredential,
  authFilePath: string
): void {
  const rootAgentsPath = path.join(profile.workspacePath, "AGENTS.md");
  writeFileIfChanged(rootAgentsPath, composeInstructionContent(profile, promptContext));

  if (profile.agentsMode === "file" && profile.agentsFilePath) {
    writeFileIfChanged(profile.agentsFilePath, composeInstructionContent(profile, promptContext));
  }

  if (profile.providerId === "claude-code") {
    const claudeFilePath = path.join(profile.workspacePath, "CLAUDE.md");
    writeFileIfChanged(claudeFilePath, composeInstructionContent(profile, promptContext));
  }

  writeFileIfChanged(
    path.join(profile.workspacePath, "BUTLER_CONTEXT.md"),
    `${promptContext.prompt.trim()}\n`
  );
  writeFileIfChanged(
    path.join(profile.workspacePath, "BUTLER_API.md"),
    buildApiGuideContent(auth, authFilePath)
  );
}

function syncCodexInstructionConfig(
  profile: ButlerProfile,
  skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
  codexHomeDir: string | null,
  sourceCodexHomeDir: string | null
): void {
  if (profile.providerId !== "codex" || !codexHomeDir?.trim()) {
    return;
  }

  const targetHomeDir = path.resolve(codexHomeDir);
  const sourceHomeDir = resolveSourceCodexHomeDir(sourceCodexHomeDir, targetHomeDir);
  const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
  const instructionFilePath =
    profile.agentsMode === "file" && profile.agentsFilePath
      ? path.resolve(profile.agentsFilePath)
      : path.join(profile.workspacePath, "AGENTS.md");
  const sourceConfigContent =
    sourceHomeDir !== targetHomeDir && fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()
      ? fs.readFileSync(sourceConfigPath, "utf8")
      : "";
  const configContent = composeCodexConfigContent(sourceConfigContent, instructionFilePath);

  fs.mkdirSync(targetHomeDir, { recursive: true });
  removeFileIfExists(path.join(targetHomeDir, "AGENTS.md"));
  removeFileIfExists(path.join(targetHomeDir, "AGENTS.override.md"));
  // Butler 运行在独立 home，下游会话仍然需要沿用当前 Codex 登录态。
  syncOptionalFile(
    path.join(sourceHomeDir, "auth.json"),
    path.join(targetHomeDir, "auth.json")
  );
  syncButlerCodexSkill(
    skillManagerService,
    path.join(targetHomeDir, "skills", "codingns-assistant")
  );
  writeFileIfChanged(path.join(targetHomeDir, "config.toml"), `${configContent}\n`);
}

function syncButlerCodexSkill(
  skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
  targetSkillPath: string
): void {
  const skillDirectoryName = "codingns-assistant";
  const overview = skillManagerService.getOverview({
    targetCli: ["codex"]
  });
  const managedSkill = overview.managedSkills.find(
    (item) => item.skill.directoryName === skillDirectoryName
  );

  if (managedSkill) {
    syncOptionalDirectory(managedSkill.ssotPath, targetSkillPath);
    return;
  }

  const unmanagedEntry = overview.unmanagedEntries.find(
    (entry) => entry.targetCli === "codex" && entry.directoryName === skillDirectoryName
  );

  if (unmanagedEntry) {
    const imported = skillManagerService.importUnmanagedSkill({
      targetCli: "codex",
      directoryPath: unmanagedEntry.directoryPath,
      expectedContentHash: unmanagedEntry.contentHash
    });
    syncOptionalDirectory(imported.ssotPath, targetSkillPath);
    return;
  }

  fs.rmSync(targetSkillPath, { recursive: true, force: true });
}

function composeInstructionContent(
  profile: ButlerProfile,
  promptContext: ButlerPromptContext
): string {
  return `${profile.agentsContent.trim()}

## 代码助手运行附加说明（系统自动生成）

- 当前工作目录是代码助手专用目录，只使用这里的助手规则，不回退到普通项目会话规则。
- 你是代码助手控制面，不是项目实现者。默认职责只有：查看、分析、归纳、补查信息、安排下一步、把指令发送给真实项目会话或终端。
- 禁止直接改业务项目代码、禁止直接生成补丁并落盘、禁止自己在项目目录里写实现。用户要推进开发时，只能通过内部 API 续接/新建项目会话、发送消息、查询结果，或者操作受控终端。
- 如果用户要求“修改代码”“继续实现”“修 bug”，先定位目标项目和目标会话；没有会话就先新建/续接项目会话，再把任务发给那个会话继续做，不要自己在 Butler 工作目录里动手。
- 当前聚合后的平台摘要写在 \`BUTLER_CONTEXT.md\`，先看这里，不要把所有项目原始记录一股脑塞进回答。
- 当前摘要作用域以 \`BUTLER_CONTEXT.md\` 的最新内容为准；这次生成时记录的是：${promptContext.scope === "project" ? `项目 ${promptContext.projectId}` : "全局总览"}。如果后续上下文文件已刷新，以文件里的当前作用域为准，不要被旧缓存绑死。
- 你自己的主工具入口不是一堆 HTTP 路由，而是 \`codingns assistant ...\`。真正执行前，先用 \`codingns assistant --help\`、\`codingns assistant help <group>\`、\`codingns assistant <group> <action> --help\` 按需查命令。
- 如果当前 Codex 环境能发现 \`codingns-assistant\` skill，优先按这个 skill 的流程工作：先确认 CLI 的默认认证入口可用，再查能力，再查项目/会话/终端，再决定是否发送消息、fork 或发终端输入。
- 默认查询顺序固定为：先看 \`BUTLER_CONTEXT.md\`，再确认 CLI 认证入口可用，然后用 \`codingns assistant capabilities list\` 确认能力，再按 \`projects / sessions / terminals\` 分组查具体对象；不要先翻一大堆旧 REST 文档。
- 如果你在跟进开发会话，且目标或上下文里提到了 spec，只能围绕 spec 明确写出的必做项推进，不能顺着建议项无限扩展开发范围。
- 如果当前没有 spec，就先从用户要求和会话现状里归纳一句核心任务，后续只围绕这个核心任务推进；不要把建议项、最佳实践、顺手优化当成必做项。
- 如果用户的问题里已经带了项目名、会话名、错误词或任务关键词，先通过 \`codingns assistant projects --help\`、\`codingns assistant sessions --help\` 选对命令，再查目标对象；如果用户明确点名历史会话或归档会话，按 help 提示补充筛选参数。
- 如果 \`BUTLER_CONTEXT.md\` 里的项目数或会话数是 0，不能直接下结论，必须先确认 CLI 认证入口可用，再跑 \`codingns assistant capabilities list\` 和 \`codingns assistant projects list\` 确认真实状态。
- 如果用户追问的细节超出当前摘要，先明确缺口，再按 \`BUTLER_API.md\` 里记录的 CLI 顺序补查项目、会话、消息窗口或终端历史。
- 如果用户追问会话内容，先定位 \`sessionId\`，再优先用 \`codingns assistant sessions messages <sessionId>\` 查看最近消息，不要只复述摘要。
- 需要推进开发时，优先用 \`codingns assistant sessions send <sessionId> --message ...\`；只有明确需要 shell 链路时，才用 \`codingns assistant terminals send <terminalId> --input ...\`。
- 不要编造不存在的项目状态；信息不足时直接说缺什么。
`;
}

function buildApiGuideContent(auth: ButlerWorkspaceCredential, authFilePath: string): string {
  return `# 代码助手 CLI 与按需补查指南

默认不要直接背 HTTP 路由。先用 \`codingns assistant ...\` 和分层 help 按需查询。

## 固定认证方式

- Butler 专用凭证文件：\`${path.basename(authFilePath)}\`
- 凭证文件路径：\`${authFilePath}\`
- 当前 API 基地址：\`${auth.apiBaseUrl}\`
- 默认直接执行 \`codingns assistant ...\`；CLI 会优先按固定顺序读取认证。

## CLI 默认认证顺序

1. 显式传入的 \`--token\` / \`--base-url\`
2. 环境变量 \`CODINGNS_ACCESS_TOKEN\` / \`CODINGNS_BASE_URL\`
3. 环境变量 \`CODINGNS_AUTH_FILE\` 或 \`BUTLER_AUTH_FILE\` 指向的认证文件
4. 当前目录及上级目录里的 \`BUTLER_AUTH.json\`

## 什么时候手工导出环境变量

- 只有当你不在 Butler 工作区、CLI 自动发现失败，或者要临时切到别的 Host / 凭证文件时，才手工导出环境变量。
- 默认不要把“先 export 再执行”当成每轮固定动作。

\`\`\`bash
export CODINGNS_BASE_URL="$(jq -r '.apiBaseUrl' "${authFilePath}")"
export CODINGNS_ACCESS_TOKEN="$(jq -r '.accessToken' "${authFilePath}")"
\`\`\`

## 默认读取顺序

1. 先读 \`BUTLER_CONTEXT.md\` 的当前摘要。
2. 先确认 CLI 认证入口可用；在 Butler 工作区里默认直接执行即可，必要时再核对上面的凭证文件路径。
3. 认证入口可用后，再跑 \`codingns assistant capabilities list\`，确认当前开放能力。
4. 不知道怎么查时，先跑 \`codingns assistant --help\`、\`codingns assistant help projects\`、\`codingns assistant help sessions\`、\`codingns assistant help terminals\`。
5. 要找项目时，先 \`codingns assistant projects list\`，需要详情时再 \`projects get <projectId>\`。
6. 要找会话时，先 \`codingns assistant sessions list --project <projectId>\`，再按需要用 \`sessions get\`、\`sessions runtime\`、\`sessions messages\`。
7. 要推进开发时，优先 \`codingns assistant sessions send <sessionId> --message "..."\`。
8. 只有明确需要 shell 链路时，先 \`terminals list\`、\`terminals history\`，再决定是否 \`terminals send\`。
9. 要开新分支时，再用 \`codingns assistant sessions fork <sessionId>\`。

## 执行边界

- 你不能直接修改项目代码，也不能把自己当成项目执行会话。
- 需要推进开发时，只能通过下面这些 CLI 命令驱动真实项目会话或受控终端。
- 需要命令结果时，优先查终端历史；确实要执行命令，再向受控终端发送输入。
- 需要分叉会话时，统一走 \`codingns assistant sessions fork\`，不要自己伪造一条“新上下文”继续编。

## help 入口

\`\`\`bash
codingns assistant --help
codingns assistant help projects
codingns assistant help sessions
codingns assistant sessions send --help
codingns assistant terminals send --help
\`\`\`

## 常用命令

- \`codingns assistant capabilities list\`：查看当前 Butler 可用能力。
- \`codingns assistant projects list\`：列出托管项目。
- \`codingns assistant projects get <projectId>\`：读取项目详情和项目下可操作会话。
- \`codingns assistant sessions list --project <projectId>\`：列出项目会话。
- \`codingns assistant sessions get <sessionId>\`：读取真实会话详情。
- \`codingns assistant sessions messages <sessionId> --limit 40\`：读取最近消息窗口。
- \`codingns assistant sessions runtime <sessionId>\`：查看会话是否还在运行。
- \`codingns assistant sessions send <sessionId> --message "..."\`：向真实项目会话发消息。
- \`codingns assistant sessions fork <sessionId> --message-id <messageId>\`：从消息点 fork 新会话。
- \`codingns assistant terminals list --project-id <projectId>\`：列出项目下终端。
- \`codingns assistant terminals history <terminalId> --limit 50\`：读取终端最近输出。
- \`codingns assistant terminals send <terminalId> --input "npm test\\n"\`：向终端发送输入。

## 底层说明

- 上面这些命令最终还是调用宿主系统的 \`/api/assistant/*\`。
- 只有当 CLI 还没覆盖某个极少数细节时，才回退到底层 HTTP。
`;
}

function resolveSourceCodexHomeDir(sourceCodexHomeDir: string | null, targetHomeDir: string): string {
  const configuredSource = sourceCodexHomeDir?.trim();

  if (configuredSource) {
    const resolvedConfiguredSource = path.resolve(configuredSource);

    if (resolvedConfiguredSource !== targetHomeDir) {
      return resolvedConfiguredSource;
    }
  }

  const fallbackHomeDir = path.resolve(path.join(os.homedir(), ".codex"));

  if (fallbackHomeDir !== targetHomeDir) {
    return fallbackHomeDir;
  }

  return targetHomeDir;
}

function composeCodexConfigContent(sourceConfigContent: string, instructionFilePath: string): string {
  const normalizedSource = sourceConfigContent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("model_instructions_file");
    })
    .join("\n")
    .trim();

  return [
    "# 代码助手专用 Codex 配置（系统自动生成）",
    normalizedSource,
    `model_instructions_file = ${toTomlString(instructionFilePath)}`
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function writeFileIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return;
  }

  writeFileIfChanged(targetPath, fs.readFileSync(sourcePath, "utf8"));
}

function syncOptionalDirectory(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.rmSync(filePath, { force: true });
}

function toTomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
