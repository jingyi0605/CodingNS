import { spawnSync } from "node:child_process";

import { resolveCommandLaunch } from "./command-launch.js";

const VERSION_COMMAND_ARGUMENTS: string[][] = [["--version"], ["-V"], ["version"]];
const VERSION_PATTERN = /\bv?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?\b/;

export function resolveCommandVersion(commandPath: string): string | null {
  for (const args of VERSION_COMMAND_ARGUMENTS) {
    const launch = resolveCommandLaunch(commandPath, args);
    const result = spawnSync(launch.command, launch.args, {
      encoding: "utf8",
      timeout: 1_500,
      windowsHide: true,
      shell: launch.shell
    });
    const version = parseCommandVersionOutput(result.stdout, result.stderr);

    if (version) {
      return version;
    }
  }

  return null;
}

function parseCommandVersionOutput(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();

  if (!output) {
    return null;
  }

  return output.match(VERSION_PATTERN)?.[0] ?? null;
}
