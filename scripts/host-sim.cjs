/**
 * 宿主侧集成测试：用最小 vscode mock 加载 dist/extension.js，
 * 走一遍「激活 → 侧边栏就绪 → 加载首页 → 播放 → 播完切歌」的真实链路（含网络）。
 *
 * 运行：node esbuild.mjs && node scripts/host-sim.cjs
 */
const Module = require("node:module");
const path = require("node:path");

const received = [];
const executedCommands = [];
let messageHandler = null;
let provider = null;
let viewProviderOptions = null;

function disposable() {
  return { dispose() {} };
}

const configStore = {
  quality: "exhigh",
  volume: 70,
  apiHost: "https://interface.music.163.com",
  userAgent: "",
  lyricsTranslation: true,
};

const mockVscode = {
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  Uri: {
    file: (p) => ({ fsPath: p, path: p, toString: () => `file:///${String(p).replace(/\\/g, "/")}` }),
    joinPath: (base, ...parts) => mockVscode.Uri.file(path.join(base.fsPath, ...parts)),
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
    registerWebviewViewProvider: (id, instance, options) => {
      provider = instance;
      viewProviderOptions = options;
      return disposable();
    },
    createStatusBarItem: () => ({
      text: "",
      tooltip: "",
      name: "",
      command: "",
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }),
    showQuickPick: async (items) => items.find((item) => item.value === "jymaster"),
    showInputBox: async () => "晴天",
    showWarningMessage: async () => "退出登录",
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
  },
  commands: {
    registerCommand: (id, handler) => {
      executedCommands.push({ id, handler });
      return disposable();
    },
    executeCommand: async () => undefined,
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (configStore[key] === undefined ? fallback : configStore[key]),
      update: async (key, value) => {
        configStore[key] = value;
      },
    }),
    onDidChangeConfiguration: () => disposable(),
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return mockVscode;
  return originalLoad.apply(this, arguments);
};

const store = new Map();
const secretStore = new Map();
const context = {
  subscriptions: [],
  extensionUri: mockVscode.Uri.file(path.resolve(__dirname, "..")),
  extension: { packageJSON: { version: "1.0.0" } },
  globalState: {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    update: async (key, value) => {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  },
  secrets: {
    get: async (key) => secretStore.get(key),
    store: async (key, value) => {
      secretStore.set(key, value);
    },
    delete: async (key) => {
      secretStore.delete(key);
    },
    onDidChange: () => ({ dispose() {} }),
  },
};

const extension = require(path.resolve(__dirname, "..", "dist", "extension.js"));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 25_000, label = "") {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return true;
    await wait(150);
  }
  throw new Error(`等待超时：${label}`);
}

function last(type) {
  for (let i = received.length - 1; i >= 0; i -= 1) if (received[i].type === type) return received[i];
  return undefined;
}

const view = {
  visible: true,
  webview: {
    options: {},
    html: "",
    cspSource: "vscode-resource:",
    asWebviewUri: (uri) => ({ toString: () => `vscode-resource:${uri.fsPath}` }),
    postMessage: async (message) => {
      received.push(message);
      return true;
    },
    onDidReceiveMessage: (handler) => {
      messageHandler = handler;
      return disposable();
    },
  },
  onDidChangeVisibility: () => disposable(),
  onDidDispose: () => disposable(),
};

function send(message) {
  return messageHandler(message);
}

async function main() {
  await extension.activate(context);
  if (!provider) throw new Error("未注册 WebviewViewProvider");
  if (!viewProviderOptions?.webviewOptions?.retainContextWhenHidden) throw new Error("未启用 retainContextWhenHidden，后台播放会被销毁");
  console.log("✓ 激活并注册侧边栏视图（未创建任何 WebviewPanel）");

  provider.resolveWebviewView(view);
  console.log("✓ resolveWebviewView 成功，HTML 长度", view.webview.html.length);
  if (!view.webview.html.includes("Content-Security-Policy")) throw new Error("HTML 缺少 CSP");
  if (!view.webview.html.includes("media-src https: blob:")) throw new Error("CSP 未放行音频");

  await send({ type: "ready" });
  await waitFor(() => last("snapshot") && last("account"), 5000, "初始快照");
  const snapshot = last("snapshot").snapshot;
  console.log("✓ 初始快照：", { playing: snapshot.playing, volume: snapshot.volume, mode: snapshot.mode, quality: snapshot.quality });

  await send({ type: "command", cmd: "home" });
  await waitFor(() => last("home"), 25_000, "首页数据");
  const home = last("home").data;
  console.log("✓ 首页：推荐歌单", home.recommend.length, "个，登录状态", home.loggedIn);

  if (!home.recommend.length) throw new Error("推荐歌单为空");
  await send({ type: "command", cmd: "playlist", payload: { id: home.recommend[0].id } });
  await waitFor(() => last("list"), 30_000, "歌单详情");
  const list = last("list").list;
  console.log("✓ 歌单详情：", list.title, list.tracks.length, "首");

  await send({
    type: "command",
    cmd: "playTracks",
    payload: { tracks: list.tracks.slice(0, 3), index: 0, contextName: "集成测试" },
  });
  await waitFor(() => last("load") && last("snapshot").snapshot.actualLevel, 25_000, "播放地址");
  const load = last("load");
  console.log("✓ 播放地址：", load.track.name, "|", load.url.slice(0, 60) + "…", "| 试听:", load.trial);
  const playing = last("snapshot").snapshot;
  console.log("✓ 实际音质 level：", playing.actualLevel, "| 请求音质:", playing.quality);

  const before = load.track.id;
  await send({ type: "audio", event: "ended" });
  await waitFor(() => last("load") && last("load").track.id !== before, 25_000, "自动切歌");
  console.log("✓ 播完自动切歌：", last("load").track.name);

  await send({ type: "command", cmd: "mode", payload: { mode: "single" } });
  await waitFor(() => last("snapshot").snapshot.mode === "single", 3000, "模式切换");
  console.log("✓ 播放模式切换：单曲循环");

  await send({ type: "command", cmd: "volume", payload: { value: 35 } });
  await waitFor(() => last("snapshot").snapshot.volume === 35, 3000, "音量设置");
  console.log("✓ 音量设置：35");

  await send({ type: "command", cmd: "queue" });
  await waitFor(() => last("queue"), 3000, "队列");
  console.log("✓ 播放队列：", last("queue").tracks.length, "首");

  await send({ type: "command", cmd: "lyric", payload: { id: list.tracks[0].id } });
  await waitFor(() => last("lyric"), 20_000, "歌词");
  console.log("✓ 歌词：", last("lyric").lyric.lrc.length, "字符");

  await send({ type: "command", cmd: "search", payload: { keyword: "海阔天空", kind: "song" } });
  await waitFor(() => last("search"), 20_000, "搜索");
  console.log("✓ 搜索：", last("search").result.songs.length, "条结果");

  await send({ type: "command", cmd: "quality", payload: { quality: "lossless" } });
  await waitFor(() => configStore.quality === "lossless", 3000, "音质修改");
  console.log("✓ 音质修改并持久化到设置：", configStore.quality);

  const pickQuality = executedCommands.find((item) => item.id === "neteaseSidebar.pickQuality");
  if (!pickQuality) throw new Error("未注册 pickQuality 命令");
  await pickQuality.handler();
  await waitFor(() => configStore.quality === "jymaster", 5000, "QuickPick 音质");
  console.log("✓ 原生 QuickPick 切换音质：", configStore.quality);

  const quickSearch = executedCommands.find((item) => item.id === "neteaseSidebar.quickSearch");
  if (!quickSearch) throw new Error("未注册 quickSearch 命令");
  await quickSearch.handler();
  await waitFor(() => last("search") && last("search").result.keyword === "晴天", 20_000, "InputBox 搜索");
  console.log("✓ 原生 InputBox 搜索：", last("search").result.songs.length, "条结果");

  await send({ type: "command", cmd: "qrLogin" });
  await waitFor(() => last("qr") && last("qr").qr.svg.length > 0, 20_000, "二维码生成");
  const qr = last("qr").qr;
  console.log("✓ 扫码登录二维码：", qr.svg.length, "字符，状态", qr.status, "，key", qr.key.slice(0, 12) + "…");
  if (qr.status !== "waiting") throw new Error("二维码初始状态应为 waiting");
  await send({ type: "command", cmd: "cancelQr" });
  console.log("✓ 取消扫码轮询");

  const commandIds = executedCommands.map((item) => item.id);
  console.log("✓ 已注册命令：", commandIds.join(", "));

  console.log("\n宿主侧集成测试全部通过");
  extension.deactivate();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n集成测试失败：", err);
  console.error("最近消息：", received.slice(-6).map((m) => m.type));
  process.exit(1);
});
