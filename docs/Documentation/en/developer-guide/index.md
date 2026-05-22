# Developer Guide

This section is for developers integrating platform capabilities, not for end users following day-to-day product instructions.

If you only need to install CodingNS, sign in, open a workspace, use the file panel, or set up remote access, go back to the user-facing docs first.

## Who should read this section

This section is for people who:

- build static HTML tools inside CodingNS
- connect workspace file capabilities inside plugin frontends
- need to understand the boundary between `CodingNSWorkspace` and `CodingNSDesktop`
- will maintain the bridge layer later

## Where to start

### 1. You want the capability boundary first

Start here:

- [Workspace File Bridge & Desktop Wrapper](/en/developer-guide/workspace-file-bridge-and-desktop-wrapper)

This page explains:

- what `CodingNSWorkspace` is for
- what `CodingNSDesktop` is for
- why the page side only passes workspace-relative paths
- why opening or revealing a file still has to pass Host validation first

### 2. You want the plugin frontend integration path

Then continue here:

- [Plugin Frontend Workspace File Bridge](/en/developer-guide/plugin-frontend-workspace-file-bridge)

This page is more practical. It shows:

- which cases should use `CodingNSWorkspace`
- which cases should touch `CodingNSDesktop` directly
- which bad patterns should not grow in plugin code

## What this section does not cover

This section does not explain:

- how end users install and sign in
- how to click through workspace pages
- daily Git, terminal, or remote access usage

Those topics are covered better in the user-facing docs.

## Related entry points

- Docs overview: [/en/overview/docs-overview](/en/overview/docs-overview)
- Workspaces & Sessions: [/en/user-guide/workspaces-and-sessions](/en/user-guide/workspaces-and-sessions)
- Files, Git & Terminal: [/en/user-guide/files-git-and-terminal](/en/user-guide/files-git-and-terminal)

## One-sentence summary

The developer guide answers one thing only: **if you want to integrate capabilities into CodingNS, what the standard entry points are, where the boundary lives, and which shortcuts are not allowed.**
