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
import type { WorkspaceIndexApplyService } from "./workspace-index-apply-service.js";
import type { RecentFileService } from "./recent-file-service.js";
import type { RecentModifiedFileService } from "./recent-modified-file-service.js";
import type { AffairsLibraryPreviewLinkService } from "../workspace/affairs-library-preview-link-service.js";
import type { OnlyOfficeIntegrationService } from "../office/onlyoffice-integration-service.js";
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
  displayMode?: string;
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

interface PublicWorkspaceBridgeParams {
  token?: string;
}

interface PublicWorkspaceBridgeQuery extends WorkspaceBridgeQuery {
  token?: string;
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

interface WorkspaceBridgeApplyIndexConfigBody {
  workspaceId?: string;
}

export class FileController {
  constructor(
    private readonly fileTreeService: FileTreeService,
    private readonly fileContentService: FileContentService,
    private readonly fileSearchService: FileSearchService,
    private readonly recentFileService: RecentFileService,
    private readonly recentModifiedFileService: RecentModifiedFileService,
    private readonly filePreviewService: FilePreviewService,
    private readonly filePreviewLinkService: FilePreviewLinkService,
    private readonly affairsLibraryPreviewLinkService: AffairsLibraryPreviewLinkService,
    private readonly onlyOfficeIntegrationService: OnlyOfficeIntegrationService,
    private readonly workspaceFileBridgeService: WorkspaceFileBridgeService,
    private readonly workspaceIndexApplyService: WorkspaceIndexApplyService
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

  readonly getRecentModified = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.recentModifiedFileService.list(
        requireWorkspaceId(request.query.workspaceId),
        {
          limit: Number(request.query.limit ?? "10"),
          keyword: request.query.keyword?.trim() ?? null
        }
      )
    });
  };

  readonly preview = async (
    request: FastifyRequest<{ Querystring: FileWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireWorkspaceId(request.query.workspaceId);
    const userId = requireUserId(request);
    const username = request.auth?.user.username ?? userId;
    const filePath = request.query.path ?? "";
    const preview = this.filePreviewService.preview(
      workspaceId,
      filePath,
      userId
    );

    if (preview.supported && preview.kind !== "office" && isResourcePreviewKind(preview.kind)) {
      const previewLink = this.filePreviewLinkService.createLink(
        workspaceId,
        filePath,
        userId
      );
      preview.previewPath = previewLink.previewPath;
      preview.previewUrl = buildAbsolutePreviewUrl(request, previewLink.previewPath);
    }

    if (preview.supported && preview.kind === "office") {
      preview.onlyOffice = this.onlyOfficeIntegrationService.buildWorkspacePreview({
        workspaceId,
        userId,
        username,
        filePath,
        version: preview.version,
        editable: true,
        displayMode: normalizeOnlyOfficeDisplayMode(request.query.displayMode)
      });
      preview.previewUrl = preview.onlyOffice.documentUrl;
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
    this.sendWorkspaceBridgeUnwatch(request.body, reply);
  };

  readonly workspaceBridgePollWatch = async (
    request: FastifyRequest<{ Querystring: WorkspaceBridgePollWatchQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    this.sendWorkspaceBridgePollWatch(request.query, reply);
  };

  readonly previewWorkspaceBridgeCapabilities = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    this.resolvePreviewRequestWorkspaceId(request);
    reply.send(this.workspaceFileBridgeService.getCapabilities());
  };

  readonly previewWorkspaceBridgeListDir = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeListDirBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.listDir(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path,
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeReadText = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeReadTextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.readText(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly previewWorkspaceBridgeReadTexts = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeReadTextsBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.readTexts(
        this.resolvePreviewRequestWorkspaceId(request),
        Array.isArray(request.body.paths) ? request.body.paths : []
      )
    );
  };

  readonly previewWorkspaceBridgeWriteText = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeWriteTextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.writeText(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path?.trim() ?? "",
        typeof request.body.content === "string" ? request.body.content : "",
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeDeleteFile = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeDeleteFileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.deleteFile(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path?.trim() ?? "",
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeStat = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.stat(
        this.resolvePreviewRequestWorkspaceId(request),
        request.query.path
      )
    );
  };

  readonly previewWorkspaceBridgeExists = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.exists(
        this.resolvePreviewRequestWorkspaceId(request),
        request.query.path
      )
    );
  };

  readonly previewWorkspaceBridgeOpenFile = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.prepareOpenWorkspaceFile(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly previewWorkspaceBridgeRevealInFileManager = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.workspaceFileBridgeService.prepareRevealWorkspaceFile(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly previewWorkspaceBridgeWatchDir = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeWatchDirBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.workspaceFileBridgeService.watchDir(
        this.resolvePreviewRequestWorkspaceId(request),
        request.body.path,
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeUnwatch = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeUnwatchBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    this.sendWorkspaceBridgeUnwatch(request.body, reply);
  };

  readonly previewWorkspaceBridgePollWatch = async (
    request: FastifyRequest<{ Querystring: WorkspaceBridgePollWatchQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    this.sendWorkspaceBridgePollWatch(request.query, reply);
  };

  readonly workspaceBridgeApplyIndexConfig = async (
    request: FastifyRequest<{ Body: WorkspaceBridgeApplyIndexConfigBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.workspaceIndexApplyService.applyConfig(
        requireWorkspaceId(request.body.workspaceId)
      )
    );
  };

  readonly previewWorkspaceBridgeApplyIndexConfig = async (
    request: FastifyRequest<{
      Params: PublicWorkspaceBridgeParams;
      Querystring: PublicWorkspaceBridgeQuery;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.workspaceIndexApplyService.applyConfig(
        this.resolvePreviewRequestWorkspaceId(request)
      )
    );
  };

  private resolvePreviewRequestWorkspaceId(
    request: FastifyRequest<{ Params?: PublicWorkspaceBridgeParams; Querystring?: PublicWorkspaceBridgeQuery }>
  ): string {
    const safeToken = (request.query?.token ?? request.params?.token ?? "").trim();

    if (!safeToken) {
      throw new AppError({
        statusCode: 401,
        errorCode: "FILE_PREVIEW_TOKEN_INVALID",
        detail: "预览链接无效，请重新打开文件预览"
      });
    }

    return this.filePreviewLinkService.resolveWorkspaceId(safeToken);
  }

  private sendWorkspaceBridgeUnwatch(
    body: WorkspaceBridgeUnwatchBody,
    reply: FastifyReply
  ): void {
    const watchId = body.watchId?.trim() ?? "";

    if (!watchId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WATCH_ID",
        detail: "必须提供 watchId",
        field: "watchId"
      });
    }

    reply.send(this.workspaceFileBridgeService.unwatch(watchId));
  }

  private sendWorkspaceBridgePollWatch(
    query: WorkspaceBridgePollWatchQuery,
    reply: FastifyReply
  ): void {
    const watchId = query.watchId?.trim() ?? "";

    if (!watchId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WATCH_ID",
        detail: "必须提供 watchId",
        field: "watchId"
      });
    }

    const rawCursor = query.cursor?.trim() ?? "";
    const cursor = rawCursor ? Number(rawCursor) : undefined;

    reply.send(
      this.workspaceFileBridgeService.pollWatchEvents(
        watchId,
        typeof cursor === "number" && Number.isFinite(cursor) ? cursor : undefined
      )
    );
  }

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
          readFileSync(previewFile.absolutePath, "utf8"),
          {
            workspaceId: previewFile.workspaceId,
            hostOrigin: resolveRequestOrigin(request),
            parentOrigin: resolveWorkspaceBridgeParentOrigin(request)
          }
        )
      );
      return;
    }

    reply.send(readFileSync(previewFile.absolutePath));
  };

  readonly publicAffairsPreview = async (
    request: FastifyRequest<{ Params: PublicFilePreviewParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { token, filePath } = parsePublicPreviewPath(request.params["*"] ?? "");
    const previewFile = this.affairsLibraryPreviewLinkService.resolvePublicFile(token, filePath);

    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(previewFile.contentType);
    if (previewFile.contentType.startsWith("text/html")) {
      reply.send(
        injectWorkspaceBridgeRuntime(
          readFileSync(previewFile.absolutePath, "utf8"),
          {
            workspaceId: previewFile.workspaceId,
            hostOrigin: resolveRequestOrigin(request),
            parentOrigin: resolveWorkspaceBridgeParentOrigin(request)
          }
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
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
    reply.header("Surrogate-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type("text/javascript; charset=utf-8");
    reply.send(readFileSync(resolveWorkspaceBridgeRuntimePath(), "utf8"));
  };
}

function normalizeOnlyOfficeDisplayMode(value: string | undefined): "default" | "reading" {
  return value === "reading" ? "reading" : "default";
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

function resolveRequestOrigin(request: FastifyRequest): string {
  return `${resolveRequestProtocol(request)}://${resolveRequestHost(request)}`;
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

function injectWorkspaceBridgeRuntime(
  html: string,
  bootstrap: {
    workspaceId: string;
    hostOrigin: string;
    parentOrigin: string | null;
  }
): string {
  const runtimeVersion = "20260523-workspace-bridge-http-first-v3";
  const runtimeScriptPath = `/preview/runtime/codingns-workspace-bridge.js?v=${runtimeVersion}`;
  const bootstrapScript = JSON.stringify({
    runtimeScriptPath,
    runtimeVersion,
    workspaceId: bootstrap.workspaceId,
    hostOrigin: bootstrap.hostOrigin,
    parentOrigin: bootstrap.parentOrigin ?? ""
  });
  const workspaceIdAttr = escapeHtmlAttribute(bootstrap.workspaceId);
  const hostOriginAttr = escapeHtmlAttribute(bootstrap.hostOrigin);
  const parentOriginAttr = escapeHtmlAttribute(bootstrap.parentOrigin ?? "");
  const runtimeVersionAttr = escapeHtmlAttribute(runtimeVersion);
  const runtimeSnippet = [
    "<script>",
    `window.__CODINGNS_WORKSPACE_BRIDGE_BOOTSTRAP__ = ${bootstrapScript};`,
    "</script>",
    `<script src="${runtimeScriptPath}" data-codingns-workspace-id="${workspaceIdAttr}" data-codingns-host-origin="${hostOriginAttr}" data-codingns-parent-origin="${parentOriginAttr}" data-codingns-runtime-version="${runtimeVersionAttr}"></script>`
  ].join("");

  if (html.includes("/preview/runtime/codingns-workspace-bridge.js")) {
    return html;
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${runtimeSnippet}`);
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolveWorkspaceBridgeParentOrigin(request: FastifyRequest): string | null {
  const fromQuery = readOriginFromPreviewQuery(request, "_cns_parent_origin");
  if (fromQuery) {
    return fromQuery;
  }

  const refererHeader = request.headers.referer ?? request.headers.referrer;
  if (typeof refererHeader !== "string" || !refererHeader.trim()) {
    return null;
  }

  try {
    return new URL(refererHeader).origin;
  } catch {
    return null;
  }
}

function readOriginFromPreviewQuery(request: FastifyRequest, key: string): string | null {
  try {
    const requestUrl = new URL(request.raw.url ?? "/", "http://127.0.0.1");
    const candidate = requestUrl.searchParams.get(key)?.trim();
    if (!candidate) {
      return null;
    }
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}
