# Core Features

## Session continuation

The most important value is not opening another new chat box. It is keeping an existing AI coding session available across clients whenever possible.

## Workspace-centered workflow

Workspaces are the anchor for sessions, files, Git state, terminal instances, and other tools, so the product follows the project instead of scattering state across separate pages.

## Conversation workbench

The conversation page is the main place where you:

- read the message timeline;
- send the next instruction;
- review permission requests;
- add file context;
- track queued messages;
- continue from previous points when needed.

## Workspace assistant and office capabilities

Starting in `v0.8.0`, regular workspace sessions can call controlled assistant entry points instead of staying limited to chat-only actions. That includes selected document, browser, terminal, and related office capabilities.

The important part is not “open everything.” The important part is opening the useful paths while keeping the scope boundary strict.

## Browser tasks and the real-browser bridge

`office.browser` now has two practical execution paths:

- the default managed headless path for stable automation;
- an explicit bridge path when you need an existing Chrome or Edge login state.

That makes page reading, screenshots, clicks, forms, and downloads much more practical in real work.

## Files, Git, and terminal access

CodingNS keeps common project tools close to the active conversation:

- browse and preview files;
- inspect changes and Git state;
- run real terminal sessions inside the workspace.

## Static HTML presentation editing

Slide-style HTML files are no longer limited to passive preview. They can open in a presentation editor where text and layout can be adjusted while keeping the visual result stable.

## Multi-host and multi-device access

If you use more than one Host, CodingNS can keep them separate and let you switch between them without turning the UI into a mess.

## Remote access

You can keep a Host reachable outside your local network through Tailscale or CodingNS Connect, depending on the way you prefer to connect.

## Settings and updates

Language, theme, model-related preferences, browser profiles, task panels, remote access entry points, and update-related actions are collected in the settings area.

## Install and runtime stability

This release also fixed several practical issues that affect daily use:

- a more predictable Windows install path;
- better runtime dependency discovery for the `codingns` npm package;
- tighter workspace session runtime scoping;
- fewer file tree and refresh glitches.
