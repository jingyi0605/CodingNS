# Install the Host Service

Install CodingNS Host on a machine you plan to keep online. Desktop, mobile, and browser clients will all connect back to that Host.

## Quick Install

`@jingyi0605/codingns` includes native modules such as `better-sqlite3` and `node-pty`. If npm cannot fetch a prebuilt binary, it falls back to local compilation, so the required prerequisites differ by platform.

On Linux, prepare the native build tools first:

```bash
apt-get update
apt-get install -y build-essential python3
```

On Windows, check these first before you run `npm install -g` or the install script:

- Prefer Node.js `22 LTS`
- Install Visual Studio Build Tools 2022 with the `Desktop development with C++` workload

That matters because native prebuilt binaries are commonly downloaded from GitHub Releases on Windows. If that download fails, npm falls back to `node-gyp`, and the install will fail immediately without the C++ toolchain. Switching the npm registry alone does not solve that case.

If Node.js is already available, install the standalone package:

```bash
npm install -g @jingyi0605/codingns
codingns start --port 3002
```

Or run it without a global install:

```bash
npx @jingyi0605/codingns start --port 3002
```

If you prefer the interactive installer instead, it can also check missing prerequisites, offer to install them automatically on supported systems, and then continue with the CodingNS service setup:

```bash
curl -fsSL https://codingns.com/install | bash
```

On Windows, the script will warn you about the Visual Studio Build Tools requirement, but it does not try to install the whole C++ toolchain for you.

## Common startup options

- `--host`: listening address, default `0.0.0.0`
- `--port`: listening port, default `3002`
- `--data-dir`: data directory, default `~/.codingns`
- `--demo`: start in demo mode for a quick guided trial

## Once it is running

The next move is simple:

1. connect a client to the Host address
2. finish the first login or bootstrap flow

## Common Windows failures

### `Could not find any Visual Studio installation to use`

This means `node-gyp` had to compile a native module locally, but the machine does not have the required C++ build tools. Install Visual Studio Build Tools 2022 with `Desktop development with C++`, then retry.

### `prebuild-install warn install read ECONNRESET` or `Request timed out`

This usually means the native prebuilt binary download from GitHub Releases failed. That is separate from the npm registry itself, so switching between the official npm registry and a mirror often does not fix it.

The practical recovery order is:

1. switch to Node.js `22 LTS`
2. install Visual Studio Build Tools 2022 so local compilation is still possible
3. run the install again
