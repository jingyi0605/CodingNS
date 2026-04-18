import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { hashContent } from "../../shared/utils/hash.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ManagedSkillRecord,
  SkillSourceType,
  SkillScanDiagnostic,
  SkillScanEntry,
  SkillScanResult,
  SkillTargetBindingRecord,
  SkillTargetCli,
  SkillTargetSyncStatus
} from "../../types/domain.js";
import type { ManagedSkillRepository } from "../../storage/repositories/managed-skill-repository.js";
import type { SkillTargetBindingRepository } from "../../storage/repositories/skill-target-binding-repository.js";
import {
  type SkillTargetAdapter,
  resolveSkillTargetLocation
} from "./skill-target-adapter.js";
import {
  type DiscoveredSkillDirectory,
  SkillReconciler
} from "./skill-reconciler.js";
import { SkillSyncPlanner } from "./skill-sync-planner.js";
import {
  getReservedAssistantSkillErrorDetail,
  isReservedAssistantSkillDirectoryName
} from "./skill-name-policy.js";
import { listAssistantRuntimeSkills } from "./assistant-runtime-skill-catalog.js";

export interface ScanSkillsOptions {
  targetCli?: readonly SkillTargetCli[];
}

export interface AddManagedSkillInput {
  sourcePath: string;
  targetCli: readonly SkillTargetCli[];
  sourceType: SkillSourceType;
}

export interface SyncManagedSkillInput {
  skillId: string;
  targetCli: readonly SkillTargetCli[];
}

export interface EnsureBuiltinSkillInput {
  sourcePath: string;
  targetCli: readonly SkillTargetCli[];
}

export interface ImportUnmanagedSkillInput {
  targetCli: SkillTargetCli;
  directoryPath: string;
  expectedContentHash?: string | null;
  additionalTargetCli?: readonly SkillTargetCli[];
}

export interface SkillTargetSyncResult {
  targetCli: SkillTargetCli;
  targetDir: string;
  syncStatus: SkillTargetSyncStatus;
  lastSyncedAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface ManagedSkillMutationResult {
  skill: ManagedSkillRecord;
  bindings: SkillTargetBindingRecord[];
  targetResults: SkillTargetSyncResult[];
  ssotPath: string;
}

export interface ManagedSkillOverviewItem {
  skill: ManagedSkillRecord;
  bindings: SkillTargetBindingRecord[];
  ssotPath: string;
}

export interface AssistantRuntimeSkillOverviewItem {
  name: string;
  directoryName: string;
  sourcePath: string;
  usedByTargetCli: readonly SkillTargetCli[];
}

export interface SkillOverviewResult {
  summary: {
    managedSkillCount: number;
    managedEntryCount: number;
    unmanagedEntryCount: number;
    conflictedEntryCount: number;
    diagnosticCount: number;
  };
  managedSkills: ManagedSkillOverviewItem[];
  assistantRuntimeSkills: AssistantRuntimeSkillOverviewItem[];
  managedEntries: SkillScanResult["managed"];
  unmanagedEntries: SkillScanResult["unmanaged"];
  conflictedEntries: SkillScanResult["conflicted"];
  diagnostics: SkillScanResult["diagnostics"];
  scannedAt: string;
}

export interface SkillManagerServiceOptions {
  ssotRootDir?: string;
  now?: () => string;
  createId?: () => string;
}

export class SkillManagerService {
  constructor(
    private readonly managedSkillRepository: ManagedSkillRepository,
    private readonly skillTargetBindingRepository: SkillTargetBindingRepository,
    private readonly targetAdapters: readonly SkillTargetAdapter[],
    private readonly options: SkillManagerServiceOptions = {},
    private readonly skillSyncPlanner = new SkillSyncPlanner(),
    private readonly skillReconciler = new SkillReconciler()
  ) {}

  scanSkills(options: ScanSkillsOptions = {}): SkillScanResult {
    const targetLocations = resolveTargetLocations(this.targetAdapters, options.targetCli);
    const discoveredDirectories: DiscoveredSkillDirectory[] = [];
    const diagnostics: SkillScanDiagnostic[] = [];

    for (const targetLocation of targetLocations) {
      const scanResult = scanSkillTargetDirectory(targetLocation);

      discoveredDirectories.push(...scanResult.directories);
      diagnostics.push(...scanResult.diagnostics);
    }

    const publicManagedSkills = this.managedSkillRepository
      .list()
      .filter((skill) => !isReservedAssistantSkillDirectoryName(skill.directoryName));
    const bindings = publicManagedSkills.flatMap((skill) =>
      this.skillTargetBindingRepository.listBySkillId(skill.id)
    );
    const reservedDirectories = discoveredDirectories.filter((directory) =>
      isReservedAssistantSkillDirectoryName(directory.directoryName)
    );
    const publicDirectories = discoveredDirectories.filter((directory) =>
      !isReservedAssistantSkillDirectoryName(directory.directoryName)
    );

    const result = this.skillReconciler.reconcile({
      targetLocations,
      directories: publicDirectories,
      managedSkills: publicManagedSkills,
      bindings,
      diagnostics,
      scannedAt: nowIso()
    });

    const reservedDiagnostics = reservedDirectories.map((directory) =>
      createReservedSkillDiagnostic(directory)
    );
    const reservedEntries = reservedDirectories.map((directory) =>
      createReservedSkillScanEntry(directory)
    );

    return {
      managed: result.managed,
      unmanaged: result.unmanaged,
      conflicted: sortSkillScanEntries([...result.conflicted, ...reservedEntries]),
      diagnostics: sortSkillScanDiagnostics([...result.diagnostics, ...reservedDiagnostics]),
      scannedAt: result.scannedAt
    };
  }

  getOverview(options: ScanSkillsOptions = {}): SkillOverviewResult {
    const scanResult = this.scanSkills(options);
    const managedSkills = this.managedSkillRepository
      .list()
      .filter((skill) => !isReservedAssistantSkillDirectoryName(skill.directoryName))
      .map((skill) => ({
        skill,
        bindings: this.skillTargetBindingRepository.listBySkillId(skill.id),
        ssotPath: this.resolveSsotPath(skill.directoryName)
      }));
    const assistantRuntimeSkills = listAssistantRuntimeSkills();

    return {
      summary: {
        managedSkillCount: managedSkills.length,
        managedEntryCount: scanResult.managed.length,
        unmanagedEntryCount: scanResult.unmanaged.length,
        conflictedEntryCount: scanResult.conflicted.length,
        diagnosticCount: scanResult.diagnostics.length
      },
      managedSkills,
      assistantRuntimeSkills,
      managedEntries: scanResult.managed,
      unmanagedEntries: scanResult.unmanaged,
      conflictedEntries: scanResult.conflicted,
      diagnostics: scanResult.diagnostics,
      scannedAt: scanResult.scannedAt
    };
  }

  addManagedSkill(input: AddManagedSkillInput): ManagedSkillMutationResult {
    const sourcePath = resolveSourceDirectoryPath(input.sourcePath);
    const sourceSnapshot = readSkillDirectorySnapshot("codex", sourcePath, sourcePath);
    assertPublicSkillDirectoryNameAllowed(sourceSnapshot.directoryName, "sourcePath");
    const existingSkill = this.managedSkillRepository.findByDirectoryName(sourceSnapshot.directoryName);
    const existingBindings = existingSkill
      ? this.skillTargetBindingRepository.listBySkillId(existingSkill.id)
      : [];
    const plannedTargets = this.skillSyncPlanner.planRequestedTargets(input.targetCli, existingBindings);
    const ssotRootDir = this.requireSsotRootDir();
    const timestamp = this.now();

    if (existingSkill && existingSkill.contentHash !== sourceSnapshot.contentHash) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SKILL_NAME_CONFLICT",
        detail: "已存在同名受管 skill，且内容与当前来源目录不一致",
        field: "sourcePath"
      });
    }

    const skill: ManagedSkillRecord = existingSkill
      ? {
          ...existingSkill,
          name: sourceSnapshot.name,
          sourceType: input.sourceType,
          sourcePath,
          contentHash: sourceSnapshot.contentHash,
          managedState: "active",
          updatedAt: timestamp
        }
      : {
          id: this.createManagedSkillId(),
          name: sourceSnapshot.name,
          directoryName: sourceSnapshot.directoryName,
          sourceType: input.sourceType,
          sourcePath,
          contentHash: sourceSnapshot.contentHash,
          managedState: "active",
          createdAt: timestamp,
          updatedAt: timestamp
        };
    const ssotPath = path.join(ssotRootDir, skill.directoryName);

    copySkillDirectory(sourcePath, ssotPath);
    this.managedSkillRepository.upsert(skill);

    const targetResults = this.syncManagedSkillRecord(skill, plannedTargets.map((target) => target.targetCli));

    return {
      skill,
      bindings: this.skillTargetBindingRepository.listBySkillId(skill.id),
      targetResults,
      ssotPath
    };
  }

  syncManagedSkill(input: SyncManagedSkillInput): ManagedSkillMutationResult {
    const skillId = input.skillId.trim();

    if (!skillId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "skillId 不能为空",
        field: "skillId"
      });
    }

    const skill = this.managedSkillRepository.findById(skillId);

    if (!skill) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SKILL_NOT_FOUND",
        detail: "指定的受管 skill 不存在",
        field: "skillId"
      });
    }

    assertPublicSkillDirectoryNameAllowed(skill.directoryName, "skillId");

    const existingBindings = this.skillTargetBindingRepository.listBySkillId(skill.id);
    const plannedTargets = this.skillSyncPlanner.planRequestedTargets(input.targetCli, existingBindings);
    const targetResults = this.syncManagedSkillRecord(skill, plannedTargets.map((target) => target.targetCli));

    return {
      skill: this.managedSkillRepository.findById(skill.id) ?? skill,
      bindings: this.skillTargetBindingRepository.listBySkillId(skill.id),
      targetResults,
      ssotPath: this.resolveSsotPath(skill.directoryName)
    };
  }

  ensureBuiltinSkill(input: EnsureBuiltinSkillInput): ManagedSkillMutationResult {
    const sourcePath = resolveSourceDirectoryPath(input.sourcePath);
    const sourceSnapshot = readSkillDirectorySnapshot("codex", sourcePath, sourcePath);
    assertPublicSkillDirectoryNameAllowed(sourceSnapshot.directoryName, "sourcePath");
    const existingSkill = this.managedSkillRepository.findByDirectoryName(sourceSnapshot.directoryName);
    const ssotRootDir = this.requireSsotRootDir();
    const timestamp = this.now();

    const skill: ManagedSkillRecord = existingSkill
      ? {
          ...existingSkill,
          name: sourceSnapshot.name,
          sourceType: "builtin",
          sourcePath,
          contentHash: sourceSnapshot.contentHash,
          managedState: "active",
          updatedAt: timestamp
        }
      : {
          id: this.createManagedSkillId(),
          name: sourceSnapshot.name,
          directoryName: sourceSnapshot.directoryName,
          sourceType: "builtin",
          sourcePath,
          contentHash: sourceSnapshot.contentHash,
          managedState: "active",
          createdAt: timestamp,
          updatedAt: timestamp
        };
    const ssotPath = path.join(ssotRootDir, skill.directoryName);

    copySkillDirectory(sourcePath, ssotPath);
    this.managedSkillRepository.upsert(skill);

    const targetResults = this.forceSyncManagedSkillRecord(skill, input.targetCli);

    return {
      skill: this.managedSkillRepository.findById(skill.id) ?? skill,
      bindings: this.skillTargetBindingRepository.listBySkillId(skill.id),
      targetResults,
      ssotPath
    };
  }

  importUnmanagedSkill(input: ImportUnmanagedSkillInput): ManagedSkillMutationResult {
    const sourceLocation = resolveSingleTargetLocation(this.targetAdapters, input.targetCli);
    const directoryPath = path.resolve(input.directoryPath);

    if (!isSubPath(sourceLocation.rootDir, directoryPath)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "SKILL_IMPORT_SOURCE_INVALID",
        detail: "directoryPath 必须位于指定目标 CLI 的 skill 根目录下",
        field: "directoryPath"
      });
    }

    if (!isValidSkillDirectory(directoryPath)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SKILL_IMPORT_SOURCE_MISSING",
        detail: "导入来源目录不存在，或者已经不是合法 skill",
        field: "directoryPath"
      });
    }

    const sourceSnapshot = readSkillDirectorySnapshot(input.targetCli, sourceLocation.rootDir, directoryPath);
    assertPublicSkillDirectoryNameAllowed(sourceSnapshot.directoryName, "directoryPath");

    if (
      input.expectedContentHash
      && input.expectedContentHash.trim()
      && input.expectedContentHash.trim() !== sourceSnapshot.contentHash
    ) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SKILL_IMPORT_CONFLICT",
        detail: "导入来源目录内容已经变化，请重新扫描后再导入",
        field: "directoryPath"
      });
    }

    return this.addManagedSkill({
      sourcePath: directoryPath,
      targetCli: [input.targetCli, ...(input.additionalTargetCli ?? [])],
      sourceType: "managed-copy"
    });
  }

  private syncManagedSkillRecord(
    skill: ManagedSkillRecord,
    targetCli: readonly SkillTargetCli[]
  ): SkillTargetSyncResult[] {
    const ssotPath = this.resolveSsotPath(skill.directoryName);
    const timestamp = this.now();

    if (!isValidSkillDirectory(ssotPath)) {
      this.managedSkillRepository.upsert({
        ...skill,
        managedState: "missing",
        updatedAt: timestamp
      });
      throw new AppError({
        statusCode: 409,
        errorCode: "SKILL_SSOT_MISSING",
        detail: "受管 skill 的 SSOT 目录缺失或不合法"
      });
    }

    const plannedTargets = this.skillSyncPlanner.planRequestedTargets(
      targetCli,
      this.skillTargetBindingRepository.listBySkillId(skill.id)
    );

    return plannedTargets.map((target) => this.syncOneTarget(skill, ssotPath, target.targetCli, timestamp));
  }

  private forceSyncManagedSkillRecord(
    skill: ManagedSkillRecord,
    targetCli: readonly SkillTargetCli[]
  ): SkillTargetSyncResult[] {
    const ssotPath = this.resolveSsotPath(skill.directoryName);
    const timestamp = this.now();

    if (!isValidSkillDirectory(ssotPath)) {
      this.managedSkillRepository.upsert({
        ...skill,
        managedState: "missing",
        updatedAt: timestamp
      });
      throw new AppError({
        statusCode: 409,
        errorCode: "SKILL_SSOT_MISSING",
        detail: "受管 skill 的 SSOT 目录缺失或不合法"
      });
    }

    const plannedTargets = this.skillSyncPlanner.planRequestedTargets(
      targetCli,
      this.skillTargetBindingRepository.listBySkillId(skill.id)
    );

    return plannedTargets.map((target) =>
      this.forceSyncOneTarget(skill, ssotPath, target.targetCli, timestamp)
    );
  }

  private syncOneTarget(
    skill: ManagedSkillRecord,
    ssotPath: string,
    targetCli: SkillTargetCli,
    timestamp: string
  ): SkillTargetSyncResult {
    const targetLocation = resolveSingleTargetLocation(this.targetAdapters, targetCli);
    const targetDir = path.join(targetLocation.rootDir, skill.directoryName);
    const conflictResult = readTargetConflictResult(ssotPath, targetDir);

    if (conflictResult) {
      const binding = buildBindingRecord(skill.id, targetCli, {
        enabled: true,
        syncStatus: "conflicted",
        lastSyncedAt: null,
        lastErrorCode: conflictResult.errorCode,
        lastErrorDetail: conflictResult.errorDetail
      });

      this.skillTargetBindingRepository.upsert(binding);

      return {
        targetCli,
        targetDir,
        syncStatus: "conflicted",
        lastSyncedAt: null,
        errorCode: conflictResult.errorCode,
        errorDetail: conflictResult.errorDetail
      };
    }

    try {
      copySkillDirectory(ssotPath, targetDir);

      const binding = buildBindingRecord(skill.id, targetCli, {
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: timestamp,
        lastErrorCode: null,
        lastErrorDetail: null
      });

      this.skillTargetBindingRepository.upsert(binding);

      return {
        targetCli,
        targetDir,
        syncStatus: "synced",
        lastSyncedAt: timestamp,
        errorCode: null,
        errorDetail: null
      };
    } catch (error) {
      const errorDetail = error instanceof Error ? error.message : String(error);
      const binding = buildBindingRecord(skill.id, targetCli, {
        enabled: true,
        syncStatus: "failed",
        lastSyncedAt: null,
        lastErrorCode: "SKILL_SYNC_FAILED",
        lastErrorDetail: errorDetail
      });

      this.skillTargetBindingRepository.upsert(binding);

      return {
        targetCli,
        targetDir,
        syncStatus: "failed",
        lastSyncedAt: null,
        errorCode: "SKILL_SYNC_FAILED",
        errorDetail
      };
    }
  }

  private forceSyncOneTarget(
    skill: ManagedSkillRecord,
    ssotPath: string,
    targetCli: SkillTargetCli,
    timestamp: string
  ): SkillTargetSyncResult {
    const targetLocation = resolveSingleTargetLocation(this.targetAdapters, targetCli);
    const targetDir = path.join(targetLocation.rootDir, skill.directoryName);

    try {
      copySkillDirectory(ssotPath, targetDir);

      const binding = buildBindingRecord(skill.id, targetCli, {
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: timestamp,
        lastErrorCode: null,
        lastErrorDetail: null
      });

      this.skillTargetBindingRepository.upsert(binding);

      return {
        targetCli,
        targetDir,
        syncStatus: "synced",
        lastSyncedAt: timestamp,
        errorCode: null,
        errorDetail: null
      };
    } catch (error) {
      const errorDetail = error instanceof Error ? error.message : String(error);
      const binding = buildBindingRecord(skill.id, targetCli, {
        enabled: true,
        syncStatus: "failed",
        lastSyncedAt: null,
        lastErrorCode: "SKILL_SYNC_FAILED",
        lastErrorDetail: errorDetail
      });

      this.skillTargetBindingRepository.upsert(binding);

      return {
        targetCli,
        targetDir,
        syncStatus: "failed",
        lastSyncedAt: null,
        errorCode: "SKILL_SYNC_FAILED",
        errorDetail
      };
    }
  }

  private requireSsotRootDir(): string {
    const ssotRootDir = this.options.ssotRootDir?.trim();

    if (!ssotRootDir) {
      throw new AppError({
        statusCode: 500,
        errorCode: "SKILL_STORE_NOT_CONFIGURED",
        detail: "当前 SkillManager 没有配置 SSOT 根目录"
      });
    }

    return path.resolve(ssotRootDir);
  }

  private resolveSsotPath(directoryName: string): string {
    return path.join(this.requireSsotRootDir(), directoryName);
  }

  private createManagedSkillId(): string {
    return this.options.createId?.() ?? createId();
  }

  private now(): string {
    return this.options.now?.() ?? nowIso();
  }
}

function assertPublicSkillDirectoryNameAllowed(directoryName: string, field: string): void {
  if (!isReservedAssistantSkillDirectoryName(directoryName)) {
    return;
  }

  throw new AppError({
    statusCode: 409,
    errorCode: "SKILL_RESERVED_FOR_ASSISTANT_RUNTIME",
    detail: getReservedAssistantSkillErrorDetail(directoryName),
    field
  });
}

function createReservedSkillDiagnostic(directory: DiscoveredSkillDirectory): SkillScanDiagnostic {
  return {
    targetCli: directory.targetCli,
    rootDir: directory.rootDir,
    code: "SKILL_RESERVED_FOR_ASSISTANT_RUNTIME",
    detail: getReservedAssistantSkillErrorDetail(directory.directoryName),
    directoryName: directory.directoryName,
    directoryPath: directory.directoryPath,
    managedSkillId: null
  };
}

function createReservedSkillScanEntry(directory: DiscoveredSkillDirectory): SkillScanEntry {
  return {
    targetCli: directory.targetCli,
    directoryPath: directory.directoryPath,
    directoryName: directory.directoryName,
    name: directory.name,
    contentHash: directory.contentHash,
    managementState: "conflicted",
    managedSkillId: null
  };
}

function sortSkillScanEntries(entries: SkillScanEntry[]): SkillScanEntry[] {
  return entries.sort((left, right) => {
    const targetOrder = left.targetCli.localeCompare(right.targetCli);

    if (targetOrder !== 0) {
      return targetOrder;
    }

    return left.directoryName.localeCompare(right.directoryName);
  });
}

function sortSkillScanDiagnostics(diagnostics: SkillScanDiagnostic[]): SkillScanDiagnostic[] {
  return diagnostics.sort((left, right) => {
    const targetOrder = left.targetCli.localeCompare(right.targetCli);

    if (targetOrder !== 0) {
      return targetOrder;
    }

    const codeOrder = left.code.localeCompare(right.code);

    if (codeOrder !== 0) {
      return codeOrder;
    }

    return (left.directoryName ?? "").localeCompare(right.directoryName ?? "");
  });
}

export function readSkillDirectorySnapshot(
  targetCli: SkillTargetCli,
  rootDir: string,
  directoryPath: string
): DiscoveredSkillDirectory {
  const directoryName = path.basename(directoryPath);
  const skillFilePath = path.join(directoryPath, "SKILL.md");

  if (!fs.existsSync(skillFilePath) || !fs.statSync(skillFilePath).isFile()) {
    throw new Error("SKILL_MARKDOWN_MISSING");
  }

  const skillMarkdown = fs.readFileSync(skillFilePath, "utf8");

  return {
    targetCli,
    rootDir,
    directoryPath,
    directoryName,
    name: extractSkillName(skillMarkdown, directoryName),
    contentHash: computeSkillDirectoryHash(directoryPath)
  };
}

export function computeSkillDirectoryHash(directoryPath: string): string {
  const fileSignatures = collectFileSignatures(directoryPath, directoryPath);

  return hashContent(fileSignatures.join("\n"));
}

export function isValidSkillDirectory(directoryPath: string): boolean {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  if (!fs.statSync(directoryPath).isDirectory()) {
    return false;
  }

  const skillFilePath = path.join(directoryPath, "SKILL.md");
  return fs.existsSync(skillFilePath) && fs.statSync(skillFilePath).isFile();
}

function resolveTargetLocations(
  adapters: readonly SkillTargetAdapter[],
  requestedTargetCli?: readonly SkillTargetCli[]
) {
  const normalizedTargetCli = requestedTargetCli?.length
    ? Array.from(new Set(requestedTargetCli))
    : adapters.map((adapter) => adapter.targetCli);

  try {
    return normalizedTargetCli.map((targetCli) => resolveSkillTargetLocation(adapters, targetCli));
  } catch (error) {
    if (error instanceof Error && error.message === "SKILL_TARGET_NOT_SUPPORTED") {
      throw new AppError({
        statusCode: 400,
        errorCode: "SKILL_TARGET_NOT_SUPPORTED",
        detail: "存在不受支持的 skill 目标"
      });
    }

    throw error;
  }
}

function resolveSingleTargetLocation(
  adapters: readonly SkillTargetAdapter[],
  targetCli: SkillTargetCli
) {
  try {
    return resolveSkillTargetLocation(adapters, targetCli);
  } catch (error) {
    if (error instanceof Error && error.message === "SKILL_TARGET_NOT_SUPPORTED") {
      throw new AppError({
        statusCode: 400,
        errorCode: "SKILL_TARGET_NOT_SUPPORTED",
        detail: "存在不受支持的 skill 目标",
        field: "targetCli"
      });
    }

    throw error;
  }
}

function scanSkillTargetDirectory(targetLocation: { targetCli: SkillTargetCli; rootDir: string }): {
  directories: DiscoveredSkillDirectory[];
  diagnostics: SkillScanDiagnostic[];
} {
  if (!fs.existsSync(targetLocation.rootDir)) {
    return {
      directories: [],
      diagnostics: [
        createDiagnostic(targetLocation, "SKILL_TARGET_ROOT_MISSING", "目标 skill 根目录不存在")
      ]
    };
  }

  let rootStats: fs.Stats;

  try {
    rootStats = fs.statSync(targetLocation.rootDir);
  } catch (error) {
    return {
      directories: [],
      diagnostics: [
        createDiagnostic(
          targetLocation,
          "SKILL_TARGET_STAT_FAILED",
          createErrorDetail("读取目标 skill 根目录状态失败", error)
        )
      ]
    };
  }

  if (!rootStats.isDirectory()) {
    return {
      directories: [],
      diagnostics: [
        createDiagnostic(targetLocation, "SKILL_TARGET_ROOT_INVALID", "目标 skill 根目录不是目录")
      ]
    };
  }

  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(targetLocation.rootDir, { withFileTypes: true });
  } catch (error) {
    return {
      directories: [],
      diagnostics: [
        createDiagnostic(
          targetLocation,
          "SKILL_TARGET_READ_FAILED",
          createErrorDetail("读取目标 skill 根目录失败", error)
        )
      ]
    };
  }

  const directories: DiscoveredSkillDirectory[] = [];
  const diagnostics: SkillScanDiagnostic[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = path.join(targetLocation.rootDir, entry.name);
    const skillFilePath = path.join(directoryPath, "SKILL.md");

    if (!fs.existsSync(skillFilePath) || !fs.statSync(skillFilePath).isFile()) {
      continue;
    }

    try {
      directories.push(
        readSkillDirectorySnapshot(targetLocation.targetCli, targetLocation.rootDir, directoryPath)
      );
    } catch (error) {
      diagnostics.push({
        targetCli: targetLocation.targetCli,
        rootDir: targetLocation.rootDir,
        code: "SKILL_ENTRY_READ_FAILED",
        detail: createErrorDetail(`读取 skill 目录失败：${entry.name}`, error),
        directoryName: entry.name,
        directoryPath,
        managedSkillId: null
      });
    }
  }

  return {
    directories,
    diagnostics
  };
}

function extractSkillName(skillMarkdown: string, fallbackName: string): string {
  const normalizedContent = skillMarkdown.replace(/^\uFEFF/, "");
  const heading = normalizedContent.match(/^#\s+(.+)$/m)?.[1]?.trim();

  if (heading) {
    return heading;
  }

  return fallbackName;
}

function collectFileSignatures(rootDir: string, currentDir: string): string[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const fileSignatures: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      fileSignatures.push(...collectFileSignatures(rootDir, absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));
    const contentHash = hashContent(fs.readFileSync(absolutePath));

    fileSignatures.push(`file:${relativePath}:${contentHash}`);
  }

  return fileSignatures;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function createDiagnostic(
  targetLocation: { targetCli: SkillTargetCli; rootDir: string },
  code: string,
  detail: string
): SkillScanDiagnostic {
  return {
    targetCli: targetLocation.targetCli,
    rootDir: targetLocation.rootDir,
    code,
    detail,
    directoryName: null,
    directoryPath: null,
    managedSkillId: null
  };
}

function createErrorDetail(prefix: string, error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${prefix}: ${error.message}`;
  }

  return prefix;
}

function resolveSourceDirectoryPath(sourcePath: string): string {
  const normalizedPath = sourcePath.trim();

  if (!normalizedPath) {
    throw new AppError({
      statusCode: 400,
      errorCode: "SKILL_SOURCE_INVALID",
      detail: "sourcePath 不能为空",
      field: "sourcePath"
    });
  }

  const resolvedPath = path.resolve(normalizedPath);

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "SKILL_SOURCE_INVALID",
      detail: "sourcePath 必须是一个存在的 skill 目录",
      field: "sourcePath"
    });
  }

  const directoryName = path.basename(resolvedPath);

  if (!isSafeSkillDirectoryName(directoryName)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "SKILL_SOURCE_INVALID",
      detail: "skill 目录名不合法，只允许字母、数字、点、下划线和短横线",
      field: "sourcePath"
    });
  }

  if (!isValidSkillDirectory(resolvedPath)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "SKILL_SOURCE_INVALID",
      detail: "sourcePath 目录缺少 SKILL.md",
      field: "sourcePath"
    });
  }

  return resolvedPath;
}

function isSafeSkillDirectoryName(directoryName: string): boolean {
  return directoryName !== "." && directoryName !== ".." && /^[A-Za-z0-9._-]+$/.test(directoryName);
}

function readTargetConflictResult(
  ssotPath: string,
  targetDir: string
): { errorCode: string; errorDetail: string } | null {
  if (!fs.existsSync(targetDir)) {
    return null;
  }

  if (!fs.statSync(targetDir).isDirectory()) {
    return {
      errorCode: "SKILL_NAME_CONFLICT",
      errorDetail: "目标路径已存在同名文件，不能写入 skill 目录"
    };
  }

  if (!isValidSkillDirectory(targetDir)) {
    return {
      errorCode: "SKILL_NAME_CONFLICT",
      errorDetail: "目标 CLI 目录里已存在同名目录，但它不是合法 skill"
    };
  }

  if (computeSkillDirectoryHash(targetDir) === computeSkillDirectoryHash(ssotPath)) {
    return null;
  }

  return {
    errorCode: "SKILL_NAME_CONFLICT",
    errorDetail: "目标 CLI 目录里已存在同名 skill，且内容与受管 skill 不一致"
  };
}

function copySkillDirectory(sourcePath: string, targetPath: string): void {
  const resolvedSourcePath = path.resolve(sourcePath);
  const resolvedTargetPath = path.resolve(targetPath);

  if (resolvedSourcePath === resolvedTargetPath) {
    return;
  }

  fs.rmSync(resolvedTargetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(resolvedTargetPath), { recursive: true });
  fs.cpSync(resolvedSourcePath, resolvedTargetPath, { recursive: true });
}

function buildBindingRecord(
  skillId: string,
  targetCli: SkillTargetCli,
  input: {
    enabled: boolean;
    syncStatus: SkillTargetSyncStatus;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    lastErrorDetail: string | null;
  }
): SkillTargetBindingRecord {
  return {
    skillId,
    targetCli,
    enabled: input.enabled,
    syncStatus: input.syncStatus,
    lastSyncedAt: input.lastSyncedAt,
    lastErrorCode: input.lastErrorCode,
    lastErrorDetail: input.lastErrorDetail
  };
}

function isSubPath(parentPath: string, childPath: string): boolean {
  const resolvedParentPath = path.resolve(parentPath);
  const resolvedChildPath = path.resolve(childPath);
  const relativePath = path.relative(resolvedParentPath, resolvedChildPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
