import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();

  return {
    ...actual,
    spawn: spawnMock
  };
});

vi.mock("node:readline", () => {
  const createInterface = ({ input }: { input: EventEmitter }) => {
    return {
      on: input.on.bind(input),
      close: vi.fn()
    };
  };

  return {
    createInterface,
    default: {
      createInterface
    }
  };
});

import { CodexAppServerHelperClient } from "../../src/modules/sessions/codex-app-server-helper-client.js";

class MockWritable extends EventEmitter {
  destroyed = false;

  write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
    callback?.(null);
    return true;
  }

  end(): void {
    this.destroyed = true;
  }
}

class MockChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = new MockWritable();
  killed = false;

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
}

describe("CodexAppServerHelperClient", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("transport_closed 会透传给 transport 的 close handler", async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);

    const client = new CodexAppServerHelperClient("/mock/codex");
    const transport = client.createTransport();
    const closeHandler = vi.fn();

    transport.setOnClose(closeHandler);

    child.stdout.emit("line", JSON.stringify({
      type: "transport_closed",
      transportId: "1",
      detail: "codex app-server exited with code 1"
    }));

    await Promise.resolve();

    expect(closeHandler).toHaveBeenCalledTimes(1);
    expect(closeHandler.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(closeHandler.mock.calls[0]?.[0]?.message).toBe("codex app-server exited with code 1");
  });
});
