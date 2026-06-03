import type { RuntimeConfig } from "../../../contracts/src/index.js";

export function logAffairsIndexerRss(
  config: Pick<RuntimeConfig, "logLevel">,
  stage: string,
  extra: Record<string, unknown> = {}
): void {
  if (config.logLevel !== "debug") {
    return;
  }

  try {
    const rssBytes = process.memoryUsage.rss();
    console.error(
      JSON.stringify({
        source: "affairs_library.helper_rss",
        stage,
        rssBytes,
        rssMb: Number((rssBytes / 1024 / 1024).toFixed(2)),
        ...extra
      })
    );
  } catch {
    // RSS 观测失败不影响主流程。
  }
}
