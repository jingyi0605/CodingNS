#!/usr/bin/env node

import process from "node:process";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "codingns-workspace-office",
  version: "0.1.0"
};

const TOOL_DEFINITIONS = [
  defineTool("office_document_create", "创建当前工作区文档任务", {
    workspaceId: optionalStringSchema("工作区 ID。工作区会话一般不需要显式传。"),
    title: requiredStringSchema("文档标题"),
    templateId: optionalStringSchema("模板 ID"),
    templateKey: optionalStringSchema("模板 Key"),
    summary: optionalStringSchema("摘要"),
    content: optionalObjectSchema("文档内容 JSON"),
    outline: optionalObjectSchema("文档大纲 JSON")
  }),
  defineTool("office_document_update", "更新当前工作区文档", {
    documentId: requiredStringSchema("文档 ID"),
    title: optionalStringSchema("文档标题"),
    templateId: optionalStringSchema("模板 ID"),
    summary: optionalStringSchema("摘要"),
    status: optionalEnumSchema(["draft", "reviewing", "published", "archived"], "文档状态"),
    content: optionalObjectSchema("文档内容 JSON"),
    outline: optionalObjectSchema("文档大纲 JSON")
  }),
  defineTool("office_document_export", "导出当前工作区文档", {
    documentId: requiredStringSchema("文档 ID"),
    workspaceId: optionalStringSchema("工作区 ID"),
    format: optionalEnumSchema(["docx", "pdf", "md"], "导出格式"),
    riskLevel: optionalEnumSchema(["low", "medium", "high"], "风险等级"),
    execute: optionalBooleanSchema("是否立即执行")
  }),
  defineTool("office_document_task_get", "读取文档任务回执", {
    taskId: requiredStringSchema("任务 ID")
  }),
  defineTool("office_browser_profile_list", "列出当前工作区可用浏览器 Profile", {
    workspaceId: optionalStringSchema("工作区 ID")
  }),
  defineTool("office_browser_profile_create", "创建浏览器 Profile", {
    workspaceId: optionalStringSchema("工作区 ID"),
    engine: optionalEnumSchema(["chrome", "edge"], "浏览器引擎"),
    mode: optionalEnumSchema(["persistent", "cdp_attached"], "运行模式"),
    displayName: optionalStringSchema("展示名称"),
    ownershipScope: optionalEnumSchema(["user", "workspace"], "归属范围"),
    cdpEndpoint: optionalStringSchema("CDP 地址")
  }),
  defineTool("office_browser_profile_get", "读取浏览器 Profile 详情", {
    profileId: requiredStringSchema("Profile ID")
  }),
  defineTool("office_browser_task_create", "创建浏览器任务", {
    profileId: requiredStringSchema("Profile ID"),
    workspaceId: optionalStringSchema("工作区 ID"),
    title: optionalStringSchema("任务标题"),
    riskLevel: optionalEnumSchema(["low", "medium", "high"], "风险等级"),
    execute: optionalBooleanSchema("是否立即执行"),
    input: requiredObjectSchema("浏览器任务输入 JSON")
  }),
  defineTool("office_browser_task_get", "读取浏览器任务回执", {
    taskId: requiredStringSchema("任务 ID")
  }),
  defineTool("office_ops_target_list", "列出当前工作区运维目标", {
    workspaceId: optionalStringSchema("工作区 ID"),
    kind: optionalEnumSchema(["ssh_host", "web_console"], "目标类型"),
    status: optionalEnumSchema(["active", "disabled", "error"], "目标状态")
  }),
  defineTool("office_ops_target_create", "创建当前工作区运维目标", {
    workspaceId: optionalStringSchema("工作区 ID"),
    displayName: requiredStringSchema("展示名称"),
    kind: optionalEnumSchema(["ssh_host", "web_console"], "目标类型"),
    environment: optionalStringSchema("环境标记"),
    credentialRef: optionalStringSchema("凭据引用"),
    config: optionalObjectSchema("目标配置 JSON")
  }),
  defineTool("office_ops_target_get", "读取运维目标详情", {
    targetId: requiredStringSchema("目标 ID")
  }),
  defineTool("office_ops_ssh_task_create", "创建 SSH 运维任务", {
    targetId: requiredStringSchema("目标 ID"),
    title: optionalStringSchema("任务标题"),
    riskLevel: optionalEnumSchema(["low", "medium", "high"], "风险等级"),
    execute: optionalBooleanSchema("是否立即执行"),
    input: optionalObjectSchema("SSH 任务输入 JSON"),
    confirm: optionalBooleanSchema("确认执行高风险动作")
  }),
  defineTool("office_ops_browser_task_create", "创建浏览器运维任务", {
    targetId: requiredStringSchema("目标 ID"),
    profileId: requiredStringSchema("浏览器 Profile ID"),
    title: optionalStringSchema("任务标题"),
    riskLevel: optionalEnumSchema(["low", "medium", "high"], "风险等级"),
    input: optionalObjectSchema("浏览器运维任务输入 JSON"),
    confirm: optionalBooleanSchema("确认执行高风险动作")
  }),
  defineTool("office_ops_task_get", "读取运维任务回执", {
    taskId: requiredStringSchema("任务 ID")
  }),
  defineTool("office_ops_task_execute", "执行待确认运维任务", {
    taskId: requiredStringSchema("任务 ID"),
    confirm: optionalBooleanSchema("确认执行")
  })
];

const TOOL_HANDLERS = {
  office_document_create: {
    method: "POST",
    path: "/api/assistant/office/documents",
    buildBody: (argumentsObject) => ({
      workspaceId: normalizeNullableString(argumentsObject.workspaceId),
      title: requireStringField(argumentsObject, "title"),
      templateId: normalizeNullableString(argumentsObject.templateId),
      templateKey: normalizeNullableString(argumentsObject.templateKey),
      summary: normalizeNullableString(argumentsObject.summary),
      content: normalizeNullableObject(argumentsObject.content),
      outline: normalizeNullableObject(argumentsObject.outline)
    })
  },
  office_document_update: {
    method: "PATCH",
    path: (argumentsObject) =>
      `/api/assistant/office/documents/${encodeURIComponent(requireStringField(argumentsObject, "documentId"))}`,
    buildBody: (argumentsObject) => ({
      title: normalizeNullableString(argumentsObject.title),
      templateId: normalizeNullableString(argumentsObject.templateId),
      summary: normalizeNullableString(argumentsObject.summary),
      status: normalizeNullableString(argumentsObject.status),
      content: normalizeNullableObject(argumentsObject.content),
      outline: normalizeNullableObject(argumentsObject.outline)
    })
  },
  office_document_export: {
    method: "POST",
    path: (argumentsObject) =>
      `/api/assistant/office/documents/${encodeURIComponent(requireStringField(argumentsObject, "documentId"))}/export`,
    buildBody: (argumentsObject) => ({
      workspaceId: normalizeNullableString(argumentsObject.workspaceId),
      format: normalizeNullableString(argumentsObject.format),
      riskLevel: normalizeNullableString(argumentsObject.riskLevel),
      execute: normalizeNullableBoolean(argumentsObject.execute)
    })
  },
  office_document_task_get: {
    method: "GET",
    path: (argumentsObject) =>
      `/api/assistant/office/document-tasks/${encodeURIComponent(requireStringField(argumentsObject, "taskId"))}`
  },
  office_browser_profile_list: {
    method: "GET",
    path: "/api/assistant/office/browser/profiles",
    buildQuery: (argumentsObject) => ({
      workspaceId: normalizeNullableString(argumentsObject.workspaceId)
    })
  },
  office_browser_profile_create: {
    method: "POST",
    path: "/api/assistant/office/browser/profiles",
    buildBody: (argumentsObject) => ({
      workspaceId: normalizeNullableString(argumentsObject.workspaceId),
      engine: normalizeNullableString(argumentsObject.engine),
      mode: normalizeNullableString(argumentsObject.mode),
      displayName: normalizeNullableString(argumentsObject.displayName),
      ownershipScope: normalizeNullableString(argumentsObject.ownershipScope),
      cdpEndpoint: normalizeNullableString(argumentsObject.cdpEndpoint)
    })
  },
  office_browser_profile_get: {
    method: "GET",
    path: (argumentsObject) =>
      `/api/assistant/office/browser/profiles/${encodeURIComponent(requireStringField(argumentsObject, "profileId"))}`
  },
  office_browser_task_create: {
    method: "POST",
    path: "/api/assistant/office/browser/tasks",
    buildBody: (argumentsObject) => ({
      profileId: requireStringField(argumentsObject, "profileId"),
      workspaceId: normalizeNullableString(argumentsObject.workspaceId),
      title: normalizeNullableString(argumentsObject.title),
      riskLevel: normalizeNullableString(argumentsObject.riskLevel),
      execute: normalizeNullableBoolean(argumentsObject.execute),
      input: requireObjectField(argumentsObject, "input")
    })
  },
  office_browser_task_get: {
    method: "GET",
    path: (argumentsObject) =>
      `/api/assistant/office/browser/tasks/${encodeURIComponent(requireStringField(argumentsObject, "taskId"))}`
  },
  office_ops_target_list: {
    method: "GET",
    path: "/api/assistant/office/ops/targets",
    buildQuery: (argumentsObject) => ({
      workspaceId: normalizeNullableString(argumentsObject.workspaceId),
      kind: normalizeNullableString(argumentsObject.kind),
      status: normalizeNullableString(argumentsObject.status)
    })
  },
  office_ops_target_create: {
    method: "POST",
    path: "/api/assistant/office/ops/targets",
    buildBody: (argumentsObject) => ({
      workspaceId: normalizeNullableString(argumentsObject.workspaceId),
      displayName: requireStringField(argumentsObject, "displayName"),
      kind: normalizeNullableString(argumentsObject.kind),
      environment: normalizeNullableString(argumentsObject.environment),
      credentialRef: normalizeNullableString(argumentsObject.credentialRef),
      config: normalizeNullableObject(argumentsObject.config)
    })
  },
  office_ops_target_get: {
    method: "GET",
    path: (argumentsObject) =>
      `/api/assistant/office/ops/targets/${encodeURIComponent(requireStringField(argumentsObject, "targetId"))}`
  },
  office_ops_ssh_task_create: {
    method: "POST",
    path: "/api/assistant/office/ops/ssh-tasks",
    buildBody: (argumentsObject) => ({
      targetId: requireStringField(argumentsObject, "targetId"),
      title: normalizeNullableString(argumentsObject.title),
      riskLevel: normalizeNullableString(argumentsObject.riskLevel),
      execute: normalizeNullableBoolean(argumentsObject.execute),
      input: normalizeNullableObject(argumentsObject.input),
      confirm: normalizeNullableBoolean(argumentsObject.confirm)
    })
  },
  office_ops_browser_task_create: {
    method: "POST",
    path: "/api/assistant/office/ops/browser-tasks",
    buildBody: (argumentsObject) => ({
      targetId: requireStringField(argumentsObject, "targetId"),
      profileId: requireStringField(argumentsObject, "profileId"),
      title: normalizeNullableString(argumentsObject.title),
      riskLevel: normalizeNullableString(argumentsObject.riskLevel),
      input: normalizeNullableObject(argumentsObject.input),
      confirm: normalizeNullableBoolean(argumentsObject.confirm)
    })
  },
  office_ops_task_get: {
    method: "GET",
    path: (argumentsObject) =>
      `/api/assistant/office/ops/tasks/${encodeURIComponent(requireStringField(argumentsObject, "taskId"))}`
  },
  office_ops_task_execute: {
    method: "POST",
    path: (argumentsObject) =>
      `/api/assistant/office/ops/tasks/${encodeURIComponent(requireStringField(argumentsObject, "taskId"))}/execute`,
    buildBody: (argumentsObject) => ({
      confirm: normalizeNullableBoolean(argumentsObject.confirm)
    })
  }
};

const pendingBuffer = {
  text: "",
  expectedLength: null
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pendingBuffer.text += chunk;
  drainMessages().catch((error) => {
    writeLog("error", `处理 MCP 消息失败：${formatError(error)}`);
  });
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function drainMessages() {
  while (true) {
    const message = readNextMessage();

    if (!message) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (error) {
      await writeMessage({
        jsonrpc: "2.0",
        id: null,
        error: createError(-32700, `JSON 解析失败：${formatError(error)}`)
      });
      continue;
    }

    await handleRpcMessage(parsed);
  }
}

function readNextMessage() {
  while (true) {
    if (pendingBuffer.expectedLength === null) {
      const headerEndIndex = pendingBuffer.text.indexOf("\r\n\r\n");

      if (headerEndIndex === -1) {
        return null;
      }

      const headerText = pendingBuffer.text.slice(0, headerEndIndex);
      const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch) {
        pendingBuffer.text = pendingBuffer.text.slice(headerEndIndex + 4);
        continue;
      }

      pendingBuffer.expectedLength = Number.parseInt(contentLengthMatch[1], 10);
      pendingBuffer.text = pendingBuffer.text.slice(headerEndIndex + 4);
    }

    if (pendingBuffer.expectedLength === null) {
      return null;
    }

    if (Buffer.byteLength(pendingBuffer.text, "utf8") < pendingBuffer.expectedLength) {
      return null;
    }

    const messageBuffer = Buffer.from(pendingBuffer.text, "utf8");
    const payloadBuffer = messageBuffer.subarray(0, pendingBuffer.expectedLength);
    const restBuffer = messageBuffer.subarray(pendingBuffer.expectedLength);
    pendingBuffer.text = restBuffer.toString("utf8");
    pendingBuffer.expectedLength = null;
    return payloadBuffer.toString("utf8");
  }
}

async function handleRpcMessage(message) {
  const method = typeof message?.method === "string" ? message.method : null;

  if (!method) {
    if (message?.id !== undefined) {
      await writeMessage({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: createError(-32600, "缺少 method")
      });
    }
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    await writeMessage({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {}
    });
    return;
  }

  if (method === "initialize") {
    await writeMessage({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: SERVER_INFO
      }
    });
    return;
  }

  if (method === "tools/list") {
    await writeMessage({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        tools: TOOL_DEFINITIONS
      }
    });
    return;
  }

  if (method === "tools/call") {
    await handleToolCall(message);
    return;
  }

  await writeMessage({
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: createError(-32601, `不支持的方法：${method}`)
  });
}

async function handleToolCall(message) {
  const toolName = typeof message?.params?.name === "string" ? message.params.name : "";
  const handler = TOOL_HANDLERS[toolName];

  if (!handler) {
    await writeMessage({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: createError(-32601, `未找到工具：${toolName}`)
    });
    return;
  }

  const argumentsObject = isPlainObject(message?.params?.arguments) ? message.params.arguments : {};

  try {
    const response = await executeTool(handler, argumentsObject);
    await writeMessage({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    });
  } catch (error) {
    await writeMessage({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: createError(-32000, formatError(error))
    });
  }
}

async function executeTool(handler, argumentsObject) {
  const baseUrl = resolveRequiredEnv("CODINGNS_OFFICE_MCP_BASE_URL");
  const accessToken = resolveRequiredEnv("CODINGNS_OFFICE_MCP_ACCESS_TOKEN");
  const url = new URL(typeof handler.path === "function" ? handler.path(argumentsObject) : handler.path, baseUrl);
  const requestInit = {
    method: handler.method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "X-CodingNS-Assistant-Source": "workspace-office-mcp"
    }
  };

  if (typeof handler.buildQuery === "function") {
    const query = handler.buildQuery(argumentsObject);
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  if (handler.method !== "GET" && typeof handler.buildBody === "function") {
    requestInit.body = JSON.stringify(handler.buildBody(argumentsObject));
  }

  const response = await fetch(url, requestInit);
  const text = await response.text();
  let parsed = null;

  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        raw: text
      };
    }
  }

  if (!response.ok) {
    const detail =
      typeof parsed?.detail === "string"
        ? parsed.detail
        : typeof parsed?.errorMessage === "string"
          ? parsed.errorMessage
          : text.trim() || `HTTP ${response.status}`;
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  return parsed;
}

async function writeMessage(message) {
  const payload = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function createError(code, message) {
  return {
    code,
    message
  };
}

function defineTool(name, description, properties) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      additionalProperties: false
    }
  };
}

function requiredStringSchema(description) {
  return {
    type: "string",
    description
  };
}

function optionalStringSchema(description) {
  return {
    type: ["string", "null"],
    description
  };
}

function optionalBooleanSchema(description) {
  return {
    type: ["boolean", "null"],
    description
  };
}

function optionalObjectSchema(description) {
  return {
    type: ["object", "null"],
    description
  };
}

function requiredObjectSchema(description) {
  return {
    type: "object",
    description
  };
}

function optionalEnumSchema(values, description) {
  return {
    type: ["string", "null"],
    enum: [...values, null],
    description
  };
}

function requireStringField(source, field) {
  const value = source?.[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`字段 ${field} 必须是非空字符串`);
  }

  return value.trim();
}

function requireObjectField(source, field) {
  const value = source?.[field];

  if (!isPlainObject(value)) {
    throw new Error(`字段 ${field} 必须是对象`);
  }

  return value;
}

function normalizeNullableString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeNullableObject(value) {
  return isPlainObject(value) ? value : null;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }

  return value;
}

function writeLog(level, message) {
  process.stderr.write(`[workspace-office-mcp][${level}] ${message}\n`);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
