import { promises as fs } from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

const DEFAULT_CODEX_TITLE_MODEL = "gpt-5.4";
const CODEX_GENERATED_TITLE_MAX_LENGTH = 72;
const TITLE_SYSTEM_PROMPT = [
  "你只负责给一段代码助手会话起标题。",
  "标题必须是中文，建议 16 到 28 个汉字；如果必须保留英文名词，总长度最多 72 个字符。",
  "标题要包含具体对象、动作和范围，例如改哪个页面、修哪条链路、做哪类验证。",
  "不要只写‘优化会话列表’、‘修复问题’这类空标题。",
  "如果用户内容以‘你是 Agent X，负责...’开头，只提取‘负责’后面的真实任务，不要保留 Agent 编号或角色自我介绍。",
  "不要加引号，不要加句号，不要解释，只输出一行标题。",
  "标题要概括用户真正想做的事，不能照抄第一句话。"
].join("\n");

interface OpenAiRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface LightweightRuntimeConfigFile {
  openai?: {
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
  } | null;
}

export interface CodexSessionTitleGeneratorOptions {
  hostDataRootDir: string;
  codexHomeDir: string;
}

export interface GenerateCodexSessionTitleInput {
  currentTitle: string | null;
  messages: Array<{
    role: string;
    content: string;
  }>;
  signal?: AbortSignal;
}

export class CodexSessionTitleGenerator {
  constructor(private readonly options: CodexSessionTitleGeneratorOptions) {}

  async generate(input: GenerateCodexSessionTitleInput): Promise<string | null> {
    const runtime = await this.readOpenAiRuntimeConfig();
    const transcript = renderTitleTranscript(input.messages);

    if (!transcript) {
      return null;
    }

    const userPrompt = [
      `当前标题：${input.currentTitle?.trim() || "无"}`,
      "",
      "请生成一个比当前标题更具体的会话名。",
      "如果内容是子 Agent 分工，请把负责范围和交付物写进标题。",
      "",
      "会话内容：",
      transcript
    ].join("\n");
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${runtime.apiKey}`
    };

    const response = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["responses", "v1/responses"],
      init: {
        method: "POST",
        headers,
        signal: input.signal,
        body: JSON.stringify({
          model: runtime.model,
          reasoning: { effort: "low" },
          max_output_tokens: 80,
          input: [
            {
              role: "system",
              content: TITLE_SYSTEM_PROMPT
            },
            {
              role: "user",
              content: userPrompt
            }
          ]
        })
      }
    });
    const body = await parseJsonResponse(response);

    if (response.ok) {
      const title = sanitizeGeneratedTitle(extractOpenAiResponseText(body));
      if (title) {
        return title;
      }
    }

    const fallbackResponse = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["v1/chat/completions", "chat/completions"],
      init: {
        method: "POST",
        headers,
        signal: input.signal,
        body: JSON.stringify({
          model: runtime.model,
          max_tokens: 80,
          messages: [
            {
              role: "system",
              content: TITLE_SYSTEM_PROMPT
            },
            {
              role: "user",
              content: userPrompt
            }
          ]
        })
      }
    });
    const fallbackBody = await parseJsonResponse(fallbackResponse);

    if (!fallbackResponse.ok) {
      throw createUpstreamError("CODEX_TITLE_GENERATE_FAILED", fallbackBody, fallbackResponse.status);
    }

    return sanitizeGeneratedTitle(extractOpenAiResponseText(fallbackBody));
  }

  private async readOpenAiRuntimeConfig(): Promise<OpenAiRuntimeConfig> {
    const injectedConfig = await this.readLightweightRuntimeConfigFile();
    const auth = await readJsonFile<Record<string, unknown>>(
      path.join(this.options.codexHomeDir, "auth.json")
    );
    const toml = await safeReadTextFile(path.join(this.options.codexHomeDir, "config.toml"));
    const parsed = parseCodexTomlConfig(toml);
    const apiKey = pickFirstText(
      process.env.CODINGNS_LIGHTWEIGHT_OPENAI_API_KEY,
      process.env.OPENAI_API_KEY,
      injectedConfig?.openai?.apiKey,
      String(auth?.OPENAI_API_KEY ?? "")
    );
    const baseUrl = normalizeBaseUrl(
      pickFirstText(
        process.env.CODINGNS_LIGHTWEIGHT_OPENAI_BASE_URL,
        injectedConfig?.openai?.baseUrl,
        process.env.OPENAI_BASE_URL,
        parsed.baseUrl,
        "https://api.openai.com/v1"
      ) ?? "https://api.openai.com/v1"
    );
    const model =
      pickFirstText(
        process.env.CODINGNS_CODEX_TITLE_OPENAI_MODEL,
        process.env.CODINGNS_LIGHTWEIGHT_OPENAI_MODEL,
        injectedConfig?.openai?.model,
        process.env.OPENAI_MODEL,
        parsed.model,
        DEFAULT_CODEX_TITLE_MODEL
      ) ?? DEFAULT_CODEX_TITLE_MODEL;

    if (!apiKey) {
      throw new AppError({
        statusCode: 500,
        errorCode: "CODEX_TITLE_AUTH_MISSING",
        detail: `未找到 Codex 标题生成可用的 API key。请检查 ${path.join(this.options.codexHomeDir, "auth.json")} 或 lightweight-runtime.json。`
      });
    }

    return {
      apiKey,
      baseUrl,
      model
    };
  }

  private async readLightweightRuntimeConfigFile(): Promise<LightweightRuntimeConfigFile | null> {
    const content = await safeReadTextFile(path.join(this.options.hostDataRootDir, "lightweight-runtime.json"));

    if (!content) {
      return null;
    }

    try {
      const parsed = JSON.parse(content) as LightweightRuntimeConfigFile | null;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      throw new AppError({
        statusCode: 500,
        errorCode: "LIGHTWEIGHT_RUNTIME_CONFIG_INVALID",
        detail: "事务轻量会话配置文件不是合法 JSON"
      });
    }
  }
}

function renderTitleTranscript(messages: GenerateCodexSessionTitleInput["messages"]): string {
  const lines = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const content = message.content.trim().replace(/\s+/g, " ");
      if (!content) {
        return null;
      }
      const role = message.role === "assistant" ? "助手" : "用户";
      return `${role}：${content.slice(0, 600)}`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 12);

  return lines.join("\n").slice(0, 4_000);
}

function sanitizeGeneratedTitle(value: string | null): string | null {
  const firstLine = value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const title = firstLine
    ?.replace(/^[-*\d.、\s]*(?:标题|会话名|名称)\s*[:：]\s*/i, "")
    .replace(/^["'“”‘’「」《》]+|["'“”‘’「」《》。.!！?？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) {
    return null;
  }

  return title.length > CODEX_GENERATED_TITLE_MAX_LENGTH
    ? title.slice(0, CODEX_GENERATED_TITLE_MAX_LENGTH)
    : title;
}

async function postJsonWithFallbacks(input: {
  baseUrl: string;
  pathCandidates: string[];
  init: RequestInit;
}): Promise<Response> {
  let lastResponse: Response | null = null;

  for (const candidate of input.pathCandidates) {
    const response = await fetch(buildRequestUrl(input.baseUrl, candidate), input.init);

    if (response.status !== 404) {
      return response;
    }

    lastResponse = response;
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw new AppError({
    statusCode: 502,
    errorCode: "CODEX_TITLE_RUNTIME_UNREACHABLE",
    detail: "Codex 标题生成上游地址不可达"
  });
}

function extractOpenAiResponseText(body: any): string | null {
  return normalizeText(body?.output_text)
    ?? extractOpenAiOutputText(body?.output)
    ?? extractOpenAiChoiceText(body);
}

function extractOpenAiOutputText(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  const segments: string[] = [];

  for (const item of output) {
    const content = Array.isArray((item as any)?.content) ? (item as any).content : [];

    for (const part of content) {
      const text = normalizeText((part as any)?.text);
      if (text) {
        segments.push(text);
      }
    }
  }

  return segments.length > 0 ? segments.join("\n") : null;
}

function extractOpenAiChoiceText(body: any): string | null {
  const rawContent = body?.choices?.[0]?.message?.content;

  if (typeof rawContent === "string") {
    return normalizeText(rawContent);
  }

  if (!Array.isArray(rawContent)) {
    return null;
  }

  const segments = rawContent
    .map((item) => typeof item === "string" ? item : normalizeText(item?.text))
    .filter((item): item is string => Boolean(item));

  return segments.length > 0 ? segments.join("\n") : null;
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function createUpstreamError(code: string, body: any, status: number): AppError {
  return new AppError({
    statusCode: 502,
    errorCode: code,
    detail:
      normalizeText(body?.error?.message)
      || normalizeText(body?.error?.detail)
      || normalizeText(body?.detail)
      || normalizeText(body?.raw)
      || `标题生成接口返回 ${status}`
  });
}

async function safeReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await safeReadTextFile(filePath);
  if (!content) {
    return {} as T;
  }
  return JSON.parse(content) as T;
}

function parseCodexTomlConfig(content: string | null): { model: string | null; baseUrl: string | null } {
  if (!content) {
    return { model: null, baseUrl: null };
  }

  const model = matchTomlString(content, /^model\s*=\s*"([^"]+)"/m);
  const providerId = matchTomlString(content, /^model_provider\s*=\s*"([^"]+)"/m);

  if (!providerId) {
    return { model, baseUrl: null };
  }

  const marker = `[model_providers.${providerId}]`;
  const quotedMarker = `[model_providers.${JSON.stringify(providerId).slice(1, -1)}]`;
  const sectionStart = content.indexOf(marker) >= 0
    ? content.indexOf(marker)
    : content.indexOf(quotedMarker);

  if (sectionStart < 0) {
    return { model, baseUrl: null };
  }

  const nextSection = content.indexOf("\n[", sectionStart + marker.length);
  const section = nextSection >= 0 ? content.slice(sectionStart, nextSection) : content.slice(sectionStart);
  return {
    model,
    baseUrl: matchTomlString(section, /^base_url\s*=\s*"([^"]+)"/m)
  };
}

function matchTomlString(content: string, pattern: RegExp): string | null {
  return content.match(pattern)?.[1]?.trim() || null;
}

function pickFirstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildRequestUrl(baseUrl: string, candidate: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${candidate.replace(/^\/+/, "")}`;
}
