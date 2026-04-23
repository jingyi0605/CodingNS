# Choose an Install Path

In most cases you need two parts:

- one device running the `Host` service;
- one client connecting to that Host.

The Host keeps the real project state and tools. The client gives you access from different devices.

## Start from the setup that already sounds like your situation

### One development machine plus desktop client

This is the easiest first setup. Run the Host on your main machine and connect from the same machine or another desktop.

### One always-on machine plus mobile client

Best when you want to keep checking or continuing work while away from the desk.

### One Host plus browser access

Best for temporary access or cases where installing a client is not convenient.

## Before you install anything, decide where the Host should live

- Choose the machine that will keep the real project state.
- Decide whether you want the fastest install path or a more manual setup.

## Then make sure the machine is ready

- Prepare a device that can stay online with your project directories.
- Make sure Node.js 22 or newer is available for the Host.
- If you plan to install with plain npm on Linux, prepare `build-essential` and `python3` first.
- If you plan to connect from outside the local network, prepare a remote access path later.
