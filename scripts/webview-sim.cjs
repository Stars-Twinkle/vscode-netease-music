/**
 * 侧边栏 UI 集成测试：用 jsdom 执行 dist/webview.js，
 * 模拟宿主消息与点击，检查每个视图是否渲染正确、命令是否正确上抛。
 *
 * 运行：node esbuild.mjs && node scripts/webview-sim.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const bundle = fs.readFileSync(path.resolve(__dirname, "..", "dist", "webview.js"), "utf8");

const posted = [];
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "https://localhost/",
});

const { window } = dom;

class FakeAudio extends window.EventTarget {
  constructor() {
    super();
    this.src = "";
    this.paused = true;
    this.volume = 1;
    this.muted = false;
    this.currentTime = 0;
    this.duration = 0;
    this.preload = "";
    this.error = null;
    this.playCalls = 0;
  }
  play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new window.Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new window.Event("pause"));
  }
  load() {}
  removeAttribute(name) {
    if (name === "src") this.src = "";
  }
  setAttribute() {}
}

const audioInstances = [];
window.Audio = class extends FakeAudio {
  constructor() {
    super();
    audioInstances.push(this);
  }
};

window.acquireVsCodeApi = () => ({
  postMessage: (message) => posted.push(message),
  getState: () => undefined,
  setState: () => {},
});

const errors = [];
window.addEventListener("error", (event) => errors.push(event.error ?? event.message));

window.eval(bundle);

const audio = audioInstances[0];
const app = window.document.getElementById("app");
const content = () => app.querySelector("#content");
const post = (data) => window.dispatchEvent(new window.MessageEvent("message", { data }));
const click = (selector) => {
  const el = app.querySelector(selector);
  if (!el) throw new Error(`找不到元素：${selector}`);
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
};
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

const track = (id, name) => ({
  id,
  name,
  artists: ["测试歌手"],
  album: "测试专辑",
  coverUrl: "",
  duration: 200000,
});

const snapshot = {
  current: null,
  queueLength: 0,
  index: 0,
  contextName: "",
  playing: false,
  loading: false,
  volume: 70,
  muted: false,
  mode: "order",
  quality: "exhigh",
  trial: false,
};

async function main() {
  assert(posted.some((m) => m.type === "ready"), "启动后应发送 ready");
  assert(app.querySelector(".topbar"), "缺少标题栏");
  assert(app.querySelector("#player .play-btn"), "缺少底部播放器");
  assert(content().textContent.includes("正在加载推荐"), "首屏应显示加载占位");
  console.log("✓ 挂载骨架与 ready 握手");

  post({ type: "config", config: { quality: "exhigh", translation: true } });
  post({ type: "account", account: null });
  post({ type: "snapshot", snapshot });
  await wait();

  post({
    type: "home",
    data: {
      recommend: [
        { id: 11, name: "推荐歌单一", coverUrl: "", trackCount: 10, playCount: 12345 },
        { id: 12, name: "推荐歌单二", coverUrl: "", trackCount: 20 },
      ],
      daily: [],
      mine: [],
      loggedIn: false,
      account: null,
    },
  });
  await wait();
  assert(app.querySelectorAll(".card").length === 2, "首页应渲染 2 个歌单卡片");
  assert(content().textContent.includes("每日推荐"), "首页应有每日推荐入口");
  console.log("✓ 首页渲染：快捷入口 + 歌单卡片");

  // 歌单增删后首页数量要同步
  const homeCallsBefore = posted.filter((m) => m.type === "command" && m.cmd === "home").length;
  post({ type: "playlistTracks", playlistId: 11, trackId: 1, removed: true });
  await wait();
  assert(
    posted.filter((m) => m.type === "command" && m.cmd === "home").length === homeCallsBefore + 1,
    "歌单变化后首页应自动刷新",
  );
  console.log("✓ 歌单变化触发首页刷新");

  click('.card[data-id="11"]');
  assert(
    posted.some((m) => m.type === "command" && m.cmd === "playlist" && m.payload.id === 11),
    "点击卡片应上抛 playlist 命令",
  );
  console.log("✓ 点击歌单卡片上抛命令");

  const tracks = [track(1, "第一首"), track(2, "第二首"), track(3, "第三首")];
  post({
    type: "list",
    list: { title: "测试歌单", subtitle: "3 首", contextName: "测试歌单", playlistId: 11, tracks },
  });
  await wait();
  assert(content().querySelectorAll(".row").length === 3, "列表应渲染 3 行");
  assert(app.querySelector("#page-title").textContent === "测试歌单", "标题应切换为歌单名");
  console.log("✓ 歌单列表视图渲染");

  click('.row[data-index="1"]');
  const playCommand = posted.filter((m) => m.type === "command" && m.cmd === "playTracks").pop();
  assert(playCommand && playCommand.payload.index === 1 && playCommand.payload.tracks.length === 3, "点击歌曲应上抛 playTracks");
  console.log("✓ 点击歌曲上抛 playTracks（整列表成队列）");

  // 歌单编辑：移除歌曲并同步列表
  click('[data-action="toggle-edit"]');
  await wait();
  const removeBtn = content().querySelector(".row-remove");
  assert(removeBtn, "编辑模式应出现移除按钮");
  const removeId = Number(removeBtn.dataset.id);
  removeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const removeCmd = posted.filter((m) => m.type === "command" && m.cmd === "removeTrack").pop();
  assert(
    removeCmd && removeCmd.payload.playlistId === 11 && removeCmd.payload.trackId === removeId,
    "移除应上抛 removeTrack 命令",
  );
  post({ type: "playlistTracks", playlistId: 11, trackId: removeId, removed: true });
  await wait();
  assert(content().querySelectorAll(".row").length === 2, "移除后列表应减少一行");
  click('[data-action="toggle-edit"]');
  console.log("✓ 歌单编辑与移除状态同步");

  audio.duration = 200;
  post({
    type: "load",
    track: tracks[1],
    url: "https://m800.music.126.net/test.mp3",
    autoplay: true,
    trial: false,
  });
  await wait();
  assert(audio.src.includes("test.mp3"), "load 应设置 audio.src");
  assert(audio.playCalls === 1 && !audio.paused, "autoplay 应调用 play()");
  post({
    type: "snapshot",
    snapshot: {
      ...snapshot,
      current: tracks[1],
      queueLength: 3,
      index: 1,
      playing: true,
      contextName: "测试歌单",
      actualLevel: "lossless",
    },
  });
  await wait();
  assert(app.querySelector("#player .track-line .name").textContent === "第二首", "播放条应显示当前歌曲");
  assert(app.querySelector(".play-btn svg"), "播放按钮应显示图标");
  assert(app.querySelector("#player .track-line .badge").textContent === "无损", "播放条应显示实际音质");
  console.log("✓ 加载音频并更新播放条（含实际音质标签）");

  audio.currentTime = 30;
  audio.dispatchEvent(new window.Event("timeupdate"));
  assert(app.querySelector("#player .time.cur").textContent === "00:30", "进度时间应更新");
  console.log("✓ 进度与时间同步");

  click('[data-action="cycle-mode"]');
  const modeCommand = posted.filter((m) => m.type === "command" && m.cmd === "mode").pop();
  assert(modeCommand?.payload.mode === "shuffle", "模式按钮应切到随机");
  console.log("✓ 播放模式按钮");

  // 控制栏顺序：模式 / 加歌单 / 上一首 / 播放 / 下一首 / 红心 / 队列
  const controlActions = [...app.querySelectorAll(".controls [data-action]")].map((el) => el.dataset.action);
  assert(
    JSON.stringify(controlActions) ===
      JSON.stringify(["cycle-mode", "add-to-playlist", "prev", "toggle", "next", "toggle-like", "open-queue"]),
    `控制栏顺序不对：${controlActions.join(",")}`,
  );
  assert(!app.querySelector('[data-action="toggle-volume"]'), "控制栏不应再有音量按钮");
  console.log("✓ 控制栏顺序与居中播放键");

  // 红心：liked 消息驱动状态，点击上抛 toggleLike
  post({ type: "liked", ids: [tracks[1].id] });
  await wait();
  assert(app.querySelector(".like-btn.active"), "当前曲目已喜欢时红心应点亮");
  click('[data-action="toggle-like"]');
  assert(
    posted.some((m) => m.type === "command" && m.cmd === "toggleLike" && m.payload.id === tracks[1].id),
    "红心应上抛 toggleLike",
  );
  console.log("✓ 播放条红心状态与命令");

  click('[data-action="open-now"]');
  await wait();
  assert(app.querySelector(".now .disc"), "应进入正在播放视图");
  assert(app.querySelector(".now-op.active"), "正在播放页应显示已喜欢");
  post({ type: "liked", ids: [] });
  await wait();
  assert(!app.querySelector(".now-op.active"), "取消喜欢后正在播放页应立刻更新");
  assert(!app.querySelector(".like-btn.active"), "取消喜欢后播放条红心也应熄灭");
  console.log("✓ 正播页红心随状态实时更新");
  assert(posted.some((m) => m.type === "command" && m.cmd === "lyric"), "应请求歌词");
  post({
    type: "lyric",
    lyric: {
      trackId: 2,
      lrc: "[00:00.00]第一行\n[00:10.00]第二行\n[00:20.00]第三行\n[00:30.50]第四行",
      translation: "[00:10.00]translation two",
    },
  });
  await wait();
  assert(content().querySelectorAll(".lyrics .line").length === 4, "应渲染 4 行歌词");
  assert(content().querySelector(".lyrics .line .tr"), "应渲染翻译");
  audio.currentTime = 11;
  audio.dispatchEvent(new window.Event("timeupdate"));
  const activeLines = content().querySelectorAll(".lyrics .line.active");
  assert(activeLines.length === 1, "应有一行高亮");
  assert(activeLines[0].textContent.includes("第二行"), "高亮行应为第二行");
  console.log("✓ 歌词渲染、翻译与高亮");

  click('.lyrics .line[data-index="2"]');
  assert(audio.currentTime === 20, "点击歌词应跳转进度");
  console.log("✓ 点击歌词跳转");

  // 切歌后歌词必须重新请求，旧歌词作废
  const lyricRequestsBefore = posted.filter((m) => m.type === "command" && m.cmd === "lyric").length;
  post({
    type: "snapshot",
    snapshot: {
      ...snapshot,
      current: tracks[2],
      queueLength: 3,
      index: 2,
      playing: true,
      contextName: "测试歌单",
      actualLevel: "exhigh",
    },
  });
  await wait();
  const lyricRequestsAfter = posted.filter((m) => m.type === "command" && m.cmd === "lyric");
  assert(lyricRequestsAfter.length === lyricRequestsBefore + 1, "切歌应重新请求歌词");
  assert(lyricRequestsAfter[lyricRequestsAfter.length - 1].payload.id === tracks[2].id, "请求的应是新曲目 id");
  assert(content().querySelector(".lyrics .placeholder"), "切歌后应清空旧歌词");
  post({ type: "lyric", lyric: { trackId: tracks[1].id, lrc: "[00:00.00]旧歌词", translation: "" } });
  await wait();
  assert(!content().textContent.includes("旧歌词"), "旧曲目的歌词响应应被忽略");
  post({ type: "lyric", lyric: { trackId: tracks[2].id, lrc: "[00:00.00]新歌词\n[00:05.00]第二行", translation: "" } });
  await wait();
  assert(content().querySelectorAll(".lyrics .line").length === 2, "新曲目歌词应渲染");
  console.log("✓ 切歌刷新歌词、丢弃旧响应");

  click('[data-action="back"]');
  await wait();
  assert(app.querySelector("#page-title").textContent === "测试歌单", "返回后应回到歌单");
  console.log("✓ 返回上一视图");

  click('[data-action="open-search"]');
  await wait();
  assert(app.querySelector('[data-field="search"]'), "应显示搜索输入框");
  const input = app.querySelector('[data-field="search"]');
  input.value = "海阔天空";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const searchCommand = posted.filter((m) => m.type === "command" && m.cmd === "search").pop();
  assert(searchCommand?.payload.keyword === "海阔天空", "回车应发起搜索");
  const kindSelect = content().querySelector('select[data-action="search-kind-select"]');
  assert(kindSelect, "搜索类型应为原生下拉");
  kindSelect.value = "playlist";
  kindSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  const kindCommand = posted.filter((m) => m.type === "command" && m.cmd === "search").pop();
  assert(kindCommand?.payload.kind === "playlist", "切换搜索类型应重新搜索");
  post({
    type: "search",
    result: { keyword: "海阔天空", kind: "song", songs: [track(9, "海阔天空")], playlists: [], count: 1, hasMore: false },
  });
  await wait();
  assert(content().textContent.includes("海阔天空"), "应渲染搜索结果");
  click('[data-action="play-result"]');
  assert(posted.some((m) => m.type === "command" && m.cmd === "playTracks" && m.payload.tracks[0].id === 9), "点击结果应播放");
  console.log("✓ 搜索、原生类型下拉与结果播放");

  post({ type: "queue", tracks, index: 1, contextName: "测试歌单" });
  click('[data-action="open-queue"]');
  await wait();
  assert(content().querySelectorAll(".row").length === 3, "队列应渲染 3 首");
  console.log("✓ 播放队列视图");

  click('[data-action="open-settings"]');
  await wait();
  const qualitySelect = content().querySelector('select[data-action="quality-select"]');
  assert(qualitySelect, "设置页应有原生音质下拉框");
  assert(qualitySelect.querySelectorAll("option").length === 8, "音质应有 8 档");
  qualitySelect.value = "jymaster";
  qualitySelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert(
    posted.some((m) => m.type === "command" && m.cmd === "quality" && m.payload.quality === "jymaster"),
    "音质下拉应上抛命令",
  );
  const translation = content().querySelector('input[data-action="translation-check"]');
  assert(translation && translation.checked, "翻译开关应为原生复选框且默认勾选");
  translation.checked = false;
  translation.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert(
    posted.some((m) => m.type === "command" && m.cmd === "translation" && m.payload.value === false),
    "翻译开关应上抛命令",
  );

  // 实时音量：设置页滑块拖动即生效，松手后持久化
  const volumeSlider = content().querySelector('input[data-action="volume-slider"]');
  assert(volumeSlider, "设置页应有音量滑块");
  volumeSlider.value = "35";
  volumeSlider.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert(Math.abs(audio.volume - 0.35) < 0.001, "拖动音量应实时作用到音频");
  assert(content().querySelector(".volume-value").textContent === "35%", "音量数值应实时更新");
  volumeSlider.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert(
    posted.some((m) => m.type === "command" && m.cmd === "volume" && m.payload.value === 35),
    "音量应上抛持久化命令",
  );
  console.log("✓ 设置页：原生音质下拉（8 档）、原生复选框、实时音量");

  const accentSelect = content().querySelector('select[data-action="accent-select"]');
  assert(accentSelect, "设置页应有强调色下拉");
  assert(accentSelect.querySelectorAll("option").length === 7, "强调色应有 7 种");
  accentSelect.value = "blue";
  accentSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert(
    posted.some((m) => m.type === "command" && m.cmd === "accent" && m.payload.value === "blue"),
    "强调色应上抛命令",
  );
  post({ type: "config", config: { quality: "exhigh", translation: true, accent: "blue" } });
  await wait();
  assert(
    window.document.documentElement.style.getPropertyValue("--net-accent") === "#3b82f6",
    "强调色应写入 CSS 变量",
  );
  console.log("✓ 设置页：强调色下拉与主题变量");

  click('[data-action="open-account"]');
  await wait();
  assert(content().textContent.includes("还没有登录"), "未登录应显示登录引导");
  click('[data-action="open-login"]');
  await wait();
  assert(content().querySelectorAll(".tab").length === 4, "登录页应有 4 种方式");
  assert(posted.some((m) => m.type === "command" && m.cmd === "qrLogin"), "打开登录页应请求二维码");
  assert(content().querySelector(".qr-box.placeholder"), "未拿到二维码时应显示占位");
  console.log("✓ 扫码登录：默认面板与二维码请求");

  post({
    type: "qr",
    qr: { key: "qr-key", svg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', status: "waiting", message: "请用网易云音乐 App 扫码登录" },
  });
  await wait();
  assert(content().querySelector(".qr-box svg rect"), "应渲染二维码 SVG");
  assert(content().textContent.includes("扫码登录"), "应显示等待扫码文案");

  post({ type: "qr", qr: { key: "qr-key", svg: "", status: "scanned", message: "已扫码，请在手机上确认登录" } });
  await wait();
  assert(content().textContent.includes("已扫码"), "应显示已扫码状态");
  assert(content().querySelector(".qr-box svg rect"), "状态更新不应丢失二维码");
  console.log("✓ 扫码状态：等待 → 已扫码（保留二维码）");

  const beforeRefresh = posted.filter((m) => m.type === "command" && m.cmd === "qrLogin").length;
  click('[data-action="refresh-qr"]');
  await wait();
  const afterRefresh = posted.filter((m) => m.type === "command" && m.cmd === "qrLogin").length;
  assert(afterRefresh === beforeRefresh + 1, "刷新应重新请求二维码");
  post({ type: "qr", qr: { key: "qr-key-2", svg: '<svg id="qr2"></svg>', status: "expired", message: "二维码已过期，请点击刷新" } });
  await wait();
  assert(content().querySelector(".qr-box.dim"), "过期二维码应置灰");
  console.log("✓ 刷新与过期态");

  click('[data-action="login-tab"][data-tab="password"]');
  await wait();
  assert(content().querySelector('input[name="account"]'), "密码面板应显示");
  const accountInput = content().querySelector('input[name="account"]');
  accountInput.value = "13800000000";
  const passwordInput = content().querySelector('input[name="password"]');
  passwordInput.value = "secret";
  content().querySelector('form[data-form="password"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const loginCommand = posted.filter((m) => m.type === "command" && m.cmd === "loginPassword").pop();
  assert(loginCommand?.payload.account === "13800000000", "登录表单应上抛账号");
  console.log("✓ 密码登录表单提交");

  click('[data-action="login-tab"][data-tab="captcha"]');
  await wait();
  assert(content().querySelector('input[name="captcha"]'), "验证码面板应显示");
  click('[data-action="send-captcha"]');
  assert(posted.some((m) => m.type === "command" && m.cmd === "sendCaptcha"), "应上抛发送验证码");
  console.log("✓ 验证码登录面板");

  // 会员等级：SVIP 徽章与音质档位提示
  post({
    type: "account",
    account: {
      userId: 8945595572,
      nickname: "RL-StarsTwinkle",
      avatarUrl: "",
      vipType: 110,
      vipTier: "svip",
      vipLevel: 7,
      vipExpireAt: 4102444800000,
    },
  });
  await wait();
  click('[data-action="open-account"]');
  await wait();
  const svipToken = content().querySelector(".vip-token.svip");
  assert(svipToken, "账号页应显示 SVIP token");
  assert(svipToken.textContent.includes("SVIP"), "token 应含 SVIP 文案");
  assert(svipToken.textContent.includes("LV7"), "token 应保留等级");
  assert(content().querySelector(".avatar-ring.svip"), "SVIP 头像应有金色描边");
  assert(content().textContent.includes("黑胶SVIP"), "账号页应显示黑胶SVIP");
  assert(content().textContent.includes("LV.7"), "账号页应显示等级");
  assert(content().textContent.includes("到期"), "账号页应显示到期时间");
  click('[data-action="open-settings"]');
  await wait();
  const svipOptions = [...content().querySelectorAll("select[data-action='quality-select'] option")].map((o) => o.textContent);
  assert(svipOptions.length === 8, "设置页仍应有 8 档");
  assert(!svipOptions.some((text) => text.includes("需 SVIP")), "SVIP 用户不应看到「需 SVIP」提示");
  assert(content().querySelector(".vip-token.svip"), "设置页也应显示会员 token");
  console.log("✓ 会员探测：SVIP token（含等级）+ 金色头像描边 + 无「需 SVIP」提示");

  post({
    type: "account",
    account: {
      userId: 1,
      nickname: "普通会员",
      avatarUrl: "",
      vipType: 11,
      vipTier: "vip",
      vipLevel: 3,
      vipExpireAt: 4102444800000,
    },
  });
  await wait();
  click('[data-action="open-settings"]');
  await wait();
  const vipOptions = [...content().querySelectorAll("select[data-action='quality-select'] option")].map((o) => o.textContent);
  assert(vipOptions.some((text) => text.includes("需 SVIP")), "非 SVIP 用户应看到「需 SVIP」提示");
  const vipToken = content().querySelector(".vip-token.vip");
  assert(vipToken && vipToken.textContent.includes("LV3"), "VIP token 应显示自己的等级");
  console.log("✓ 非 SVIP 账号：VIP token（LV3）与「需 SVIP」提示");

  post({ type: "queue", tracks: [], index: -1, contextName: "" });
  assert(errors.length === 0, `控制台不应有错误：${errors.join("; ")}`);
  console.log("\nUI 集成测试全部通过");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nUI 集成测试失败：", err);
  if (errors.length) console.error("运行时错误：", errors);
  process.exit(1);
});
