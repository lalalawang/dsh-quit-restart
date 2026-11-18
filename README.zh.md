# dsh-quit-restart

侧边栏一个按钮：**退出并重启 DeepSeek Harness Desktop**，不用再「托盘退出 → 自己找快捷方式」。

[English](README.md)

## 为什么需要它

DSH 桌面端没有重启入口：标题栏那几个按钮和 `…` 菜单都归 Electron 外壳所有，而托盘退出之后要自己把应用再打开一次。这个 bundle 在侧边栏底部加一行，把两步合并成一次点击。

## 安装

```sh
dsh plugin --profile <profile> add dsh-quit-restart
```

装完重启一次 `dsh` 让新 bundle 被扫描。桌面端也可以直接在插件管理器里点安装。

从本地目录装：

```sh
dsh plugin --profile <profile> add link:/绝对路径/dsh-quit-restart
```

## 使用

侧边栏底部（和「设置」同一排）会出现 **退出并重启 DSH**。点一下：应用关闭，然后自己回来；期间按钮显示「正在退出…」。

没有别的要配。万一自动找不到程序路径，把 `DSH_QUIT_RESTART_APP_EXE` 设成完整路径即可。

## 原理

**宿主半身**（`index.js`）在 Web 服务上注册两条精确路由：

| 路由 | 作用 |
| --- | --- |
| `GET /api/quit-restart/status` | 返回解析到的可执行文件、来源、桌面主进程 PID、平台是否受支持 |
| `POST /api/quit-restart/restart` | `{ "dryRun": true }` 只解析不执行；否则启动重启 |

重启路由只接受来自环回地址、且（若有）`Origin` 与所服务主机一致的请求，其余一律 `403`。随后把一段 VBScript 写进 `%TEMP%`，用 `wscript.exe` 脱离启动（无控制台）：

1. `taskkill /F /PID <主进程> /PID <宿主进程>` —— 主进程和运行本插件的宿主进程都要点名；
2. 轮询 `tasklist` 直到两个 PID 都消失（最多约 10 秒），超时则按镜像名兜底；
3. 清掉继承来的 `ELECTRON_RUN_AS_NODE`，再重新拉起可执行文件。

每一步都写进 `%TEMP%\dsh-quit-restart-<pid>-<ts>.log`。必须点名两个 PID：只杀主进程时，子进程仍占着端口，新实例起不来。

**客户端半身**（`client.js`）往 `sidebar.footer.action` 座位注册一个组件，点击时 POST 上面那条路由；配色用主题自己的令牌，跟着皮肤走。

## 安全

- 仅环回 + 同源 POST；页面拿不到任何令牌。
- 只会因为点击而执行，不会自动重启。
- 重启后的应用是独立进程，关掉当初启动 DSH 的终端不影响它。
- 仅支持 Windows：依赖 `taskkill` 与 `wscript.exe`。其它平台该路由返回 `501`，需要手动重启。

## 说明

- 重启会中断正在进行的那一轮回答；会话本身已经落盘。
- 如果按钮显示「重启失败」，看 `%TEMP%` 下最新的 `dsh-quit-restart-*.log`，里面写着卡在哪一步。

## 许可证

MIT
