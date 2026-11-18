/**
 * Host half of dsh-quit-restart.
 *
 * The Desktop shell owns the window caption and exposes no quit/relaunch
 * channel to the Web host, so pressing the button hands the job to a
 * short-lived detached script: it force-ends the Electron main process and this
 * host process (the same result as quitting from the tray), waits until both
 * are gone, then launches the application again with ELECTRON_RUN_AS_NODE
 * cleared.
 *
 * The script is VBScript run by `wscript.exe`, which owns no console window. A
 * batch file started with `cmd /c start` would leave a console on screen, and
 * that console hosts the relaunched application: closing it sends
 * CTRL_CLOSE_EVENT to everything attached and takes DSH down again. Nothing
 * visible is created this way.
 *
 * Every stage is journalled to `%TEMP%\dsh-quit-restart-<pid>-<ts>.log`, so a
 * failed relaunch can be diagnosed without adding a console.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

export const name = 'quit-restart'
export const version = '0.1.0'

const ROUTE = '/api/quit-restart'
const DEFAULT_APP_NAME = 'DeepSeek Harness'
const EOL = String.fromCharCode(13) + String.fromCharCode(10)
const IS_WINDOWS = process.platform === 'win32'

/** Reply with JSON and no caching, matching the other plugin routes. */
function json(res, value, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(value))
}

/** Read the (optional) JSON request body without failing on an empty one. */
function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 64 * 1024) {
        chunks.length = 0
        resolve({})
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        const parsed = JSON.parse(text)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** Only requests that arrive over the loopback interface may restart the app. */
function isLoopback(req) {
  const address = req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** A browser request must come from the very host the page was served by. */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** Run a PowerShell one-liner and return its trimmed stdout ('' on failure). */
function powershell(script, timeout = 8000) {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve('')
        resolve(String(stdout).trim())
      }
    )
  })
}

/** Absolute path of a running process, or '' when it cannot be read. */
async function pathOfProcess(pid) {
  if (!IS_WINDOWS || !Number.isInteger(pid) || pid <= 0) return ''
  const path = await powershell(
    `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`
  )
  return path
}

/** Absolute path of the first running process with this name, or ''. */
async function pathOfProcessNamed(appName) {
  if (!IS_WINDOWS) return ''
  const safe = String(appName).replace(/'/g, "''")
  const path = await powershell(
    `(Get-Process -Name '${safe}' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path`
  )
  return path
}

/**
 * Locate the Desktop executable to relaunch.
 *
 * Order: explicit setting, the parent process that spawned this host (the
 * Electron main process — its image *is* the app the user launched), then the
 * default product name, then a documented default location. Nothing is
 * hard-coded to one machine.
 */
async function resolveAppExe() {
  const configured =
    process.env.DSH_QUIT_RESTART_APP_EXE || process.env.DSH_RESTART_APP_EXE || ''
  if (configured !== '' && existsSync(configured)) {
    return { path: configured, source: 'env' }
  }
  const mainPid = mainProcessPid()
  const fromParent = await pathOfProcess(mainPid)
  if (fromParent !== '' && existsSync(fromParent)) {
    return { path: fromParent, source: 'parent' }
  }
  const fromName = await pathOfProcessNamed(DEFAULT_APP_NAME)
  if (fromName !== '' && existsSync(fromName)) {
    return { path: fromName, source: 'process' }
  }
  return { path: null, source: 'missing' }
}

/** Escape a Windows path for use inside a VBScript string literal. */
function vbsString(value) {
  return String(value).replace(/"/g, '""')
}

/**
 * Build the VBScript that ends both processes and relaunches the application.
 *
 * `wscript.exe` owns no console window, so nothing appears on screen, and the
 * relaunched application inherits no console either.
 */
function buildRestartVbs({ appExe, mainPid, hostPid, logPath }) {
  const appName = basename(appExe, '.exe')
  return [
    'Option Explicit',
    'Dim sh, fso, tries, alive, logPath',
    'Set sh = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'logPath = "' + vbsString(logPath) + '"',
    'Note "start main=' + mainPid + ' host=' + hostPid + '"',
    'sh.Run "taskkill /F /PID ' + mainPid + ' /PID ' + hostPid + '", 0, True',
    'Note "taskkill sent"',
    'tries = 0',
    'Do',
    '  WScript.Sleep 250',
    '  alive = False',
    '  If sh.Run("cmd /c tasklist /FI ""PID eq ' + mainPid + '"" /NH | find ""' + mainPid + '""", 0, True) = 0 Then alive = True',
    '  If sh.Run("cmd /c tasklist /FI ""PID eq ' + hostPid + '"" /NH | find ""' + hostPid + '""", 0, True) = 0 Then alive = True',
    '  If Not alive Then Exit Do',
    '  tries = tries + 1',
    'Loop While tries < 40',
    'If tries >= 40 Then sh.Run "taskkill /F /IM ""' + vbsString(appName) + '.exe""", 0, True',
    'Note "processes gone (waited " & tries & " ticks)"',
    'WScript.Sleep 800',
    'On Error Resume Next',
    'sh.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"',
    'On Error GoTo 0',
    'Note "relaunching ' + vbsString(appExe) + '"',
    'sh.Run Chr(34) & "' + vbsString(appExe) + '" & Chr(34), 1, False',
    'On Error Resume Next',
    'If Err.Number <> 0 Then',
    '  Note "direct launch failed (" & Err.Number & "); trying cmd start"',
    '  sh.Run "cmd /c start """" ""' + vbsString(appExe) + '""", 0, False',
    'End If',
    'On Error GoTo 0',
    'Note "done"',
    'Sub Note(msg)',
    '  Dim f',
    '  On Error Resume Next',
    '  Set f = fso.OpenTextFile(logPath, 8, True)',
    '  If Not f Is Nothing Then',
    '    f.WriteLine Now & "  " & msg',
    '    f.Close',
    '  End If',
    '  On Error GoTo 0',
    'End Sub',
    ''
  ].join(EOL)
}

/** Start the detached restart script; returns the script and log paths. */
function launchRestartScript({ appExe, mainPid, hostPid }) {
  const stamp = String(Date.now())
  const scriptPath = join(tmpdir(), 'dsh-quit-restart-' + process.pid + '-' + stamp + '.vbs')
  const logPath = join(tmpdir(), 'dsh-quit-restart-' + process.pid + '-' + stamp + '.log')
  writeFileSync(scriptPath, buildRestartVbs({ appExe, mainPid, hostPid, logPath }), 'utf8')
  const child = spawn('wscript.exe', ['//nologo', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  return { scriptPath, logPath }
}

/** Main-process PID as seen by the Electron shell: the parent of this host process. */
function mainProcessPid() {
  const pid = Number(process.ppid)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

export function apply(ctx) {
  // `webServer` is published by the browser composition, so wait for it instead
  // of reading it once during apply.
  ctx.inject(['webServer'], scoped => {
    const server = scoped.webServer
    scoped.effect(() => {
      const disposeStatus = server.register({
        kind: 'exact',
        path: ROUTE + '/status',
        handler: async (_req, res) => {
          const app = await resolveAppExe()
          json(res, {
            ok: true,
            platform: process.platform,
            supported: IS_WINDOWS,
            ready: app.path !== null,
            appExe: app.path,
            appExeSource: app.source,
            mainPid: mainProcessPid()
          })
        }
      })

      const disposeRestart = server.register({
        kind: 'exact',
        path: ROUTE + '/restart',
        handler: async (req, res) => {
          if (!isLoopback(req)) {
            return json(res, { ok: false, error: 'restart is only accepted from this machine' }, 403)
          }
          if (!sameOrigin(req)) {
            return json(res, { ok: false, error: 'origin does not match this host' }, 403)
          }
          if (!IS_WINDOWS) {
            return json(
              res,
              {
                ok: false,
                error:
                  'the relaunch helper is Windows-only; quit and start the app again from your desktop on this platform'
              },
              501
            )
          }
          const body = await readBody(req)
          const app = await resolveAppExe()
          const mainPid = mainProcessPid()
          if (app.path === null) {
            return json(
              res,
              {
                ok: false,
                error:
                  'could not locate the DeepSeek Harness executable; set DSH_QUIT_RESTART_APP_EXE to its full path'
              },
              409
            )
          }
          if (mainPid === null) {
            return json(res, { ok: false, error: 'could not read the desktop main process id' }, 409)
          }
          if (body.dryRun === true) {
            return json(res, { ok: true, dryRun: true, appExe: app.path, mainPid })
          }
          const started = launchRestartScript({ appExe: app.path, mainPid, hostPid: process.pid })
          json(res, { ok: true, appExe: app.path, mainPid, ...started })
        }
      })

      return () => {
        disposeStatus()
        disposeRestart()
      }
    }, 'quit-restart: routes')
  })
}
