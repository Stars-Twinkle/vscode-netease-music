import * as vscode from "vscode";
import { CookieJar, NeteaseClient } from "./api/client";
import { DEFAULT_HOST, DESKTOP_UA } from "./api/http";
import type { PlayerSnapshot, Quality } from "./protocol";
import { QUALITY_LABELS, SidebarView, VIEW_ID } from "./sidebarView";

let output: vscode.OutputChannel | undefined;

function log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
  if (!output) return;
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const payload = data === undefined ? "" : ` ${typeof data === "string" ? data : safeJson(data)}`;
  output.appendLine(`[${time}] [${level}] ${message}${payload}`);
  if (level === "error") output.show(true);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readTransportOptions(): { host: string; userAgent: string; timeoutMs: number } {
  const config = vscode.workspace.getConfiguration("neteaseSidebar");
  return {
    host: config.get<string>("apiHost")?.trim() || DEFAULT_HOST,
    userAgent: config.get<string>("userAgent")?.trim() || DESKTOP_UA,
    timeoutMs: 15_000,
  };
}

/** 音质档位，QuickPick 用（原生控件）。 */
const QUALITY_PICKS: Array<{ label: string; description: string; value: Quality }> = [
  { label: "标准", description: "128 kbps · MP3", value: "standard" },
  { label: "较高", description: "192 kbps · MP3", value: "higher" },
  { label: "极高", description: "320 kbps · MP3", value: "exhigh" },
  { label: "无损", description: "FLAC 16-bit · 约 900–1100 kbps", value: "lossless" },
  { label: "高解析度无损", description: "Hi-Res FLAC 24-bit · 最高约 4600 kbps", value: "hires" },
  { label: "高清臻音", description: "24-bit 臻音 · SVIP", value: "jyeffect" },
  { label: "沉浸环绕声", description: "5.1 多声道 · SVIP", value: "sky" },
  { label: "超清母带", description: "Master 24-bit · SVIP", value: "jymaster" },
];

function updateStatusBar(
  control: vscode.StatusBarItem,
  info: vscode.StatusBarItem,
  snapshot: PlayerSnapshot,
): void {
  const current = snapshot.current;
  if (!current) {
    control.text = "$(play)";
    control.tooltip = "播放 / 暂停";
    info.text = "$(music) Netease Music";
    info.tooltip = "点击打开 Netease Music 侧边栏";
    return;
  }
  control.text = snapshot.playing ? "$(debug-pause)" : "$(play)";
  control.tooltip = snapshot.playing ? "暂停" : "播放";
  const title = current.name.length > 26 ? `${current.name.slice(0, 25)}…` : current.name;
  info.text = title;
  const level = snapshot.actualLevel ? QUALITY_LABELS[snapshot.actualLevel] ?? snapshot.actualLevel : "";
  const lines = [`${current.name} — ${current.artists.join(" / ")}`];
  if (level) lines.push(`音质：${level}`);
  if (snapshot.contextName) lines.push(`队列：${snapshot.contextName}`);
  lines.push("点击打开侧边栏");
  info.tooltip = lines.join("\n");
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Netease Music");
  context.subscriptions.push(output);
  log("info", `激活 v${context.extension.packageJSON.version}`);

  const savedCookies = context.globalState.get<Record<string, string>>("neteaseSidebar.cookies");
  const jar = new CookieJar(savedCookies ?? {});

  const statusControl = vscode.window.createStatusBarItem(
    "neteaseSidebar.control",
    vscode.StatusBarAlignment.Left,
    41,
  );
  statusControl.name = "Netease Music 播放控制";
  statusControl.command = "neteaseSidebar.playPause";
  statusControl.text = "$(play)";
  statusControl.tooltip = "播放 / 暂停";
  statusControl.show();
  context.subscriptions.push(statusControl);

  const statusBar = vscode.window.createStatusBarItem("neteaseSidebar.status", vscode.StatusBarAlignment.Left, 40);
  statusBar.name = "Netease Music";
  statusBar.command = "neteaseSidebar.focus";
  statusBar.text = "$(music) Netease Music";
  statusBar.tooltip = "点击打开 Netease Music 侧边栏";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const client = new NeteaseClient(
    readTransportOptions,
    jar,
    (level, message, data) => log(level, message, data),
    () => {
      void context.globalState.update("neteaseSidebar.cookies", jar.toJSON());
    },
  );

  const view = new SidebarView(context, client, log, (snapshot) => updateStatusBar(statusControl, statusBar, snapshot));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, view, {
      // 播放时必须保活：侧边栏被切到后台也不能销毁音频上下文。
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push({ dispose: () => view.dispose() });

  const register = (id: string, handler: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register("neteaseSidebar.focus", async () => {
    try {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    } catch {
      await vscode.commands.executeCommand("workbench.view.extension.neteaseSidebar");
    }
  });
  register("neteaseSidebar.playPause", () => view.togglePlayback());
  register("neteaseSidebar.next", () => view.commandNext());
  register("neteaseSidebar.previous", () => view.commandPrevious());
  register("neteaseSidebar.toggleMute", () => view.toggleMute());
  register("neteaseSidebar.search", () => view.requestUi("search"));
  register("neteaseSidebar.login", () => view.requestUi("login"));
  register("neteaseSidebar.nowPlaying", () => view.requestUi("nowplaying"));
  register("neteaseSidebar.refresh", () => view.refresh());
  register("neteaseSidebar.logout", async () => {
    const choice = await vscode.window.showWarningMessage("确定要退出 Netease Music 账号吗？", { modal: true }, "退出登录");
    if (choice === "退出登录") await view.logout();
  });

  // 原生 QuickPick：命令面板 / 标题栏切换音质
  register("neteaseSidebar.pickQuality", async () => {
    const current = view.currentQuality;
    const items = QUALITY_PICKS.map((item) => ({
      label: item.label,
      description: item.value === current ? `${item.description} · 当前` : item.description,
      value: item.value,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: "Netease Music · 播放音质",
      placeHolder: "选择播放音质（不可用时自动降级）",
      matchOnDescription: true,
    });
    if (picked) await view.setQuality(picked.value);
  });

  // 原生 InputBox：从命令面板直接搜索，结果展示在侧边栏
  register("neteaseSidebar.quickSearch", async () => {
    const keyword = await vscode.window.showInputBox({
      title: "Netease Music · 搜索",
      prompt: "输入歌曲或歌单关键词",
      placeHolder: "例如：晴天",
      ignoreFocusOut: true,
    });
    if (keyword?.trim()) await view.searchFromCommand(keyword.trim());
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("neteaseSidebar")) view.onConfigurationChanged();
    }),
  );

  log("info", "就绪");
}

export function deactivate(): void {
  log("info", "停用");
}
