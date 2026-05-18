import { nowIso } from "./time.js";

const INSTALLED_FLAG = Symbol.for("codingns.host.consoleTimestampPrefixInstalled");

type ConsoleMethodName = "debug" | "info" | "log" | "warn" | "error";

export function installConsoleTimestampPrefix(): void {
  const globalState = globalThis as typeof globalThis & {
    [INSTALLED_FLAG]?: boolean;
  };

  if (globalState[INSTALLED_FLAG]) {
    return;
  }

  globalState[INSTALLED_FLAG] = true;

  const methods: ConsoleMethodName[] = ["debug", "info", "log", "warn", "error"];

  methods.forEach((methodName) => {
    const original = console[methodName].bind(console);

    console[methodName] = ((...args: unknown[]) => {
      original(...prefixConsoleArgs(args));
    }) as Console[ConsoleMethodName];
  });
}

function prefixConsoleArgs(args: unknown[]): unknown[] {
  const timestamp = `[${nowIso()}]`;

  if (args.length === 0) {
    return [timestamp];
  }

  const [first, ...rest] = args;

  if (typeof first === "string") {
    return [`${timestamp} ${first}`, ...rest];
  }

  return [timestamp, first, ...rest];
}
