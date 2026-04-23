# Install the Host Service

This page does one thing: get a CodingNS Host running on a machine you plan to keep around. Desktop, mobile, and browser access will all connect back to that Host.

## If you just want the shortest route

If you install CodingNS manually on Linux, prepare the native build tools first. `@jingyi0605/codingns` includes native modules such as `better-sqlite3`, and npm may fall back to local compilation when a prebuilt package is unavailable.

```bash
apt-get update
apt-get install -y build-essential python3
```

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

## Common startup options

- `--host`: listening address, default `0.0.0.0`
- `--port`: listening port, default `3002`
- `--data-dir`: data directory, default `~/.codingns`
- `--demo`: start in demo mode for a quick guided trial

## Once it is running

The next move is simple:

1. connect a client to the Host address
2. finish the first login or bootstrap flow
