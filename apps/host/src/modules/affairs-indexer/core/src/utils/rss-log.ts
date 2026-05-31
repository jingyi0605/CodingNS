export function logAffairsIndexerRss(
  stage: string,
  extra: Record<string, unknown> = {}
): void {
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
