# dsh-quit-restart

A sidebar button that quits **DeepSeek Harness Desktop** and starts it again — one click instead of "tray → Quit → find the shortcut again".

[中文](README.zh.md)

## Why

DSH Desktop has no restart entry in its menus: the caption buttons and the `…` menu belong to the Electron shell, and quitting from the tray means relaunching the app by hand. This bundle adds one row to the sidebar footer that does both steps.

## Install

```sh
dsh plugin --profile <profile> add dsh-quit-restart
```

Then restart `dsh` once so the new bundle is scanned. With DSH Desktop, install it from the app's plugin manager if you prefer a GUI.

From a checkout:

```sh
dsh plugin --profile <profile> add link:/absolute/path/dsh-quit-restart
```

## Use

The row **Quit and restart DSH** sits in the sidebar footer, next to Settings. Click it: the app closes and comes back on its own. The row shows `Quitting…` until the page goes away.

Nothing else to configure. On a machine where the executable cannot be found automatically, set `DSH_QUIT_RESTART_APP_EXE` to its full path.

## How it works

**Host half** (`index.js`) registers two exact routes on the harness web server:

| Route | Purpose |
| --- | --- |
| `GET /api/quit-restart/status` | Reports the resolved executable, where it was found, the desktop main PID, and whether the platform is supported. |
| `POST /api/quit-restart/restart` | Accepts `{ "dryRun": true }` to resolve only, or starts the relaunch. |

The restart route only answers requests from the loopback interface whose `Origin`, when present, equals the served host; anything else gets `403`. It then writes a VBScript to `%TEMP%` and starts it with `wscript.exe` — detached, no console:

1. `taskkill /F /PID <main> /PID <host>` — both the Electron main process and the host process that runs this bundle.
2. Poll `tasklist` until both PIDs are gone (up to ~10 s), then fall back to ending every process of the app image.
3. Clear the inherited `ELECTRON_RUN_AS_NODE`, then launch the executable again.

Every step is journalled to `%TEMP%\dsh-quit-restart-<pid>-<ts>.log`. Killing both PIDs matters: ending only the main process leaves the host child holding the port, so the new instance cannot start.

**Client half** (`client.js`) registers one component into the `sidebar.footer.action` seat and posts to the route. It uses the theme's own tokens, so it follows the active skin.

## Safety

- Loopback-only, same-origin POST; no token is exposed to the page.
- The button never runs automatically — only on click.
- The relaunched app is a normal, independent process; closing any terminal you launched DSH from does not affect it.
- Windows only: the helper relies on `taskkill` and `wscript.exe`. Elsewhere the route answers `501` and the app must be restarted by hand.

## Notes

- Restarting drops any in-flight generation; sessions are already on disk.
- If the row ever shows `Restart failed`, read the newest `%TEMP%\dsh-quit-restart-*.log` — it names the stage that failed.

## License

MIT
