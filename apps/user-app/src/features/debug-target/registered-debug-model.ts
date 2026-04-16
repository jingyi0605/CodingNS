import {
  type DebugLaunchPlanDto,
  type DebugLaunchPlanServiceItemDto,
} from "../conversation/api/conversation-api";
import {
  type TerminalTemplateDto,
  type TerminalTemplateRuntimeStatusDto
} from "../terminal/api/terminal-api";
import { t } from "../../shared/i18n";

export type RegisteredLaunchDecision = "runnable" | "orchestrated" | "blocked";

export interface RegisteredLaunchPlanItem {
  template: TerminalTemplateDto;
  runtimeStatus: TerminalTemplateRuntimeStatusDto | null;
  planItem: DebugLaunchPlanServiceItemDto | null;
  decision: RegisteredLaunchDecision;
  assignedPort: number | null;
  reason: string;
}

export interface RegisteredLaunchPlan {
  generatedAt: string;
  autoStartAllowed: boolean;
  runnableCount: number;
  orchestratedCount: number;
  blockedCount: number;
  items: RegisteredLaunchPlanItem[];
}

export function buildRegisteredLaunchPlan(
  templates: TerminalTemplateDto[],
  runtimeStatuses: TerminalTemplateRuntimeStatusDto[],
  launchPlan?: DebugLaunchPlanDto | null
): RegisteredLaunchPlan {
  const runtimeStatusByTemplateId = new Map(runtimeStatuses.map((item) => [item.templateId, item] as const));
  const launchPlanByTemplateId = new Map(
    (launchPlan?.services ?? []).map((item) => [item.serviceId, item] as const)
  );
  const portCount = new Map<number, number>();

  for (const template of templates) {
    if (template.port === null) {
      continue;
    }

    portCount.set(template.port, (portCount.get(template.port) ?? 0) + 1);
  }

  const items = templates.map<RegisteredLaunchPlanItem>((template) => {
    const runtimeStatus = runtimeStatusByTemplateId.get(template.id) ?? null;
    const planItem = launchPlanByTemplateId.get(template.id) ?? null;

    if (planItem) {
      const decision: RegisteredLaunchDecision = planItem.autoStartAllowed
        ? (planItem.leasedPort !== null && planItem.leasedPort !== template.port ? "orchestrated" : "runnable")
        : "blocked";

      return {
        template,
        runtimeStatus,
        planItem,
        decision,
        assignedPort: planItem.leasedPort,
        reason: formatLaunchPlanReason(template, planItem)
      };
    }

    if (template.port === null) {
      return {
        template,
        runtimeStatus,
        planItem: null,
        decision: "blocked",
        assignedPort: null,
        reason: t("shell.workspaceDetailRegisteredDebugPlanReasonPortMissing")
      };
    }

    if ((portCount.get(template.port) ?? 0) > 1 || runtimeStatus?.occupied) {
      return {
        template,
        runtimeStatus,
        planItem: null,
        decision: "orchestrated",
        assignedPort: template.port,
        reason: (portCount.get(template.port) ?? 0) > 1
          ? t("shell.workspaceDetailRegisteredDebugPlanReasonDuplicatePortWillOrchestrate")
          : t("shell.workspaceDetailRegisteredDebugPlanReasonPortOccupiedWillOrchestrate")
      };
    }

    return {
      template,
      runtimeStatus,
      planItem: null,
      decision: "runnable",
      assignedPort: template.port,
      reason: t("shell.workspaceDetailRegisteredDebugPlanReasonRunnable")
    };
  });
  const runnableCount = items.filter((item) => item.decision === "runnable").length;
  const orchestratedCount = items.filter((item) => item.decision === "orchestrated").length;
  const blockedCount = items.filter((item) => item.decision === "blocked").length;

  return {
    generatedAt: launchPlan?.runtimeSession.createdAt ?? new Date().toISOString(),
    autoStartAllowed: launchPlan?.autoStartAllowed ?? (items.length > 0 && blockedCount === 0),
    runnableCount,
    orchestratedCount,
    blockedCount,
    items
  };
}

function isRegisteredLaunchPlanReady(plan: RegisteredLaunchPlan): boolean {
  return plan.autoStartAllowed && plan.blockedCount === 0;
}

export function resolveRegisteredOverallTone(
  plan: RegisteredLaunchPlan,
  templateCount: number
): "success" | "warn" | "danger" {
  if (templateCount === 0) {
    return "danger";
  }

  return isRegisteredLaunchPlanReady(plan) ? "success" : "warn";
}

export function formatRegisteredOverallStatus(plan: RegisteredLaunchPlan, templateCount: number): string {
  if (templateCount === 0) {
    return t("shell.workspaceDetailRegisteredDebugOverallStatusEmpty");
  }

  return isRegisteredLaunchPlanReady(plan)
    ? t("shell.workspaceDetailRegisteredDebugOverallStatusReady")
    : t("shell.workspaceDetailRegisteredDebugOverallStatusPartial");
}

export function formatRegisteredOverallSummary(plan: RegisteredLaunchPlan, templateCount: number): string {
  if (templateCount === 0) {
    return t("shell.workspaceDetailRegisteredDebugTemplatesEmpty");
  }

  return t("shell.workspaceDetailRegisteredDebugOverallSummary", {
    runnable: plan.runnableCount,
    orchestrated: plan.orchestratedCount,
    blocked: plan.blockedCount
  });
}

export function buildTemplateCommandPreview(template: TerminalTemplateDto): string {
  const args = template.args.join(" ").trim();
  return args ? `${template.command} ${args}` : template.command;
}

export function formatTemplatePath(templatePath: string, workspacePath: string): string {
  const normalizedWorkspacePath = workspacePath.replace(/[\\/]+$/, "");

  if (templatePath === normalizedWorkspacePath) {
    return ".";
  }

  if (templatePath.startsWith(`${normalizedWorkspacePath}/`)) {
    return templatePath.slice(normalizedWorkspacePath.length + 1);
  }

  if (templatePath.startsWith(`${normalizedWorkspacePath}\\`)) {
    return templatePath.slice(normalizedWorkspacePath.length + 1);
  }

  return templatePath;
}

export function formatRegisteredPort(port: number | null): string {
  return port === null ? t("shell.workspaceDetailRegisteredDebugTemplatePortMissing") : String(port);
}

export function formatRegisteredDateTime(value: string | null): string {
  if (!value) {
    return t("shell.workspaceDetailDebugPortEmpty");
  }

  const time = new Date(value);

  if (Number.isNaN(time.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(time);
}

export function resolveTemplateRuntimeTone(
  template: TerminalTemplateDto,
  runtimeStatus: TerminalTemplateRuntimeStatusDto | null
): "success" | "warn" | "danger" | undefined {
  if (template.port === null) {
    return undefined;
  }

  return runtimeStatus?.occupied ? "warn" : "success";
}

export function formatTemplateRuntimeStatus(
  template: TerminalTemplateDto,
  runtimeStatus: TerminalTemplateRuntimeStatusDto | null
): string {
  if (template.port === null) {
    return t("shell.workspaceDetailRegisteredDebugTemplateStatusUntracked");
  }

  return runtimeStatus?.occupied
    ? t("shell.workspaceDetailRegisteredDebugTemplateStatusOccupied")
    : t("shell.workspaceDetailRegisteredDebugTemplateStatusIdle");
}

export function formatRuntimeProcessSummary(runtimeStatus: TerminalTemplateRuntimeStatusDto | null): string {
  if (!runtimeStatus?.occupied) {
    return t("shell.workspaceDetailRegisteredDebugRuntimeIdle");
  }

  if (runtimeStatus.processId && runtimeStatus.processName) {
    return `PID ${runtimeStatus.processId} · ${runtimeStatus.processName}`;
  }

  if (runtimeStatus.processId) {
    return `PID ${runtimeStatus.processId}`;
  }

  return runtimeStatus.processName ?? t("shell.workspaceDetailRegisteredDebugRuntimeUnknown");
}

export function formatRuntimeReason(
  template: TerminalTemplateDto,
  runtimeStatus: TerminalTemplateRuntimeStatusDto | null
): string {
  if (template.port === null) {
    return t("shell.workspaceDetailRegisteredDebugPlanReasonPortMissing");
  }

  if (runtimeStatus?.occupied) {
    return t("shell.workspaceDetailRegisteredDebugPlanReasonPortOccupiedWillOrchestrate");
  }

  return t("shell.workspaceDetailRegisteredDebugPlanReasonRunnable");
}

export function formatLaunchDecision(decision: RegisteredLaunchDecision): string {
  switch (decision) {
    case "runnable":
      return t("shell.workspaceDetailRegisteredDebugPlanActionStart");
    case "orchestrated":
      return t("shell.workspaceDetailRegisteredDebugPlanActionOrchestrated");
    default:
      return t("shell.workspaceDetailRegisteredDebugPlanActionBlocked");
  }
}

function formatLaunchPlanReason(
  template: TerminalTemplateDto,
  planItem: DebugLaunchPlanServiceItemDto
): string {
  if (planItem.missingRequirements.length > 0) {
    return planItem.missingRequirements
      .map((item) => formatLaunchPlanMissingRequirement(item))
      .join("；");
  }

  if (planItem.aiFallback?.eligible) {
    return planItem.aiFallback.reason;
  }

  if (planItem.leasedPort !== null && planItem.leasedPort !== template.port) {
    return t("shell.workspaceDetailRegisteredDebugPlanReasonPortOrchestrated", {
      port: planItem.leasedPort
    });
  }

  if (Object.keys(planItem.envPatch).length > 0) {
    return t("shell.workspaceDetailRegisteredDebugPlanReasonServiceDiscoveryInjected");
  }

  return t("shell.workspaceDetailRegisteredDebugPlanReasonRunnable");
}

function formatLaunchPlanMissingRequirement(requirement: string): string {
  switch (requirement) {
    case "analysis":
      return t("shell.workspaceDetailRegisteredDebugPlanReasonAnalysisMissing");
    case "service_discovery":
      return t("shell.workspaceDetailRegisteredDebugPlanReasonServiceDiscoveryMissing");
    case "callback":
      return t("shell.workspaceDetailRegisteredDebugPlanReasonCallbackMissing");
    case "port":
      return t("shell.workspaceDetailRegisteredDebugPlanReasonPortMissing");
    default:
      return requirement;
  }
}
