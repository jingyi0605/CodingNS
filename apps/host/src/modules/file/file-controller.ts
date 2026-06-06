import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError, isAppError } from "../../shared/errors/app-error.js";
import { hashContent } from "../../shared/utils/hash.js";
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
import type { AffairsLibraryService } from "../workspace/affairs-library-service.js";
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

type PreviewBridgeContext =
  | {
      kind: "workspace";
      workspaceId: string;
    }
  | {
      kind: "affairs_library";
      workspaceId: string;
      userId: string;
      previewPath: string;
    };

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
    private readonly affairsLibraryService: AffairsLibraryService,
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
    this.resolvePreviewBridgeContext(request);
    reply.send(this.workspaceFileBridgeService.getCapabilities());
  };

  readonly previewWorkspaceBridgeListDir = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeListDirBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    if (context.kind === "affairs_library") {
      reply.send(this.listAffairsLibraryBridgeDir(context, request.body.path, request.body.options));
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.listDir(
        context.workspaceId,
        request.body.path,
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeReadText = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeReadTextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    const filePath = request.body.path?.trim() ?? "";
    if (context.kind === "affairs_library") {
      reply.send(this.readAffairsLibraryBridgeText(context, filePath));
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.readText(
        context.workspaceId,
        filePath
      )
    );
  };

  readonly previewWorkspaceBridgeReadTexts = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeReadTextsBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    const paths = Array.isArray(request.body.paths) ? request.body.paths : [];
    if (context.kind === "affairs_library") {
      reply.send({
        items: paths.map((filePath) => {
          const safePath = typeof filePath === "string" ? filePath : "";
          try {
            return this.readAffairsLibraryBridgeText(context, safePath);
          } catch (error) {
            return {
              path: safePath,
              error: toPreviewBridgeErrorShape(error, safePath)
            };
          }
        })
      });
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.readTexts(
        context.workspaceId,
        paths
      )
    );
  };

  readonly previewWorkspaceBridgeWriteText = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeWriteTextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    const filePath = request.body.path?.trim() ?? "";
    if (context.kind === "affairs_library") {
      reply.send(
        this.writeAffairsLibraryBridgeText(
          context,
          filePath,
          typeof request.body.content === "string" ? request.body.content : "",
          request.body.options
        )
      );
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.writeText(
        context.workspaceId,
        filePath,
        typeof request.body.content === "string" ? request.body.content : "",
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeDeleteFile = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeDeleteFileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    const filePath = request.body.path?.trim() ?? "";
    if (context.kind === "affairs_library") {
      const resolvedPath = this.resolveAffairsLibraryBridgePath(context, filePath, {
        mustExist: true,
        kind: "file"
      });
      reply.send(
        this.affairsLibraryService.operateFile(
          context.workspaceId,
          context.userId,
          {
            opType: "delete",
            srcPath: resolvedPath
          }
        )
      );
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.deleteFile(
        context.workspaceId,
        filePath,
        request.body.options
      )
    );
  };

  readonly previewWorkspaceBridgeStat = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    if (context.kind === "affairs_library") {
      reply.send(this.statAffairsLibraryBridgePath(context, request.query.path));
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.stat(
        context.workspaceId,
        request.query.path
      )
    );
  };

  readonly previewWorkspaceBridgeExists = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    if (context.kind === "affairs_library") {
      reply.send({ exists: this.statAffairsLibraryBridgePath(context, request.query.path).exists });
      return;
    }

    reply.send(
      this.workspaceFileBridgeService.exists(
        context.workspaceId,
        request.query.path
      )
    );
  };

  readonly previewWorkspaceBridgeOpenFile = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    if (context.kind === "affairs_library") {
      throw new AppError({
        statusCode: 400,
        errorCode: "DESKTOP_ACTION_NOT_SUPPORTED",
        detail: "事务文档库预览暂不支持通过 workspace bridge 打开本地文件"
      });
    }

    reply.send(
      this.workspaceFileBridgeService.prepareOpenWorkspaceFile(
        context.workspaceId,
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly previewWorkspaceBridgeRevealInFileManager = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    if (context.kind === "affairs_library") {
      throw new AppError({
        statusCode: 400,
        errorCode: "DESKTOP_ACTION_NOT_SUPPORTED",
        detail: "事务文档库预览暂不支持通过 workspace bridge 定位本地文件"
      });
    }

    reply.send(
      this.workspaceFileBridgeService.prepareRevealWorkspaceFile(
        context.workspaceId,
        request.body.path?.trim() ?? ""
      )
    );
  };

  readonly previewWorkspaceBridgeWatchDir = async (
    request: FastifyRequest<{ Params: PublicWorkspaceBridgeParams; Querystring: PublicWorkspaceBridgeQuery; Body: WorkspaceBridgeWatchDirBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const context = this.resolvePreviewBridgeContext(request);
    if (context.kind === "affairs_library") {
      const resolvedPath = this.resolveAffairsLibraryBridgePath(context, request.body.path?.trim() ?? "", {
        mustExist: true,
        kind: "directory",
        allowRoot: true
      });
      const resolved = this.affairsLibraryService.resolvePreviewFile(context.workspaceId, context.userId, resolvedPath, {
        mustExist: true,
        kind: "directory",
        allowRoot: true
      });
      reply.send(
        await this.workspaceFileBridgeService.watchResolvedDir({
          scopeId: buildAffairsLibraryWatchScopeId(context),
          displayWorkspaceId: context.workspaceId,
          basePath: resolved.relativePath,
          absolutePath: resolved.absolutePath,
          options: request.body.options
        })
      );
      return;
    }

    reply.send(
      await this.workspaceFileBridgeService.watchDir(
        context.workspaceId,
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
        this.resolvePreviewBridgeContext(request).workspaceId
      )
    );
  };

  private resolvePreviewBridgeContext(
    request: FastifyRequest<{ Params?: PublicWorkspaceBridgeParams; Querystring?: PublicWorkspaceBridgeQuery }>
  ): PreviewBridgeContext {
    const safeToken = (request.query?.token ?? request.params?.token ?? "").trim();

    if (!safeToken) {
      throw new AppError({
        statusCode: 401,
        errorCode: "FILE_PREVIEW_TOKEN_INVALID",
        detail: "预览链接无效，请重新打开文件预览"
      });
    }

    try {
      const affairsPreview = this.affairsLibraryPreviewLinkService.resolveTokenContext(safeToken);
      return {
        kind: "affairs_library",
        workspaceId: affairsPreview.workspaceId,
        userId: affairsPreview.userId,
        previewPath: affairsPreview.previewPath
      };
    } catch {
      return {
        kind: "workspace",
        workspaceId: this.filePreviewLinkService.resolveWorkspaceId(safeToken)
      };
    }
  }

  private listAffairsLibraryBridgeDir(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    requestedPath: string | undefined,
    options: WorkspaceFileBridgeListDirOptions = {}
  ): { path: string; items: Array<{ name: string; path: string; kind: "file" | "directory"; size: number | null; mtime: number; hidden: boolean }> } {
    const requestedLimit = typeof options.limit === "number" ? options.limit : undefined;
    const resolvedPath = this.resolveAffairsLibraryBridgePath(context, requestedPath?.trim() ?? "", {
      mustExist: true,
      kind: "directory",
      allowRoot: true
    });
    const items = this.affairsLibraryService.listFiles(
      context.workspaceId,
      context.userId,
      resolvedPath || null,
      requestedLimit
    );

    return {
      path: resolvedPath,
      items: items
        .filter((item) => (options.kind && options.kind !== "any" ? item.kind === options.kind : true))
        .map((item) => ({
          name: item.name,
          path: item.path,
          kind: item.kind,
          size: item.size,
          mtime: item.updatedAt ? Date.parse(item.updatedAt) : 0,
          hidden: item.name.startsWith(".")
        }))
    };
  }

  private readAffairsLibraryBridgeText(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    requestedPath: string
  ): { path: string; content: string; mtime: number; size: number } {
    const resolvedPath = this.resolveAffairsLibraryBridgePath(context, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const preview = this.affairsLibraryService.previewDocument(
      context.workspaceId,
      context.userId,
      resolvedPath
    );

    if (!preview.supported || typeof preview.content !== "string") {
      throw new AppError({
        statusCode: 400,
        errorCode: "FILE_PREVIEW_NOT_SUPPORTED",
        detail: preview.reason ?? "当前文件不能通过 workspace bridge 读取",
        field: "path"
      });
    }

    return {
      path: preview.path,
      content: preview.content,
      mtime: preview.updatedAt ? Date.parse(preview.updatedAt) : 0,
      size: preview.size
    };
  }

  private writeAffairsLibraryBridgeText(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    requestedPath: string,
    content: string,
    options: WorkspaceFileBridgeWriteTextOptions | undefined
  ): { path: string; mtime: number; size: number } {
    const normalizedPath = this.resolveAffairsLibraryBridgePath(context, requestedPath.trim(), {
      mustExist: false,
      kind: "file"
    });

    try {
      const current = this.readAffairsLibraryBridgeText(context, normalizedPath);
      if (options?.overwrite === false) {
        throw new AppError({
          statusCode: 409,
          errorCode: "FILE_ALREADY_EXISTS",
          detail: "目标文件已存在",
          field: "path"
        });
      }
      this.affairsLibraryService.operateFile(
        context.workspaceId,
        context.userId,
        {
          opType: "write",
          srcPath: normalizedPath,
          content,
          expectedVersion: hashContent(Buffer.from(current.content, "utf8"))
        }
      );
    } catch (error) {
      if (!isFileNotFoundError(error) || options?.createIfMissing !== true) {
        throw error;
      }
      this.affairsLibraryService.operateFile(
        context.workspaceId,
        context.userId,
        {
          opType: "create_file",
          dstPath: normalizedPath,
          content
        }
      );
    }

    const next = this.readAffairsLibraryBridgeText(context, normalizedPath);
    return {
      path: next.path,
      mtime: next.mtime,
      size: next.size
    };
  }

  private statAffairsLibraryBridgePath(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    requestedPath: string | undefined
  ): { exists: boolean; path: string; name: string; kind: "file" | "directory" | null; size: number | null; mtime: number | null; hidden: boolean } {
    const normalizedPath = requestedPath?.trim() ?? "";

    try {
      const resolvedPath = this.resolveAffairsLibraryBridgePath(context, normalizedPath, {
        mustExist: true,
        kind: "any",
        allowRoot: true
      });
      const resolved = this.affairsLibraryService.resolvePreviewFile(context.workspaceId, context.userId, resolvedPath, {
        mustExist: true,
        kind: "any",
        allowRoot: true
      });
      return {
        exists: true,
        path: resolved.relativePath,
        name: resolved.relativePath ? resolved.relativePath.split("/").pop() ?? resolved.relativePath : "",
        kind: resolved.stats?.isDirectory() ? "directory" : "file",
        size: resolved.stats?.isFile() ? resolved.stats.size : null,
        mtime: resolved.stats ? Math.round(resolved.stats.mtimeMs) : null,
        hidden: resolved.relativePath.split("/").some((segment) => segment.startsWith("."))
      };
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
      return {
        exists: false,
        path: normalizedPath,
        name: normalizedPath.split("/").pop() ?? normalizedPath,
        kind: null,
        size: null,
        mtime: null,
        hidden: normalizedPath.split("/").some((segment) => segment.startsWith("."))
      };
    }
  }

  private resolveAffairsLibraryBridgePath(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    requestedPath: string,
    options: {
      mustExist: boolean;
      kind: "file" | "directory" | "any";
      allowRoot?: boolean;
    }
  ): string {
    const normalizedPath = normalizePreviewBridgeRelativePath(requestedPath, options.allowRoot ?? false);
    const candidates = buildAffairsLibraryBridgePathCandidates(context.previewPath, normalizedPath);

    if (!options.mustExist) {
      const existingCandidate = this.resolveExistingAffairsLibraryBridgePath(context, candidates, {
        kind: options.kind,
        allowRoot: options.allowRoot
      });
      if (existingCandidate) {
        return existingCandidate;
      }

      const candidateWithExistingParent = this.resolveAffairsLibraryBridgePathWithExistingParent(context, candidates);
      if (candidateWithExistingParent) {
        return candidateWithExistingParent;
      }

      return candidates[0] ?? normalizedPath;
    }

    for (const candidate of candidates) {
      try {
        const resolved = this.affairsLibraryService.resolvePreviewFile(context.workspaceId, context.userId, candidate, {
          mustExist: options.mustExist,
          kind: options.kind,
          allowRoot: options.allowRoot
        });
        return resolved.relativePath;
      } catch (error) {
        if (!options.mustExist) {
          throw error;
        }
        if (!isFileNotFoundError(error)) {
          throw error;
        }
      }
    }

    return normalizedPath;
  }

  private resolveExistingAffairsLibraryBridgePath(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    candidates: string[],
    options: {
      kind: "file" | "directory" | "any";
      allowRoot?: boolean;
    }
  ): string | null {
    for (const candidate of candidates) {
      try {
        const resolved = this.affairsLibraryService.resolvePreviewFile(context.workspaceId, context.userId, candidate, {
          mustExist: true,
          kind: options.kind,
          allowRoot: options.allowRoot
        });
        return resolved.relativePath;
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error;
        }
      }
    }

    return null;
  }

  private resolveAffairsLibraryBridgePathWithExistingParent(
    context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>,
    candidates: string[]
  ): string | null {
    for (const candidate of candidates) {
      const parentPath = path.posix.dirname(candidate);
      const safeParentPath = parentPath === "." ? "" : parentPath;
      try {
        this.affairsLibraryService.resolvePreviewFile(context.workspaceId, context.userId, safeParentPath, {
          mustExist: true,
          kind: "directory",
          allowRoot: true
        });
        return candidate;
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error;
        }
      }
    }

    return null;
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

  if (hasInjectedWorkspaceBridgeRuntime(html)) {
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

function hasInjectedWorkspaceBridgeRuntime(html: string): boolean {
  return /<script\b[^>]*\bsrc=(["'])\/preview\/runtime\/codingns-workspace-bridge\.js(?:\?[^"']*)?\1[^>]*>/i.test(html);
}

function isFileNotFoundError(error: unknown): boolean {
  return isAppError(error) && error.errorCode === "FILE_NOT_FOUND";
}

function toPreviewBridgeErrorShape(error: unknown, fallbackPath: string): {
  code: string;
  message: string;
  path?: string;
} {
  if (isAppError(error)) {
    return {
      code: error.errorCode,
      message: error.message,
      path: typeof error.data === "object" && error.data && "path" in error.data
        ? String((error.data as { path?: unknown }).path)
        : fallbackPath
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
      path: fallbackPath
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "未知错误",
    path: fallbackPath
  };
}

function buildAffairsLibraryBridgePathCandidates(previewPath: string, requestedPath: string): string[] {
  const normalizedPreviewPath = normalizePreviewBridgeRelativePath(previewPath, false);
  const normalizedRequestedPath = normalizePreviewBridgeRelativePath(requestedPath, false);
  const candidates = [normalizedRequestedPath];

  const previewDir = path.posix.dirname(normalizedPreviewPath);
  if (!previewDir || previewDir === ".") {
    return uniqueNonEmptyPaths(candidates);
  }

  const previewSegments = previewDir.split("/").filter(Boolean);

  for (let index = previewSegments.length; index > 0; index -= 1) {
    const prefix = previewSegments.slice(0, index).join("/");
    if (prefix) {
      candidates.push(path.posix.join(prefix, normalizedRequestedPath));
    }
  }

  return uniqueNonEmptyPaths(candidates);
}

function buildAffairsLibraryWatchScopeId(context: Extract<PreviewBridgeContext, { kind: "affairs_library" }>): string {
  return [
    "affairs-library",
    context.workspaceId,
    context.userId,
    normalizePreviewBridgeRelativePath(context.previewPath, true)
  ].join("::");
}

function normalizePreviewBridgeRelativePath(pathText: string, allowRoot = false): string {
  const normalized = String(pathText ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();

  if (!normalized || normalized === ".") {
    return allowRoot ? "" : normalized;
  }

  return path.posix.normalize(normalized).replace(/^\/+/, "");
}

function uniqueNonEmptyPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of paths) {
    const normalized = normalizePreviewBridgeRelativePath(item, true);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
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
