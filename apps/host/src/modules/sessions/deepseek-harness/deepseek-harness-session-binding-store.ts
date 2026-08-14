import path from "node:path";

export interface DeepSeekHarnessSessionBinding {
  codingnsSessionId: string;
  harnessSessionId: string;
  userId: string;
  workspaceId: string;
  workspacePath: string;
  rawStoreRef: string;
  harnessVersion: string;
  lastEventSeq: number;
  status: "idle" | "running" | "interrupted" | "failed" | "unavailable";
}

export interface WorkspaceBindingResolver {
  resolve(workspaceId: string, userId: string): Promise<{ workspacePath: string; userId?: string } | null>;
}

/** 轻量绑定存储。正式持久化沿用 session index；这里集中做用户、工作区和 sidecar 归属校验。 */
export class DeepSeekHarnessSessionBindingStore {
  private readonly byCodingnsId = new Map<string, DeepSeekHarnessSessionBinding>();
  private readonly byHarnessId = new Map<string, DeepSeekHarnessSessionBinding>();

  constructor(private readonly workspaceResolver?: WorkspaceBindingResolver) {}

  async create(input: Omit<DeepSeekHarnessSessionBinding, "rawStoreRef" | "lastEventSeq" | "status"> & { rawStoreRef?: string }): Promise<DeepSeekHarnessSessionBinding> {
    const workspace = await this.resolveWorkspace(input.workspaceId, input.userId, input.workspacePath);
    const existingByCodingns = this.byCodingnsId.get(input.codingnsSessionId);
    const existingByHarness = this.byHarnessId.get(input.harnessSessionId);
    if (existingByCodingns && !sameOwner(existingByCodingns, input)) throw new Error("HARNESS_SESSION_BINDING_CONFLICT");
    if (existingByHarness && !sameOwner(existingByHarness, input)) throw new Error("HARNESS_SESSION_BINDING_CONFLICT");
    if (existingByCodingns) return { ...existingByCodingns };

    const binding: DeepSeekHarnessSessionBinding = {
      codingnsSessionId: input.codingnsSessionId,
      harnessSessionId: input.harnessSessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      workspacePath: workspace,
      rawStoreRef: input.rawStoreRef ?? `harness://${input.harnessVersion}/${input.harnessSessionId}`,
      harnessVersion: input.harnessVersion,
      lastEventSeq: -1,
      status: "idle"
    };
    this.byCodingnsId.set(binding.codingnsSessionId, binding);
    this.byHarnessId.set(binding.harnessSessionId, binding);
    return { ...binding };
  }

  async resolveByCodingnsSession(userId: string, codingnsSessionId: string): Promise<DeepSeekHarnessSessionBinding> {
    const binding = this.byCodingnsId.get(codingnsSessionId);
    if (!binding) throw new Error("SESSION_NOT_FOUND");
    await this.assertAccess(binding, userId);
    return { ...binding };
  }

  async resolveByHarnessSession(userId: string, harnessSessionId: string): Promise<DeepSeekHarnessSessionBinding> {
    const binding = this.byHarnessId.get(harnessSessionId);
    if (!binding) throw new Error("SESSION_NOT_FOUND");
    await this.assertAccess(binding, userId);
    return { ...binding };
  }

  updateEventCursor(codingnsSessionId: string, seq: number, status?: DeepSeekHarnessSessionBinding["status"]): void {
    const binding = this.byCodingnsId.get(codingnsSessionId);
    if (!binding || seq < binding.lastEventSeq) return;
    binding.lastEventSeq = seq;
    if (status) binding.status = status;
  }

  listForUserWorkspace(userId: string, workspacePath: string): DeepSeekHarnessSessionBinding[] {
    const normalized = normalizePath(workspacePath);
    return [...this.byCodingnsId.values()].filter((binding) => binding.userId === userId && normalizePath(binding.workspacePath) === normalized).map((binding) => ({ ...binding }));
  }

  private async resolveWorkspace(workspaceId: string, userId: string, requestedPath: string): Promise<string> {
    const resolved = await this.workspaceResolver?.resolve(workspaceId, userId);
    if (resolved?.userId && resolved.userId !== userId) throw new Error("HARNESS_WORKSPACE_FORBIDDEN");
    const workspacePath = normalizePath(resolved?.workspacePath ?? requestedPath);
    if (!workspacePath) throw new Error("HARNESS_WORKSPACE_FORBIDDEN");
    if (resolved && !isWithinWorkspace(workspacePath, resolved.workspacePath)) throw new Error("HARNESS_WORKSPACE_FORBIDDEN");
    return workspacePath;
  }

  private async assertAccess(binding: DeepSeekHarnessSessionBinding, userId: string): Promise<void> {
    if (binding.userId !== userId) throw new Error("HARNESS_WORKSPACE_FORBIDDEN");
    const resolved = await this.workspaceResolver?.resolve(binding.workspaceId, userId);
    if (resolved && normalizePath(resolved.workspacePath) !== normalizePath(binding.workspacePath)) throw new Error("HARNESS_WORKSPACE_FORBIDDEN");
  }
}

function sameOwner(left: DeepSeekHarnessSessionBinding, right: { userId: string; workspaceId: string }): boolean {
  return left.userId === right.userId && left.workspaceId === right.workspaceId;
}

function normalizePath(value: string): string {
  const normalized = path.win32.isAbsolute(value)
    ? path.win32.normalize(value)
    : path.resolve(value);
  return normalized.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function isWithinWorkspace(candidate: string, workspacePath: string): boolean {
  const root = normalizePath(workspacePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}
