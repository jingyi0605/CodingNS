import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface FakeTailscaleState {
  backendState: "Running" | "NeedsLogin" | "Stopped" | "Starting";
  hostname: string | null;
  accountName: string | null;
  tailnetName?: string | null;
  fqdn: string | null;
  ipv4: string | null;
  ipv6: string | null;
  loginUrl: string;
  lastError: string | null;
}

export function createFakeTailscaleCli(rootDir: string): {
  cliPath: string;
  statePath: string;
} {
  mkdirSync(rootDir, { recursive: true });
  const statePath = path.join(rootDir, "fake-tailscale-state.json");
  const cliPath = path.join(rootDir, "fake-tailscale.js");

  writeFakeTailscaleState(statePath, {
    backendState: "NeedsLogin",
    hostname: null,
    accountName: null,
    tailnetName: null,
    fqdn: null,
    ipv4: null,
    ipv6: null,
    loginUrl: "https://login.tailscale.test/device/abc123",
    lastError: null
  });

  writeFileSync(
    cliPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);

function readState() {
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(next) {
  fs.writeFileSync(statePath, JSON.stringify(next, null, 2), "utf8");
}

function applyHostname(state, hostname) {
  if (!hostname) {
    return state;
  }

  return {
    ...state,
    hostname,
    fqdn: hostname + ".tailnet.ts.net"
  };
}

const state = readState();
const command = args[0];

if (command === "status" && args.includes("--json")) {
  const payload = {
    BackendState: state.backendState,
    CurrentTailnet: {
      Name: state.tailnetName ?? (state.accountName ? "tailnet-from-state" : null)
    },
    Self: {
      HostName: state.hostname,
      DNSName: state.fqdn ? state.fqdn + "." : null,
      UserProfile: {
        LoginName: state.accountName,
        DisplayName: state.accountName
      },
      TailscaleIPs:
        state.backendState === "Running"
          ? [state.ipv4 || "100.64.0.10", state.ipv6 || "fd7a:115c:a1e0::10"]
          : []
    }
  };

  process.stdout.write(JSON.stringify(payload));
  process.exit(state.lastError ? 1 : 0);
}

if (command === "set") {
  const hostnameArg = args.find((item) => item.startsWith("--hostname="));
  writeState(applyHostname(state, hostnameArg ? hostnameArg.split("=")[1] : null));
  process.exit(0);
}

if (command === "up") {
  const hostnameArg = args.find((item) => item.startsWith("--hostname="));

  if (state.backendState === "NeedsLogin") {
    process.stdout.write(state.loginUrl + "\\n");
    process.exit(1);
  }

  writeState({
    ...applyHostname(state, hostnameArg ? hostnameArg.split("=")[1] : null),
    backendState: "Running",
    accountName: state.accountName || "user@example.com",
    ipv4: state.ipv4 || "100.64.0.10",
    ipv6: state.ipv6 || "fd7a:115c:a1e0::10",
    lastError: null
  });
  process.exit(0);
}

if (command === "login") {
  process.stdout.write(state.loginUrl + "\\n");
  process.exit(0);
}

if (command === "down") {
  writeState({
    ...state,
    backendState: "Stopped",
    lastError: null
  });
  process.exit(0);
}

if (command === "logout") {
  writeState({
    ...state,
    backendState: "NeedsLogin",
    accountName: null,
    lastError: null
  });
  process.exit(0);
}

process.stderr.write("UNSUPPORTED_FAKE_TAILSCALE_COMMAND\\n");
process.exit(1);
`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(cliPath, 0o755);
  }

  return {
    cliPath
    ,
    statePath
  };
}

export function writeFakeTailscaleState(
  statePath: string,
  nextState: FakeTailscaleState
): void {
  writeFileSync(statePath, JSON.stringify(nextState, null, 2), "utf8");
}
