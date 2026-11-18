# Quit and restart

Adds **one row** to the sidebar footer: it quits DeepSeek Harness Desktop and starts the same application again, without a console window and without touching the tray menu.

## What it adds

| Where | What |
| --- | --- |
| Sidebar footer (`sidebar.footer.action`, order 5) | A row labelled *Quit and restart DSH* / *退出并重启 DSH* |
| Web routes | `GET /api/quit-restart/status`, `POST /api/quit-restart/restart` |

## Requirements

- DSH Desktop on Windows. The relaunch helper uses `taskkill` and `wscript.exe`; on other platforms the route answers `501`.
- No configuration. `DSH_QUIT_RESTART_APP_EXE` overrides executable discovery when needed.

## Behaviour

1. The click posts `{ dryRun: false }` to the restart route.
2. The host resolves the executable (explicit setting → the parent Electron process image → the product's process name) and writes a VBScript to `%TEMP%`.
3. `wscript.exe` runs it detached: end the main process and this host process, wait for both PIDs to disappear, clear `ELECTRON_RUN_AS_NODE`, relaunch, self-delete.
4. The page goes away with the process; the application returns on its own.

Requests must come from loopback and, when an `Origin` header is present, from the host that served the page; otherwise `403`.

## Permissions

Runs local processes only; no network access, no files outside `%TEMP%`, no credentials.
