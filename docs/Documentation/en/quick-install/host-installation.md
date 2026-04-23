# Install the Host Service

## What this step gives you

After this step you will have a CodingNS Host that clients can connect to. Login, workspaces, conversations, files, Git, terminal access, and remote access all build on top of it.

## Direct install path

If Node.js is already available, install the standalone package:

```bash
npm install -g @jingyi0605/codingns
codingns start --port 3002
```

Or run it without a global install:

```bash
npx @jingyi0605/codingns start --port 3002
```

## Common startup options

- `--host`: listening address, default `0.0.0.0`
- `--port`: listening port, default `3002`
- `--data-dir`: data directory, default `~/.codingns`
- `--demo`: start in demo mode for a quick guided trial

## After startup

After startup, the next move is simple:

1. connect a client to the Host address;
2. finish the first login or bootstrap flow.
