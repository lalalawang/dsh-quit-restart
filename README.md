# dsh-quit-restart

Adds one row to the DSH sidebar: **Quit and restart DSH**. Click it, the app closes and comes back on its own.

No tray menu, no hunting for the shortcut again.

## Install

In the app: **Plugins → Add plugin**, then enter `dsh-quit-restart` (npm) or `https://github.com/lalalawang/dsh-quit-restart`.

Restart DSH once afterwards. Bundles are only scanned at startup.

## Use

The last row of the sidebar, next to Settings. Click it: the button changes to "Quitting…", the page drops, the app starts again.

Nothing to configure.

## What it actually does

On Windows it writes a one-off VBScript to `%TEMP%` and launches it with `wscript.exe`, detached, so no console window appears. The script does three things:

1. `taskkill` on **two** processes: the Electron main process and the host process this plugin runs inside. Killing only the main process is not enough: the host is its child, it keeps the port, and the new instance cannot start.
2. Polls every 250 ms to see if both PIDs are gone, for up to 10 s. If they are still there, it kills by image name.
3. Clears the inherited `ELECTRON_RUN_AS_NODE` (otherwise the new process starts as node and shows no window), then launches the original exe.

The script deletes itself when done.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/quit-restart/status` | Resolved exe path, where it was found, main PID, whether the platform is supported |
| `POST /api/quit-restart/restart` | `{"dryRun": true}` resolves only; otherwise restarts |

Both accept loopback requests only, and when an `Origin` header is present it must match the serving host, otherwise `403`. Non-Windows returns `501`.

## If the exe path cannot be resolved

Normally it is derived from the parent process image, so nothing is hardcoded.

If that fails, set `DSH_QUIT_RESTART_APP_EXE` to the full path.

## When something goes wrong

Logs land in `%TEMP%\dsh-quit-restart-<pid>-<timestamp>.log`, one line per stage.

A "Restart failed" button usually means the kill step was denied. Check the last line of the newest log.

## Notes

- Restarting drops any in-flight generation. Session records are already on disk.
- The relaunched app is an independent process; closing the terminal you started DSH from does not affect it.

## License

MIT
