import { describe, expect, it } from "vitest";

import { t } from "../../shared/i18n";
import { buildRegisteredLaunchPlan, formatRegisteredOverallStatus } from "./registered-debug-model";

describe("registered-debug-model", () => {
  it("整体状态会跟 autoStartAllowed 保持一致，并把编排项单独计数", () => {
    const plan = buildRegisteredLaunchPlan(
      [
        {
          id: "template-web",
          workspaceId: "workspace-1",
          name: "web",
          cwd: "/repo/project-one/apps/web",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 43000,
          proxyEnabled: true,
          proxySlug: "web",
          runtimeType: "node",
          sourceType: "manual",
          debugTargetId: null,
          debugServiceId: null,
          frameworkAnalysisId: null,
          adapterKind: "cli",
          injectionMode: "cli",
          serviceDiscoveryMode: "api_base_url",
          managedBySystem: false,
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z"
        }
      ],
      [],
      {
        runtimeSession: {
          id: "preview-runtime-1",
          targetId: "debug-target-1",
          status: "PREPARING",
          failureStage: null,
          startedAt: null,
          stoppedAt: null,
          createdAt: "2026-04-16T08:01:00.000Z",
          updatedAt: "2026-04-16T08:01:00.000Z"
        },
        targetId: "debug-target-1",
        autoStartAllowed: false,
        services: [
          {
            serviceId: "template-web",
            role: "frontend",
            frameworkAnalysisId: "analysis-1",
            primaryFramework: "vite",
            compatibilityLevel: "supported",
            adapterKind: "cli",
            injectionMode: "cli",
            command: "pnpm",
            args: ["dev", "--port", "43010"],
            envPatch: {
              VITE_API_BASE_URL: "http://127.0.0.1:44010"
            },
            expectedPort: 43000,
            leasedPort: 43010,
            artifactRef: null,
            runtimeBindingId: "binding-1",
            portLeaseId: null,
            requiresServiceDiscoveryHandling: true,
            requiresHmrHandling: false,
            requiresCallbackHandling: false,
            failureStage: null,
            adapterAttempts: [],
            aiFallback: null,
            missingRequirements: [],
            autoStartAllowed: true
          }
        ]
      }
    );

    expect(plan.runnableCount).toBe(0);
    expect(plan.orchestratedCount).toBe(1);
    expect(plan.blockedCount).toBe(0);
    expect(formatRegisteredOverallStatus(plan, 1)).toBe(t("shell.workspaceDetailRegisteredDebugOverallStatusPartial"));
    expect(plan.items[0]?.reason).toBe(t("shell.workspaceDetailRegisteredDebugPlanReasonPortOrchestrated", {
      port: 43010
    }));
  });

  it("缺少地址联动时会返回用户能看懂的下一步提示", () => {
    const plan = buildRegisteredLaunchPlan(
      [
        {
          id: "template-web",
          workspaceId: "workspace-1",
          name: "web",
          cwd: "/repo/project-one/apps/web",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 43000,
          proxyEnabled: true,
          proxySlug: "web",
          runtimeType: "node",
          sourceType: "manual",
          debugTargetId: null,
          debugServiceId: null,
          frameworkAnalysisId: null,
          adapterKind: "cli",
          injectionMode: "cli",
          serviceDiscoveryMode: "api_base_url",
          managedBySystem: false,
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z"
        }
      ],
      [],
      {
        runtimeSession: {
          id: "preview-runtime-1",
          targetId: "debug-target-1",
          status: "PREPARING",
          failureStage: null,
          startedAt: null,
          stoppedAt: null,
          createdAt: "2026-04-16T08:01:00.000Z",
          updatedAt: "2026-04-16T08:01:00.000Z"
        },
        targetId: "debug-target-1",
        autoStartAllowed: false,
        services: [
          {
            serviceId: "template-web",
            role: "frontend",
            frameworkAnalysisId: "analysis-1",
            primaryFramework: "vite",
            compatibilityLevel: "supported",
            adapterKind: "cli",
            injectionMode: "cli",
            command: "pnpm",
            args: ["dev", "--port", "43010"],
            envPatch: {},
            expectedPort: 43000,
            leasedPort: 43010,
            artifactRef: null,
            runtimeBindingId: "binding-1",
            portLeaseId: null,
            requiresServiceDiscoveryHandling: true,
            requiresHmrHandling: false,
            requiresCallbackHandling: false,
            failureStage: "service_discovery",
            adapterAttempts: [],
            aiFallback: null,
            missingRequirements: ["service_discovery"],
            autoStartAllowed: false
          }
        ]
      }
    );

    expect(plan.items[0]?.reason).toBe(t("shell.workspaceDetailRegisteredDebugPlanReasonServiceDiscoveryMissing"));
  });
});
