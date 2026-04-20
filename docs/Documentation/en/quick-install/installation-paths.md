# Choose an Install Path

## What you actually need

In most cases you need two parts:

- one device running the `Host` service;
- one client connecting to that Host.

The Host keeps the real project state and tools. The client gives you access from different devices.

## Three common setups

### One development machine plus desktop client

This is the easiest first setup. Run the Host on your main machine and connect from the same machine or another desktop.

### One always-on machine plus mobile client

Best when you want to keep checking or continuing work while away from the desk.

### One Host plus browser access

Best for temporary access or cases where installing a client is not convenient.

## Before you install

- Prepare a device that can stay online with your project directories.
- Make sure Node.js 22 or newer is available for the Host.
- If you plan to connect from outside the local network, prepare a remote access path later.
