import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ButlerProfile
} from "../../types/domain.js";
import type {
  ButlerPromptContext
} from "./context-aggregator.js";
import type {
  ButlerAuthService,
  ButlerWorkspaceCredential
} from "./butler-auth-service.js";
import { resolveBuiltinSkillDirectory } from "../skills/builtin-skill-service.js";
import type { SkillManagerService } from "../skills/skill-manager-service.js";

const BUTLER_SHARED_RULES_FILE_NAME = "BUTLER_RULES.md";
const BUTLER_AGENTS_FILE_NAME = "AGENTS.md";
const BUTLER_CLAUDE_FILE_NAME = "CLAUDE.md";
const BUTLER_ASSISTANT_SKILL_DIRECTORY = "codingns-assistant";
const BUTLER_ASSISTANT_SKILL_MANIFEST = ".codingns-assistant-skills.json";

export function syncButlerWorkspaceContext(input: {
  profile: ButlerProfile;
  promptContext: ButlerPromptContext;
  userId: string;
  workspacePath?: string | null;
  butlerAuthService: Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">;
  skillManagerService?: Pick<SkillManagerService, "listAssistantRuntimeSkillSources">;
  codexHomeDir: string | null;
  sourceCodexHomeDir: string | null;
  claudeCodeHomeDir: string | null;
  sourceClaudeCodeHomeDir: string | null;
}): {
  instructionWorkspacePath: string;
  authFilePath: string;
  providerInstructionFilePath: string;
} {
  const workspacePath = resolveInstructionWorkspacePath(input.profile, input.workspacePath);

  fs.mkdirSync(workspacePath, { recursive: true });
  const auth = input.butlerAuthService.ensureWorkspaceCredential(workspacePath, input.userId);
  const authFilePath = input.butlerAuthService.getCredentialFilePath(workspacePath);

  writeInstructionFiles(input.profile, workspacePath, input.promptContext, auth, authFilePath);
  syncCodexInstructionConfig(
    input.profile,
    workspacePath,
    input.codexHomeDir,
    input.sourceCodexHomeDir,
    input.skillManagerService
  );
  syncClaudeInstructionConfig(
    input.claudeCodeHomeDir,
    input.sourceClaudeCodeHomeDir,
    input.skillManagerService
  );

  return {
    instructionWorkspacePath: workspacePath,
    authFilePath,
    providerInstructionFilePath: resolveProviderInstructionFilePath(input.profile, workspacePath)
  };
}

function writeInstructionFiles(
  profile: ButlerProfile,
  workspacePath: string,
  promptContext: ButlerPromptContext,
  auth: ButlerWorkspaceCredential,
  authFilePath: string
): void {
  const artifacts = buildButlerInstructionArtifacts(profile, promptContext, workspacePath);

  writeFileIfChanged(artifacts.sharedRulesPath, artifacts.sharedRulesContent);
  writeFileIfChanged(artifacts.rootAgentsPath, artifacts.agentsContent);
  writeFileIfChanged(artifacts.rootClaudePath, artifacts.claudeContent);

  if (shouldSyncProfileAgentsFile(profile, workspacePath) && profile.agentsFilePath) {
    writeFileIfChanged(profile.agentsFilePath, artifacts.agentsContent);
  }

  writeFileIfChanged(
    path.join(workspacePath, "BUTLER_CONTEXT.md"),
    `${promptContext.prompt.trim()}\n`
  );
  writeFileIfChanged(
    path.join(workspacePath, "BUTLER_API.md"),
    buildApiGuideContent(auth, authFilePath)
  );
}

function syncCodexInstructionConfig(
  profile: ButlerProfile,
  workspacePath: string,
  codexHomeDir: string | null,
  sourceCodexHomeDir: string | null,
  skillManagerService?: Pick<SkillManagerService, "listAssistantRuntimeSkillSources">
): void {
  if (profile.providerId !== "codex" || !codexHomeDir?.trim()) {
    return;
  }

  const targetHomeDir = path.resolve(codexHomeDir);
  const sourceHomeDir = resolveSourceCodexHomeDir(sourceCodexHomeDir, targetHomeDir);
  const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
  const instructionFilePath = resolveInstructionAgentsFilePath(profile, workspacePath);
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
  syncButlerRuntimeSkills(path.join(targetHomeDir, "skills"), "codex", skillManagerService);
  writeFileIfChanged(path.join(targetHomeDir, "config.toml"), `${configContent}\n`);
}

function syncClaudeInstructionConfig(
  claudeCodeHomeDir: string | null,
  sourceClaudeCodeHomeDir: string | null,
  skillManagerService?: Pick<SkillManagerService, "listAssistantRuntimeSkillSources">
): void {
  if (!claudeCodeHomeDir?.trim()) {
    return;
  }

  const targetHomeDir = path.resolve(claudeCodeHomeDir);
  const sourceHomeDir = resolveSourceClaudeCodeHomeDir(sourceClaudeCodeHomeDir, targetHomeDir);

  fs.mkdirSync(targetHomeDir, { recursive: true });
  syncOptionalFile(
    path.join(sourceHomeDir, "config.json"),
    path.join(targetHomeDir, "config.json")
  );
  syncOptionalFile(
    path.join(sourceHomeDir, "settings.json"),
    path.join(targetHomeDir, "settings.json")
  );
  syncOptionalFile(
    path.join(sourceHomeDir, "project-config.json"),
    path.join(targetHomeDir, "project-config.json")
  );
  syncOptionalDirectory(
    path.join(sourceHomeDir, "plugins"),
    path.join(targetHomeDir, "plugins")
  );
  syncOptionalDirectory(
    path.join(sourceHomeDir, "skills"),
    path.join(targetHomeDir, "skills")
  );
  syncButlerRuntimeSkills(path.join(targetHomeDir, "skills"), "claude-code", skillManagerService);
  removeFileIfExists(path.join(targetHomeDir, "managed-settings.json"));
  removeFileIfExists(path.join(targetHomeDir, "CLAUDE.md"));
  removeFileIfExists(path.join(targetHomeDir, "AGENTS.md"));
  removeFileIfExists(path.join(targetHomeDir, "BUTLER_RULES.md"));
}

function syncButlerRuntimeSkills(
  targetSkillsDir: string,
  targetCli: "codex" | "claude-code",
  skillManagerService?: Pick<SkillManagerService, "listAssistantRuntimeSkillSources">
): void {
  fs.mkdirSync(targetSkillsDir, { recursive: true });
  const manifestPath = path.join(targetSkillsDir, BUTLER_ASSISTANT_SKILL_MANIFEST);
  const previousDirectories = readAssistantSkillManifest(manifestPath);
  const sources = resolveAssistantRuntimeSkillSources(targetCli, skillManagerService);
  const currentDirectories = new Set(sources.map((item) => item.directoryName));

  for (const directoryName of previousDirectories) {
    if (!currentDirectories.has(directoryName)) {
      fs.rmSync(path.join(targetSkillsDir, directoryName), { recursive: true, force: true });
    }
  }

  for (const item of sources) {
    syncOptionalDirectory(item.sourcePath, path.join(targetSkillsDir, item.directoryName));
  }

  writeFileIfChanged(manifestPath, JSON.stringify([...currentDirectories].sort(), null, 2));
}

function resolveAssistantRuntimeSkillSources(
  targetCli: "codex" | "claude-code",
  skillManagerService?: Pick<SkillManagerService, "listAssistantRuntimeSkillSources">
): Array<{ directoryName: string; sourcePath: string }> {
  if (skillManagerService) {
    return skillManagerService
      .listAssistantRuntimeSkillSources([targetCli])
      .map((item) => ({
        directoryName: item.directoryName,
        sourcePath: item.sourcePath
      }));
  }

  try {
    return [
      {
        directoryName: BUTLER_ASSISTANT_SKILL_DIRECTORY,
        sourcePath: resolveBuiltinSkillDirectory(BUTLER_ASSISTANT_SKILL_DIRECTORY)
      }
    ];
  } catch {
    return [];
  }
}

function readAssistantSkillManifest(manifestPath: string): string[] {
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function buildButlerInstructionArtifacts(
  profile: ButlerProfile,
  promptContext: ButlerPromptContext,
  workspacePath: string
): {
  sharedRulesPath: string;
  rootAgentsPath: string;
  rootClaudePath: string;
  sharedRulesContent: string;
  agentsContent: string;
  claudeContent: string;
} {
  const sharedInstructionBody = composeSharedInstructionBody(profile, promptContext);

  return {
    sharedRulesPath: path.join(workspacePath, BUTLER_SHARED_RULES_FILE_NAME),
    rootAgentsPath: path.join(workspacePath, BUTLER_AGENTS_FILE_NAME),
    rootClaudePath: path.join(workspacePath, BUTLER_CLAUDE_FILE_NAME),
    sharedRulesContent: composeSharedInstructionSourceDocument(sharedInstructionBody),
    agentsContent: composeProviderInstructionDocument("codex", sharedInstructionBody),
    claudeContent: composeProviderInstructionDocument("claude-code", sharedInstructionBody)
  };
}

function composeSharedInstructionBody(
  profile: ButlerProfile,
  promptContext: ButlerPromptContext
): string {
  return `${normalizeSharedInstructionSeed(profile.agentsContent)}

## 代码助手共享规则正文（系统自动生成）

- 当前工作目录就是当前助手会话绑定的工作区目录，只使用这里的助手规则，不回退到别的项目会话规则。
- \`${BUTLER_SHARED_RULES_FILE_NAME}\` 是共享规则源；\`${BUTLER_AGENTS_FILE_NAME}\` 和 \`${BUTLER_CLAUDE_FILE_NAME}\` 都是从这里自动展开出来的下游文件。
- 当前目录默认就是当前助手会话绑定的真实工作区。只要任务范围在这个工作区内，你就直接在这里写脚本、改文件、生成产物、整理结果。
- 当前目录就是这次助手会话要工作的正式工作区。不要再额外假设还有一层独立临时目录，也不要把别的项目目录误当成当前工作区。
- 如果任务涉及别的工作区、别的项目仓库，或者明确要续写别的项目会话里的代码修改，先定位目标工作区和目标会话，再通过 \`codingns assistant sessions start / send / fork\` 或受控终端推进。
- 如果用户要求“修改代码”“继续实现”“修 bug”，先判断目标是不是当前绑定工作区；如果是，就直接在当前工作区继续做；如果不是，就切到对应真实项目会话再做。
- 如果用户没有额外指定别的工作区，但你判断需要落文件，默认直接落在当前绑定工作区，不要再创建任何临时沙箱目录。
- 当前聚合后的平台摘要写在 \`BUTLER_CONTEXT.md\`，先看这里，不要把所有项目原始记录一股脑塞进回答。
- 当前摘要作用域以 \`BUTLER_CONTEXT.md\` 的最新内容为准；这次生成时记录的是：${promptContext.scope === "project" ? `项目 ${promptContext.projectId}` : "全局总览"}。如果后续上下文文件已刷新，以文件里的当前作用域为准，不要被旧缓存绑死。
- 你自己的主工具入口不是一堆 HTTP 路由，而是 \`codingns assistant ...\`。真正执行前，先用 \`codingns assistant --help\`、\`codingns assistant help <group>\`、\`codingns assistant <group> <action> --help\` 按需查命令。
- 如果当前 CLI 环境能发现 \`${BUTLER_ASSISTANT_SKILL_DIRECTORY}\` skill，优先按这个 skill 的流程工作：先确认 CLI 的默认认证入口可用，再查能力，再查项目/会话/终端，再决定是否发送消息、fork 或发终端输入。
- 默认查询顺序固定为：先看 \`BUTLER_CONTEXT.md\`，再确认 CLI 认证入口可用，然后用 \`codingns assistant capabilities list\` 确认能力，再按 \`projects / sessions / terminals\` 分组查具体对象；不要先翻一大堆旧 REST 文档。
- 如果任务是办公文档、浏览器操作、SSH 运维或控制台运维，优先走 \`codingns assistant office ...\`，不要自己拼私有 HTTP，也不要绕回裸 \`ssh\`、裸脚本或临时浏览器自动化。
- 文档任务用 \`document-create / document-update / document-export / document-task\`；浏览器任务用 \`browser-profile-create / browser-task-create / browser-task-get\`；运维任务用 \`ops-target-create / ops-ssh-task-create / ops-task-execute / ops-task-get\`。
- 只要任务属于打开网页、登录网站、抓取页面、读取 DOM、截图、点击按钮、填写表单、下载文件这类真实网页操作，默认先走 \`codingns assistant office browser-profile-list / browser-task-create\`，不要先落到 Codex 自带 Browser。
- 只有本地前端预览、开发调试 \`localhost\` / \`127.0.0.1\` / \`::1\` 页面，或者用户明确点名要用当前 in-app browser，才优先保留 Codex 自带 Browser。
- 高风险办公任务如果返回 \`pending_approval\`，必须先处理审批，再继续执行。不要把“任务已创建”误当成“任务已执行”。
- 对办公能力的真实性判断，以任务状态、步骤、产物、回执为准，不以模型口头描述为准。
- 如果你在跟进开发会话，且目标或上下文里提到了 spec，只能围绕 spec 明确写出的必做项推进，不能顺着建议项无限扩展开发范围。
- 如果当前没有 spec，就先从用户要求和会话现状里归纳一句核心任务，后续只围绕这个核心任务推进；不要把建议项、最佳实践、顺手优化当成必做项。
- 如果用户的问题里已经带了项目名、会话名、错误词或任务关键词，先通过 \`codingns assistant projects --help\`、\`codingns assistant sessions --help\` 选对命令，再查目标对象；如果用户明确点名历史会话或归档会话，按 help 提示补充筛选参数。
- 如果 \`BUTLER_CONTEXT.md\` 里的项目数或会话数是 0，不能直接下结论，必须先确认 CLI 认证入口可用，再跑 \`codingns assistant capabilities list\` 和 \`codingns assistant projects list\` 确认真实状态。
- 如果用户追问的细节超出当前摘要，先明确缺口，再按 \`BUTLER_API.md\` 里记录的 CLI 顺序补查项目、会话、消息窗口或终端历史。
- 如果用户追问会话内容，先定位 \`sessionId\`，再优先用 \`codingns assistant sessions messages <sessionId>\` 查看最近消息，不要只复述摘要。
- 需要推进开发时，如果明确是在续写某个已有真实会话，才用 \`codingns assistant sessions send <sessionId> --message ...\`；如果没有明确续写目标，先用 \`codingns assistant sessions start --project <projectId> --message ...\` 按当前助手的 provider/model 配置新建真实会话。
- 如果你决定“等待真实会话回复”“几分钟后再检查”“到某个具体时间再继续”，不能只在回答里口头承诺，必须立刻用 \`codingns assistant timers create ...\` 创建计时器，让系统到点后自动续回当前助手会话。
- 不要编造不存在的项目状态；信息不足时直接说缺什么。
`;
}

function composeSharedInstructionSourceDocument(sharedInstructionBody: string): string {
  return `# ${BUTLER_SHARED_RULES_FILE_NAME}

> 这是代码助手的共享规则源。
> \`${BUTLER_AGENTS_FILE_NAME}\` 和 \`${BUTLER_CLAUDE_FILE_NAME}\` 都会从这里自动同步生成。
> 如果需要改共享规则，改这里对应的生成源，不要直接手改下游文件。

${sharedInstructionBody.trim()}
`;
}

function composeProviderInstructionDocument(
  provider: "codex" | "claude-code",
  sharedInstructionBody: string
): string {
  const targetFileName = provider === "codex" ? BUTLER_AGENTS_FILE_NAME : BUTLER_CLAUDE_FILE_NAME;

  return `# ${targetFileName}

> 此文件由 \`${BUTLER_SHARED_RULES_FILE_NAME}\` 自动生成。
> 共享正文修改入口是共享规则源；这里只追加 ${provider === "codex" ? "Codex" : "Claude Code"} 的增量覆盖段。

${sharedInstructionBody.trim()}

${composeProviderInstructionOverlay(provider)}
`;
}

function composeProviderInstructionOverlay(provider: "codex" | "claude-code"): string {
  if (provider === "claude-code") {
    return `## Claude Code 增量覆盖

- 这份规则会通过 \`--system-prompt-file\` 显式注入，不依赖 \`CLAUDE.md\` 自动发现。
- 当前 Claude Code 会话的 \`CLAUDE_CONFIG_DIR\`、\`HOME\`、\`XDG_*\`、\`APPDATA\` 都会切到助手专用目录。
- 助手专用目录会先继承用户默认 \`~/.claude\` 里的登录态、模型配置、settings、plugins、skills，再覆盖成 Butler 规则环境。
- 默认 \`~/.claude/CLAUDE.md\` 这类规则文件不会继承到当前会话；当前规则只认 Butler 生成的共享规则和这份注入文件。
- 如果当前 Claude Code 环境能发现 \`${BUTLER_ASSISTANT_SKILL_DIRECTORY}\` skill，按这个 skill 的流程工作；如果 skill 缺失，只能按共享规则和当前工作区文件继续执行。`;
  }

  return `## Codex 增量覆盖

- 这份规则会通过 Codex 的 \`model_instructions_file\` 显式注入。
- 当前 Codex 使用的是助手专用 home；如果专用 home 里的规则和普通项目目录冲突，以这份生成文件为准。
- 如果当前 Codex 环境能发现 \`${BUTLER_ASSISTANT_SKILL_DIRECTORY}\` skill，优先按 skill 的流程工作。`;
}

function normalizeSharedInstructionSeed(content: string): string {
  const normalized = content.trim();
  const strippedTitle = normalized.replace(
    /^#\s*(AGENTS\.md|CLAUDE\.md|BUTLER_RULES\.md)\s*\n+/i,
    ""
  ).trim();

  return strippedTitle || normalized;
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

- 只有当你不在当前助手工作区、CLI 自动发现失败，或者要临时切到别的 Host / 凭证文件时，才手工导出环境变量。
- 默认不要把“先 export 再执行”当成每轮固定动作。

\`\`\`bash
export CODINGNS_BASE_URL="$(jq -r '.apiBaseUrl' "${authFilePath}")"
export CODINGNS_ACCESS_TOKEN="$(jq -r '.accessToken' "${authFilePath}")"
\`\`\`

## 默认读取顺序

1. 先读 \`BUTLER_CONTEXT.md\` 的当前摘要。
2. 先确认 CLI 认证入口可用；在当前助手工作区里默认直接执行即可，必要时再核对上面的凭证文件路径。
3. 认证入口可用后，再跑 \`codingns assistant capabilities list\`，确认当前开放能力。
4. 不知道怎么查时，先跑 \`codingns assistant --help\`、\`codingns assistant help projects\`、\`codingns assistant help sessions\`、\`codingns assistant help terminals\`。
5. 要找项目时，先 \`codingns assistant projects list\`，需要详情时再 \`projects get <projectId>\`。
6. 要找会话时，先 \`codingns assistant sessions list --project <projectId>\`，再按需要用 \`sessions get\`、\`sessions runtime\`、\`sessions messages\`。
7. 要推进开发时，先判断是不是明确续写某个已有真实会话；明确续写才用 \`codingns assistant sessions send <sessionId> --message "..."\`，否则用 \`codingns assistant sessions start --project <projectId> --message "..."\` 新建真实会话。
8. 如果需要等待真实会话回复，或者未来某个具体时间后再继续，立刻用 \`codingns assistant timers create\` 建计时器，不能只口头说“稍后继续”。
9. 只有明确需要 shell 链路时，先 \`terminals list\`、\`terminals history\`，再决定是否 \`terminals send\`。
10. 要开新分支时，再用 \`codingns assistant sessions fork <sessionId>\`。

## 办公能力调用顺序

1. 需要正式文档产物时，先 \`codingns assistant office document-create\`，再 \`document-update\`，最后 \`document-export --execute true\`，并用 \`document-task\` 看真实导出结果。
2. 需要真实 Chrome/Edge 自动化时，优先直接 \`codingns assistant office browser-task-create --execution-backend opencli_bridge --execute true\`，最后 \`browser-task-get\` 看截图、DOM、下载产物和回执。只有明确要走无头 playwright，或者要手工管理独立 Profile 时，再先 \`browser-profile-list\` / \`browser-profile-create\`。
3. 需要 SSH 运维时，先 \`codingns assistant office ops-target-create\`，再 \`ops-ssh-task-create\`。如果状态是 \`pending_approval\`，先 \`task-approval-reply\`，再 \`ops-task-execute\`，最后 \`ops-task-get\` 看 stdout、stderr 和回执。
4. 能用 \`office\` 的地方，不要绕回私有 HTTP、裸 \`ssh\` 或单次临时脚本。这样状态、审批、回执和产物才不会散掉。

## 执行边界

- 当前目录就是当前助手会话绑定的工作区；如果任务只发生在这里，你可以直接写文件、写脚本、生成产物。
- 你当前就在正式工作区内工作，但不能越过当前绑定范围去修改别的工作区或别的项目仓库。
- 需要推进正式工作区开发时，只能通过下面这些 CLI 命令驱动真实项目会话或受控终端。
- 需要命令结果时，优先查终端历史；确实要执行命令，再向受控终端发送输入。
- 需要分叉会话时，统一走 \`codingns assistant sessions fork\`，不要自己伪造一条“新上下文”继续编。

## help 入口

\`\`\`bash
codingns assistant --help
codingns assistant help projects
codingns assistant help sessions
codingns assistant sessions start --help
codingns assistant sessions send --help
codingns assistant timers create --help
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
- \`codingns assistant sessions start --project <projectId> --message "..."\`：按当前助手配置新建真实项目会话。
- \`codingns assistant sessions send <sessionId> --message "..."\`：向明确要续写的真实项目会话发消息。
- \`codingns assistant sessions fork <sessionId> --message-id <messageId>\`：从消息点 fork 新会话。
- \`codingns assistant timers create --after-seconds 300 --message "..." --session-id <sessionId>\`：给当前助手会话挂一个后续唤醒计时器。
- \`codingns assistant terminals list --project-id <projectId>\`：列出项目下终端。
- \`codingns assistant terminals history <terminalId> --limit 50\`：读取终端最近输出。
- \`codingns assistant terminals send <terminalId> --input "npm test\\n"\`：向终端发送输入。
- \`codingns assistant office document-create --title "周报" --template-key team.doct.weekly --content-json '{"sections":[]}'\`：创建办公文档。
- \`codingns assistant office document-export <documentId> --format docx --execute true\`：按 doct 模板导出真实生产文档。
- \`codingns assistant office browser-profile-list\`：列出当前工作区可复用的无头/手工管理浏览器 Profile。
- \`codingns assistant office browser-profile-create --engine chrome --mode persistent --display-name "办公 Chrome"\`：创建手工管理的真实浏览器 Profile。
- \`codingns assistant office browser-task-create --execution-backend opencli_bridge --execute true --input-json '{"startUrl":"https://example.invalid","actions":[{"type":"read_dom"},{"type":"screenshot"}]}'\`：执行真实浏览器桥接任务，通常不需要传 \`--profile-id\`。
- \`codingns assistant office ops-target-create --kind ssh_host --display-name "生产 SSH" --config-json '{"host":"10.0.0.8","username":"root"}'\`：创建 SSH 运维目标。
- \`codingns assistant office ops-ssh-task-create --target-id <targetId> --execute false --input-json '{"command":"df -h","timeoutMs":60000}'\`：创建 SSH 运维任务。
- \`codingns assistant office task-approval-reply <approvalId> --status approved\`：批准高风险办公任务。
- \`codingns assistant office ops-task-execute <taskId>\`：执行已批准的 SSH 运维任务。
- \`codingns assistant office ops-task-get <taskId>\`：读取运维任务状态、stdout/stderr 产物和回执。

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

function resolveSourceClaudeCodeHomeDir(sourceClaudeCodeHomeDir: string | null, targetHomeDir: string): string {
  const configuredSource = sourceClaudeCodeHomeDir?.trim();

  if (configuredSource) {
    const resolvedConfiguredSource = path.resolve(configuredSource);

    if (resolvedConfiguredSource !== targetHomeDir) {
      return resolvedConfiguredSource;
    }
  }

  const fallbackHomeDir = path.resolve(path.join(os.homedir(), ".claude"));

  if (fallbackHomeDir !== targetHomeDir) {
    return fallbackHomeDir;
  }

  return targetHomeDir;
}

function resolveInstructionWorkspacePath(profile: ButlerProfile, workspacePath?: string | null): string {
  const normalized = workspacePath?.trim();
  return path.resolve(normalized || profile.workspacePath);
}

function resolveInstructionAgentsFilePath(profile: ButlerProfile, workspacePath: string): string {
  if (path.resolve(workspacePath) !== path.resolve(profile.workspacePath)) {
    return path.join(workspacePath, BUTLER_AGENTS_FILE_NAME);
  }

  if (profile.agentsMode === "file" && profile.agentsFilePath) {
    return path.resolve(profile.agentsFilePath);
  }

  return path.join(profile.workspacePath, BUTLER_AGENTS_FILE_NAME);
}

function resolveProviderInstructionFilePath(profile: ButlerProfile, workspacePath: string): string {
  if (profile.providerId === "claude-code") {
    return path.join(workspacePath, BUTLER_CLAUDE_FILE_NAME);
  }

  return resolveInstructionAgentsFilePath(profile, workspacePath);
}

function shouldSyncProfileAgentsFile(profile: ButlerProfile, workspacePath: string): boolean {
  return (
    path.resolve(workspacePath) === path.resolve(profile.workspacePath)
    && profile.agentsMode === "file"
  );
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
