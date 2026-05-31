import fs from "node:fs";
import readline from "node:readline";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import { CatalogRepository } from "../../repositories/catalog-repository.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_INFO = {
  name: "doc-semantic-index",
  title: "doc-semantic-index Node MCP",
  version: "0.1.0",
};

type JsonObject = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: JsonObject;
}

interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

function writeStdoutMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function makeTextToolResult(text: string, structuredContent?: JsonObject): JsonObject {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
    isError: false,
  };
}

function makeErrorToolResult(message: string, structuredContent?: JsonObject): JsonObject {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
    isError: true,
  };
}

/**
 * 最小 MCP stdio 服务。
 * 当前阶段只实现 initialize / ping / tools/list / tools/call 四类最小读链能力。
 */
export class McpStdioServer {
  private readonly repository: CatalogRepository;
  private initialized = false;

  constructor(private readonly config: RuntimeConfig) {
    this.repository = new CatalogRepository(config.dbPath);
  }

  private listTools(): McpToolDefinition[] {
    return [
      {
        name: "search_documents",
        title: "搜索文档",
        description: "按 query 在 SQLite 元数据中搜索文档，返回路径、标题、摘要与修改时间。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            limit: { type: "number", description: "返回结果数量，默认 10" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_document_context",
        title: "获取文档上下文",
        description: "按 documentId 或 path 查询文档上下文。",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "文档 ID" },
            path: { type: "string", description: "相对路径" },
          },
        },
      },
      {
        name: "browse_tags",
        title: "浏览标签树",
        description: "按 rootType 或 parentPath 浏览标签节点。",
        inputSchema: {
          type: "object",
          properties: {
            rootType: { type: "string", description: "根分类" },
            parentPath: { type: "string", description: "父标签路径" },
          },
        },
      },
      {
        name: "get_index_status",
        title: "查看索引状态",
        description: "读取当前索引目录、导出状态与基础存在性信息。",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  private readIndexStatus(): JsonObject {
    let exportStatus: JsonObject | null = null;
    const statusPath = `${this.config.exportDir}/status.json`;
    if (fs.existsSync(statusPath)) {
      try {
        exportStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as JsonObject;
      } catch {
        exportStatus = {
          parse_error: "status.json 解析失败",
        };
      }
    }

    return {
      rootDir: this.config.rootDir,
      indexDir: this.config.indexDir,
      dbPath: this.config.dbPath,
      exportDir: this.config.exportDir,
      checks: {
        rootDirExists: fs.existsSync(this.config.rootDir),
        indexDirExists: fs.existsSync(this.config.indexDir),
        dbExists: fs.existsSync(this.config.dbPath),
        exportDirExists: fs.existsSync(this.config.exportDir),
      },
      exportStatus,
    };
  }

  private handleToolCall(name: string, args: JsonObject): JsonObject {
    if (name === "search_documents") {
      const query = typeof args.query === "string" ? args.query : "";
      const limit = typeof args.limit === "number" ? args.limit : 10;
      if (!query.trim()) {
        return makeErrorToolResult("search_documents 缺少 query。", { query, limit });
      }
      const result = this.repository.searchDocuments(query, limit);
      return makeTextToolResult(
        `搜索完成，共 ${result.length} 条结果。`,
        { query, limit, results: result },
      );
    }

    if (name === "get_document_context") {
      const documentId = typeof args.documentId === "string" ? args.documentId : undefined;
      const filePath = typeof args.path === "string" ? args.path : undefined;
      if (!documentId && !filePath) {
        return makeErrorToolResult("get_document_context 需要 documentId 或 path。");
      }
      const result = this.repository.getDocumentContext(documentId, filePath);
      return makeTextToolResult(
        result ? "文档上下文查询完成。" : "未找到对应文档。",
        { result },
      );
    }

    if (name === "browse_tags") {
      const rootType = typeof args.rootType === "string" ? args.rootType : undefined;
      const parentPath = typeof args.parentPath === "string" ? args.parentPath : undefined;
      const result = this.repository.browseTags(rootType, parentPath);
      return makeTextToolResult(
        `标签浏览完成，共 ${result.length} 个节点。`,
        { result },
      );
    }

    if (name === "get_index_status") {
      const result = this.readIndexStatus();
      return makeTextToolResult("索引状态读取完成。", result);
    }

    throw this.makeJsonRpcError(-32601, `未知工具：${name}`);
  }

  private makeJsonRpcError(code: number, message: string, id: string | number | null = null): JsonObject {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    };
  }

  private handleRequest(message: JsonRpcRequest): JsonObject | null {
    if (message.jsonrpc !== "2.0") {
      return this.makeJsonRpcError(-32600, "仅支持 JSON-RPC 2.0。", message.id ?? null);
    }

    if (!message.method) {
      return this.makeJsonRpcError(-32600, "缺少 method。", message.id ?? null);
    }

    if (message.method === "notifications/initialized") {
      this.initialized = true;
      return null;
    }

    if (message.method.startsWith("notifications/")) {
      return null;
    }

    if (message.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: MCP_SERVER_INFO,
          instructions: "当前提供最小只读 MCP 工具：search_documents、get_document_context、browse_tags、get_index_status。",
        },
      };
    }

    if (message.method === "ping") {
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {},
      };
    }

    if (!this.initialized) {
      return this.makeJsonRpcError(-32002, "服务器尚未完成 initialized。", message.id ?? null);
    }

    if (message.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          tools: this.listTools(),
        },
      };
    }

    if (message.method === "tools/call") {
      const params = message.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments && typeof params.arguments === "object")
        ? params.arguments as JsonObject
        : {};
      if (!name) {
        return this.makeJsonRpcError(-32602, "tools/call 缺少 name。", message.id ?? null);
      }
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: this.handleToolCall(name, args),
      };
    }

    return this.makeJsonRpcError(-32601, `不支持的方法：${message.method}`, message.id ?? null);
  }

  async run(): Promise<void> {
    const lineReader = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let message: JsonRpcRequest;
      try {
        message = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        writeStdoutMessage(this.makeJsonRpcError(-32700, "无效 JSON。"));
        continue;
      }

      try {
        const response = this.handleRequest(message);
        if (response) {
          writeStdoutMessage(response);
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "未知内部错误";
        writeStdoutMessage(this.makeJsonRpcError(-32603, messageText, message.id ?? null));
      }
    }
  }
}
