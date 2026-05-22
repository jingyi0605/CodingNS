import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileContentService, FileOperationType } from "./file-content-service.js";
import type { FilePreviewLinkService } from "./file-preview-link-service.js";
import type { FilePreviewService } from "./file-preview-service.js";
import { isResourcePreviewKind } from "./file-preview-types.js";
import type { FileSearchService } from "./file-search-service.js";
import type { FileTreeService } from "./file-tree-service.js";
import type { RecentFileService } from "./recent-file-service.js";
import type {
  WorkspaceFileBridgeListDirOptions,
  WorkspaceFileBridgeService,
  WorkspaceFileBridgeWriteTextOptions,
  WorkspaceFileBridgeDeleteFileOptions
} from "./workspace-file-bridge-service.js";
import type { WorkspaceFileBridgeWatchDirOptions } from "./workspace-file-bridge-watch-service.js";

interface FileWorkspaceQuery {
  workspaceId?: string;
  path?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
  limit?: string;
}

interface SaveFileBody {
  workspaceId?: string;
  path?: string;
  content?: string;
  expectedVersion?: string;
}

interface UploadFileBody {
  workspaceId?: string;
  path?: string;
  contentBase64?: string;
}

interface FileOperationBody {
  workspaceId?: string;
  opType?: FileOperationType;
  srcPath?: string;
  dstPath?: string;
  content?: string;
}

interface PublicFilePreviewParams {
  "*": string;
}

interface WorkspaceBridgeQuery extends FileWorkspaceQuery {}

interface WorkspaceBridgeListDirBody {
  workspaceId?: string;
  path?: string;
  options?: WorkspaceFileBridgeListDirOptions;
}

interface WorkspaceBridgeReadTextBody {
  workspaceId?: string;
  path?: string;
}

interface WorkspaceBridgeReadTextsBody {
  workspaceId?: string;
  paths?: string[];
}

interface WorkspaceBridgeWriteTextBody {
  workspaceId?: string;
  path?: string;
  content?: string;
  options?: WorkspaceFileBridgeWriteTextOptions;
}

interface WorkspaceBridgeDeleteFileBody {
  workspaceId?: string;
  path?: string;
  options?: WorkspaceFileBridgeDeleteFileOptions;
}

interface WorkspaceBridgeWatchDirBody {
  workspaceId?: string;
  path?: string;
  options?: WorkspaceFileBridgeWatchDirOptions;
}

interface WorkspaceBridgeDesktopActionBody {
  workspaceId?: string;
  path?: string;
}

interface WorkspaceBridgeUnwatchBody {
  watchId?: string;
}

interface WorkspaceBridgePollWatchQuery {
  watchId?: string;
  cursor?: string;
}

export class FileController {
  constructor(
    private readonly fileTreeService: FileTreeService,
    private readonly fileContentService: FileContentService,
    private readonly fileSearchService: FileSearchService,
    private readonly recentFileService: RecentFileService,
    private readonly filePreviewService: FilePreviewService,
    private readonly filePreviewLinkService: FilePreviewLinkService,
    private readonly workspaceFileBridgeService: WorkspaceFileBridgeService
  ) {}

  readonly getTree = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireWorkspaceId(request.query.workspaceId);

    reply.send({
      items: this.fileTreeService.list(
        workspaceId,
        request.query.path,
        Number(request.query.limit ?? "200")
      )
    });
  };

  readonly getContent = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.fileContentService.readFile(
        requireWorkspaceId(request.query.workspaceId),
        request.query.path ?? "",
        requireUserId(request)
      )
    );
  };

  readonly saveContent = async (
    request: FastifyRequest<{ Body: SaveFileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const snapshot = this.fileContentService.saveFile({
      workspaceId: requireWorkspaceId(request.body.workspaceId),
      path: request.body.path?.trim() ?? "",
      content: typeof request.body.content === "string" ? request.body.content : "",
      expectedVersion: request.body.expectedVersion,
      userId: requireUserId(request)
    });

    reply.send({
      version: snapshot.version,
      updatedAt: snapshot.updatedAt
    });
  };

  readonly operate = async (
    request: FastifyRequest<{ Body: FileOperationBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const opType = request.body.opType;

    if (!opType) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_FILE_OPERATION",
        detail: "必须提供 opType",
        field: "opType"
      });
    }

    reply.send(
      this.fileContentService.operate({
        workspaceId: requireWorkspaceId(request.body.workspaceId),
        opType,
        srcPath: request.body.srcPath?.trim(),
        dstPath: request.body.dstPath?.trim(),
        content: request.body.content
      })
    );
  };

  readonly upload = async (
    request: FastifyRequest<{ Body: UploadFileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const upload = this.fileContentService.uploadFile({
      workspaceId: requireWorkspaceId(request.body.workspaceId),
      path: request.body.path?.trim() ?? "",
      contentBase64: typeof request.body.contentBase64 === "string" ? request.body.contentBase64 : "",
      userId: requireUserId(request)
    });

    reply.code(201).send(upload);
  };

  readonly download = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.fileContentService.downloadFile(
        requireWorkspaceId(request.query.workspaceId),
        request.query.path ?? "",
        requireUserId(request)
      )
    );
  };

  readonly search = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const keyword = request.query.keyword?.trim();

    if (!keyword) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_QUERY",
        detail: "搜索文件必须提供 keyword",
        field: "keyword"
      });
    }

    reply.send(
      this.fileSearchService.search(
        requireWorkspaceId(request.query.workspaceId),
        keyword,
        Number(request.query.page ?? "1"),
        Number(request.query.pageSize ?? "20")
      )
    );
  };

  readonly getRecent = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.recentFileService.list(
        requireWorkspaceId(request.query.workspaceId),
        requireUserId(request),
        Number(request.query.limit ?? "10")
      )
    });
  };

  readonly preview = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireWorkspaceId(request.query.workspaceId);
    const filePath = request.query.path ?? "";
    const preview = this.filePreviewService.preview(
      workspaceId,
      filePath,
      requireUserId(request)
    );

    if (preview.supported && isResourcePreviewKind(preview.kind)) {
      const previewLink = this.filePreviewLinkService.createLink(
        workspaceId,
        filePath,
        requireUserId(request)
      );
      preview.previewPath = previewLink.previewPath;
      preview.previewUrl = buildAbsolutePreviewUrl(request, previewLink.previewPath);
    }

    reply.send(preview);
  };

  readonly createPreviewLink = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const previewLink = this.filePreviewLinkService.createLink(
      requireWorkspaceId(request.query.workspaceId),
      request.query.path ?? "",
      requireUserId(request)
    );

    reply.send({
      ...previewLink,
      previewUrl: buildAbsolutePreviewUrl(request, previewLink.previewPath)
    });
  };

  readonly getWorkspaceBridgeCapabilities = async (
    request: FastifyRequest<{ Querystring: WorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireWorkspaceId(request.query.workspaceId);
    reply.send(this.workspaceFileBridgeService.getCapabilities());
  };

  readonly workspaceBridgeListDir = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeListDirBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.listDir(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path,
        request.body.options
      )
    );
  };

  readonly workspaceBridgeReadText = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeReadTextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.readText(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly workspaceBridgeReadTexts = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeReadTextsBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.readTexts(
        requireWorkspaceId(request.body.workspaceId),
        Array.isArray(request.body.paths) ? request.body.paths : []
      )
    );
  };

  readonly workspaceBridgeWriteText = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeWriteTextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.writeText(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path?.trim() ?? "",
        typeof request.body.content === "string" ? request.body.content : "",
        request.body.options
      )
    );
  };

  readonly workspaceBridgeDeleteFile = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeDeleteFileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.deleteFile(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path?.trim() ?? "",
        request.body.options
      )
    );
  };

  readonly workspaceBridgeStat = async (
    request: FastifyRequest<{ Querystring: WorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.stat(
        requireWorkspaceId(request.query.workspaceId),
        request.query.path
      )
    );
  };

  readonly workspaceBridgeExists = async (
    request: FastifyRequest<{ Querystring: WorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.exists(
        requireWorkspaceId(request.query.workspaceId),
        request.query.path
      )
    );
  };

  readonly workspaceBridgeOpenFile = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.prepareOpenWorkspaceFile(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly workspaceBridgeRevealInFileManager = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.prepareRevealWorkspaceFile(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly workspaceBridgeWatchDir = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeWatchDirBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.workspaceFileBridgeService.watchDir(
        requireWorkspaceId(request.body.workspaceId),
        request.body.path,
        request.body.options
      )
    );
  };

  readonly workspaceBridgeUnwatch = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeUnwatchBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const watchId = request.body.watchId?.trim() ?? "";

    if (!watchId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WATCH_ID",
        detail: "必须提供 watchId",
        field: "watchId"
      });
    }

    reply.send(this.workspaceFileBridgeService.unwatch(watchId));
  };

  readonly workspaceBridgePollWatch = async (
    request: FastifyRequest<{ Querystring: WorkspaceBridgePollWatchQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const watchId = request.query.watchId?.trim() ?? "";

    if (!watchId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WATCH_ID",
        detail: "必须提供 watchId",
        field: "watchId"
      });
    }

    const rawCursor = request.query.cursor?.trim() ?? "";
    const cursor = rawCursor ? Number(rawCursor) : undefined;

    reply.send(
      this.workspaceFileBridgeService.pollWatchEvents(
        watchId,
        typeof cursor === "number" && Number.isFinite(cursor) ? cursor : undefined
      )
    );
  };

  readonly publicPreview = async (
    request: FastifyRequest<{ Params: PublicFilePreviewParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { token, filePath } = parsePublicPreviewPath(request.params["*"] ?? "");
    const previewFile = this.filePreviewLinkService.resolvePublicFile(
      token,
      filePath
    );

    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(previewFile.contentType);
    if (previewFile.contentType.startsWith("text/html")) {
      reply.send(
        injectWorkspaceBridgeRuntime(
          readFileSync(previewFile.absolutePath, "utf8")
        )
      );
      return;
    }

    reply.send(readFileSync(previewFile.absolutePath));
  };

  readonly workspaceBridgeRuntime = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.header("Cache-Control", "no-cache");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type("text/javascript; charset=utf-8");
    reply.send(readFileSync(resolveWorkspaceBridgeRuntimePath(), "utf8"));
  };
}

function parsePublicPreviewPath(rawPath: string): {
  token: string;
  filePath: string;
} {
  const [tokenSegment, ...fileSegments] = rawPath.split("/");
  const token = tokenSegment?.trim() ?? "";
  const filePath = decodePreviewPath(fileSegments);

  if (!token || !filePath) {
    throw new AppError({
      statusCode: 401,
      errorCode: "FILE_PREVIEW_TOKEN_INVALID",
      detail: "预览链接无效，请重新打开文件预览"
    });
  }

  return {
    token,
    filePath
  };
}

function decodePreviewPath(fileSegments: string[]): string {
  return fileSegments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new AppError({
          statusCode: 401,
          errorCode: "FILE_PREVIEW_TOKEN_INVALID",
          detail: "预览链接无效，请重新打开文件预览"
        });
      }
    })
    .join("/");
}

function buildAbsolutePreviewUrl(request: FastifyRequest, previewPath: string): string {
  const protocol = resolveRequestProtocol(request);
  const host = resolveRequestHost(request);

  return buildPreviewUrl(`${protocol}://${host}`, previewPath);
}

function buildPreviewUrl(baseUrl: string, previewPath: string): string {
  return new URL(previewPath, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function resolveRequestProtocol(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim()
    || request.protocol
    || "http"
  );
}

function resolveRequestHost(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
    || request.headers.host
    || "127.0.0.1"
  );
}

function requireWorkspaceId(workspaceId: string | undefined): string {
  const safeWorkspaceId = workspaceId?.trim();

  if (!safeWorkspaceId) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "必须提供 workspaceId",
      field: "workspaceId"
    });
  }

  return safeWorkspaceId;
}

function requireUserId(request: FastifyRequest): string {
  const userId = request.auth?.user.userId;

  if (!userId) {
    throw new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "当前请求缺少有效登录态"
    });
  }

  return userId;
}

function injectWorkspaceBridgeRuntime(html: string): string {
  const runtimeSnippet = [
    "<script>",
    "window.__CODINGNS_WORKSPACE_BRIDGE_BOOTSTRAP__ = { runtimeScriptPath: '/preview/runtime/codingns-workspace-bridge.js' };",
    "</script>",
    "<script src=\"/preview/runtime/codingns-workspace-bridge.js\"></script>"
  ].join("");

  if (html.includes("/preview/runtime/codingns-workspace-bridge.js")) {
    return html;
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${runtimeSnippet}</head>`);
  }

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${runtimeSnippet}`);
  }

  return `${runtimeSnippet}${html}`;
}

function resolveWorkspaceBridgeRuntimePath(): string {
  return fileURLToPath(new URL("./runtime/codingns-workspace-bridge.js", import.meta.url));
}
