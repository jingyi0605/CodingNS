import { describe, expect, it, vi } from "vitest";

import { logAffairsIndexerRss } from "../../../src/modules/affairs-indexer/core/src/utils/rss-log.js";

describe("logAffairsIndexerRss", () => {
  it("默认 info 级别不输出 RSS 调试日志", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logAffairsIndexerRss({ logLevel: "info" }, "index.parse_progress", {
      scannedCount: 1,
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("debug 级别才输出 RSS 调试日志", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logAffairsIndexerRss({ logLevel: "debug" }, "index.parse_progress", {
      scannedCount: 2,
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [payload] = errorSpy.mock.calls[0] ?? [];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(String(payload))).toEqual(expect.objectContaining({
      source: "affairs_library.helper_rss",
      stage: "index.parse_progress",
      scannedCount: 2,
    }));
  });
});
