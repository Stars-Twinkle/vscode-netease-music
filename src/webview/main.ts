import "./style.css";
import type {
  AccountInfo,
  HomeData,
  HostMessage,
  PlayerSnapshot,
  PlayMode,
  QrState,
  Quality,
  SearchResult,
  Track,
  TrackList,
  VipTier,
} from "../protocol";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

type ViewName = "home" | "list" | "search" | "account" | "login" | "now" | "queue" | "settings";
type LoginTab = "qr" | "password" | "captcha" | "cookie";

/* ------------------------------------------------------------------ 图标 */

const ICON: Record<string, string> = {
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5"/>',
  settings:
    '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.7M8 12.5v1.7M2.6 4.8l1.5.85M11.9 10.35l1.5.85M2.6 11.2l1.5-.85M11.9 5.65l1.5-.85"/>',
  user: '<circle cx="8" cy="5.6" r="2.6"/><path d="M2.9 13.4c.6-2.4 2.6-3.7 5.1-3.7s4.5 1.3 5.1 3.7"/>',
  back: '<path d="M9.8 3.6 5.4 8l4.4 4.4"/>',
  play: '<path d="M5.2 3.3v9.4l7.6-4.7z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="4.3" y="3.3" width="2.6" height="9.4" rx="0.9" fill="currentColor" stroke="none"/><rect x="9.1" y="3.3" width="2.6" height="9.4" rx="0.9" fill="currentColor" stroke="none"/>',
  prev: '<path d="M4.3 3.4v9.2" /><path d="M12.4 3.4v9.2L5.9 8z" fill="currentColor" stroke="none"/>',
  next: '<path d="M11.7 3.4v9.2"/><path d="M3.6 3.4v9.2L10.1 8z" fill="currentColor" stroke="none"/>',
  repeat: '<path d="M3 6.6a3 3 0 0 1 3-3h6l-1.8-1.8M13 9.4a3 3 0 0 1-3 3H4l1.8 1.8"/>',
  repeatOne:
    '<path d="M3 6.6a3 3 0 0 1 3-3h6l-1.8-1.8M13 9.4a3 3 0 0 1-3 3H4l1.8 1.8"/><path d="M8.4 6.2 7.2 6.9M8 6.2v3.3" stroke-width="1.3"/>',
  shuffle: '<path d="M2.6 4.4h2.2l6.6 7.2h2M2.6 11.6h2.2l6.6-7.2h2"/>',
  volume:
    '<path d="M8.4 3.1 5.3 5.7H3.2v4.6h2.1l3.1 2.6z"/><path d="M10.6 6a2.8 2.8 0 0 1 0 4M12.4 4.3a5.2 5.2 0 0 1 0 7.4"/>',
  volumeX: '<path d="M8.4 3.1 5.3 5.7H3.2v4.6h2.1l3.1 2.6z"/><path d="m10.7 6.4 3 3.2M13.7 6.4l-3 3.2"/>',
  list: '<path d="M5.4 4.2h7.8M5.4 8h7.8M5.4 11.8h7.8"/><circle cx="2.9" cy="4.2" r="0.8" fill="currentColor"/><circle cx="2.9" cy="8" r="0.8" fill="currentColor"/><circle cx="2.9" cy="11.8" r="0.8" fill="currentColor"/>',
  heart:
    '<path d="M8 13s-4.9-2.9-4.9-6.1A2.7 2.7 0 0 1 8 5.1a2.7 2.7 0 0 1 4.9 1.8C12.9 10.1 8 13 8 13z"/>',
  heartFilled:
    '<path d="M8 13s-4.9-2.9-4.9-6.1A2.7 2.7 0 0 1 8 5.1a2.7 2.7 0 0 1 4.9 1.8C12.9 10.1 8 13 8 13z" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="2.8" y="3.6" width="10.4" height="9.6" rx="1.4"/><path d="M2.8 6.4h10.4M5.6 2.4v2.4M10.4 2.4v2.4"/>',
  music: '<path d="M11.8 3.2v6.6"/><circle cx="9.9" cy="11" r="1.9"/><path d="M11.8 5.1 6 6.4"/><circle cx="4.1" cy="12.2" r="1.7"/>',
  more: '<circle cx="3.4" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.6" cy="8" r="1" fill="currentColor"/>',
  playlistAdd:
    '<path d="M2.6 4.2h10.8M2.6 8h7.6M2.6 11.8h5.4"/><path d="M12.2 9.6v4.6M9.9 11.9h4.6"/>',
  minus: '<path d="M3.6 8h8.8"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.6v2.9h-2.9"/>',
  clock: '<circle cx="8" cy="8" r="5.2"/><path d="M8 5v3.2l2 1.2"/>',
};

function icon(name: string): string {
  const body = ICON[name] ?? "";
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/* ------------------------------------------------------------------ 工具 */

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cover(url: string | undefined, size: number): string {
  if (!url) return "";
  const base = url.replace(/^http:/, "https:");
  if (/[?&]param=/.test(base)) return esc(base);
  return esc(`${base}${base.includes("?") ? "&" : "?"}param=${size}y${size}`);
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtCount(value: number | undefined): string {
  if (!value) return "";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

/** 网易云 fee=1 表示 VIP 歌曲（会员可听）；4 是购买专辑，8 是会员高音质。 */
function isVipTrack(track: Track | null | undefined): boolean {
  return track?.fee === 1;
}

function vipBadge(track: Track | null | undefined): string {
  return isVipTrack(track) ? `<span class="vip-tag" title="VIP 歌曲">VIP</span>` : "";
}

const MODE_META: Record<PlayMode, { icon: string; label: string }> = {
  order: { icon: "repeat", label: "列表循环" },
  shuffle: { icon: "shuffle", label: "随机播放" },
  single: { icon: "repeatOne", label: "单曲循环" },
};

const QUALITY_META: Array<{ value: Quality; label: string; desc: string }> = [
  { value: "standard", label: "标准", desc: "128 kbps" },
  { value: "higher", label: "较高", desc: "192 kbps" },
  { value: "exhigh", label: "极高", desc: "320 kbps" },
  { value: "lossless", label: "无损", desc: "FLAC 16-bit" },
  { value: "hires", label: "高解析度无损", desc: "Hi-Res 24-bit" },
  { value: "jyeffect", label: "高清臻音", desc: "24-bit · SVIP" },
  { value: "sky", label: "沉浸环绕声", desc: "5.1 声道 · SVIP" },
  { value: "jymaster", label: "超清母带", desc: "Master · SVIP" },
];

/** 服务端返回的 level → 播放条上的短标签 */
const LEVEL_LABEL: Record<string, string> = {
  standard: "标准",
  higher: "较高",
  exhigh: "极高",
  lossless: "无损",
  hires: "Hi-Res",
  jyeffect: "臻音",
  sky: "沉浸",
  jymaster: "母带",
};

const VIP_META: Record<VipTier, { label: string; short: string }> = {
  none: { label: "普通用户", short: "" },
  music: { label: "音乐包", short: "音乐包" },
  vip: { label: "黑胶VIP", short: "VIP" },
  svip: { label: "黑胶SVIP", short: "SVIP" },
};

/** 标“需 SVIP”的音质档位 */
const SVIP_LEVELS = new Set<Quality>(["jyeffect", "sky", "jymaster"]);

/** 强调色设置项 → CSS 颜色 */
const ACCENT_MAP: Record<string, string> = {
  theme: "var(--vscode-focusBorder, #007fd4)",
  red: "#ec4141",
  blue: "#3b82f6",
  purple: "#a855f7",
  green: "#22c55e",
  orange: "#f97316",
  cyan: "#06b6d4",
};

const ACCENT_LABELS: Array<{ value: string; label: string }> = [
  { value: "theme", label: "跟随主题色" },
  { value: "red", label: "红色" },
  { value: "blue", label: "蓝色" },
  { value: "purple", label: "紫色" },
  { value: "green", label: "绿色" },
  { value: "orange", label: "橙色" },
  { value: "cyan", label: "青色" },
];

function fmtDate(ts: number): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 网易云客户端风格的会员 token：金色黑胶圆标 + 深色胶囊 + 等级。 */
function vipToken(tier: VipTier, level: number): string {
  if (tier === "none") return "";
  const label = tier === "svip" ? "SVIP" : tier === "vip" ? "VIP" : "音乐包";
  const lv = level > 0 ? `·LV${level}` : "";
  return `<span class="vip-token ${tier}"><i class="vip-disc"></i><span class="vip-label">${label}${lv}</span></span>`;
}

function vipLabelText(tier: VipTier): string {
  return VIP_META[tier].label;
}

interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

function parseLrc(lrc: string, translation: string): LyricLine[] {
  const read = (raw: string): Array<{ time: number; text: string }> => {
    const out: Array<{ time: number; text: string }> = [];
    for (const line of raw.split(/\r?\n/)) {
      const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
      if (!stamps.length) continue;
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      if (!text) continue;
      for (const match of stamps) {
        const ms = match[3] ? Number(match[3].padEnd(3, "0").slice(0, 3)) / 1000 : 0;
        out.push({ time: Number(match[1]) * 60 + Number(match[2]) + ms, text });
      }
    }
    return out.sort((a, b) => a.time - b.time);
  };
  const base = read(lrc);
  const extra = read(translation);
  const map = new Map<string, string>();
  for (const item of extra) map.set(item.time.toFixed(2), item.text);
  return base.map((line) => ({
    time: line.time,
    text: line.text,
    translation: map.get(line.time.toFixed(2)),
  }));
}

/* ------------------------------------------------------------------ 应用 */

interface QueueData {
  tracks: Track[];
  index: number;
  contextName: string;
}

class App {
  private readonly root = document.getElementById("app") as HTMLElement;
  private readonly audio = new Audio();

  private snapshot: PlayerSnapshot | null = null;
  private account: AccountInfo | null = null;
  private home: HomeData | null = null;
  private list: TrackList | null = null;
  private searchResult: SearchResult | null = null;
  private queueData: QueueData | null = null;
  private lyricLines: LyricLine[] = [];
  private activeLyric = -1;
  private lyricLoading = false;

  private view: ViewName = "home";
  private readonly stack: ViewName[] = [];
  private loginTab: LoginTab = "qr";
  private qr: QrState | null = null;
  private searchDraft = "";
  private lastSearchSeq = 0;
  private searchKind: "song" | "playlist" = "song";
  private renderLimit = 300;
  private editingList = false;
  private dragging = false;
  private translationEnabled = true;
  private accent = "theme";
  private likedIds = new Set<number>();
  private lastTimeReport = 0;
  private readonly busy = new Set<string>();

  private headerEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private playerEl!: HTMLElement;
  private progressEl?: HTMLInputElement;
  private currentTimeEl?: HTMLElement;
  private totalTimeEl?: HTMLElement;

  mount(): void {
    this.root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn back" data-action="back" title="返回" hidden>${icon("back")}</button>
        <div class="titles">
          <div class="title" id="page-title">Netease Music</div>
          <div class="sub" id="page-sub"></div>
        </div>
        <div class="tools">
          <button class="icon-btn" data-action="open-search" title="搜索">${icon("search")}</button>
          <button class="icon-btn" data-action="open-settings" title="设置">${icon("settings")}</button>
          <button class="icon-btn" data-action="open-account" title="我的">${icon("user")}</button>
        </div>
      </header>
      <main class="content" id="content"></main>
      <footer class="player" id="player"></footer>
    `;
    this.headerEl = this.root.querySelector(".topbar") as HTMLElement;
    this.contentEl = this.root.querySelector("#content") as HTMLElement;
    this.playerEl = this.root.querySelector("#player") as HTMLElement;

    this.buildPlayer();
    this.bindEvents();
    this.renderHeader();
    this.renderContent();

    this.audio.preload = "auto";
    this.audio.addEventListener("timeupdate", () => this.onTimeUpdate());
    this.audio.addEventListener("durationchange", () => this.updateProgress());
    this.audio.addEventListener("ended", () => vscode.postMessage({ type: "audio", event: "ended" }));
    this.audio.addEventListener("play", () => {
      this.updatePlayButton();
      this.updateDisc();
      vscode.postMessage({ type: "audio", event: "play" });
    });
    this.audio.addEventListener("pause", () => {
      this.updatePlayButton();
      this.updateDisc();
      vscode.postMessage({ type: "audio", event: "pause" });
    });
    this.audio.addEventListener("error", () => {
      const code = this.audio.error?.code ?? 0;
      const messages: Record<number, string> = {
        1: "播放被中止",
        2: "网络错误，音频无法加载",
        3: "音频解码失败",
        4: "音频格式不支持或地址已过期",
      };
      vscode.postMessage({ type: "audio", event: "error", message: messages[code] ?? `播放失败（${code}）` });
    });
  }

  /* ---------------------------------------------------------------- 骨架 */

  private buildPlayer(): void {
    this.playerEl.innerHTML = `
      <div class="track-line">
        <div class="cover" data-action="open-now"><div class="ph"></div></div>
        <div class="meta" data-action="open-now">
          <div class="name">未在播放</div>
          <div class="by">选择一首歌开始</div>
        </div>
        <span class="badge" hidden>试听</span>
      </div>
      <div class="progress-line">
        <span class="time cur">00:00</span>
        <input class="progress" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度" />
        <span class="time total">00:00</span>
      </div>
      <div class="controls">
        <button class="icon-btn mode" data-action="cycle-mode" title="列表循环">${icon("repeat")}</button>
        <button class="icon-btn" data-action="add-to-playlist" title="添加到歌单">${icon("playlistAdd")}</button>
        <button class="icon-btn" data-action="prev" title="上一首">${icon("prev")}</button>
        <button class="icon-btn play-btn" data-action="toggle" title="播放 / 暂停">${icon("play")}</button>
        <button class="icon-btn" data-action="next" title="下一首">${icon("next")}</button>
        <button class="icon-btn like-btn" data-action="toggle-like" title="喜欢">${icon("heart")}</button>
        <button class="icon-btn" data-action="open-queue" title="播放队列">${icon("list")}</button>
      </div>
    `;
    this.progressEl = this.playerEl.querySelector(".progress") as HTMLInputElement;
    this.currentTimeEl = this.playerEl.querySelector(".time.cur") as HTMLElement;
    this.totalTimeEl = this.playerEl.querySelector(".time.total") as HTMLElement;

    this.progressEl.addEventListener("input", () => {
      this.dragging = true;
      const ratio = Number(this.progressEl?.value ?? 0) / 1000;
      this.progressEl?.style.setProperty("--range-progress", `${(ratio * 100).toFixed(2)}%`);
      if (this.currentTimeEl) this.currentTimeEl.textContent = fmtTime(ratio * this.duration());
    });
    const commit = () => {
      if (!this.dragging) return;
      this.dragging = false;
      const ratio = Number(this.progressEl?.value ?? 0) / 1000;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.audio.currentTime = ratio * this.audio.duration;
      }
    };
    this.progressEl.addEventListener("change", commit);
    this.progressEl.addEventListener("pointerup", commit);
  }

  private bindEvents(): void {
    this.root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!target) return;
      void this.onAction(target.dataset.action ?? "", target);
    });

    this.contentEl.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      void this.onSubmit(form);
    });

    this.contentEl.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      if (target.dataset.field === "search") this.searchDraft = target.value;
      if (target.dataset.action === "volume-slider") {
        const value = Number(target.value);
        this.audio.volume = value / 100;
        this.audio.muted = value === 0;
        target.style.setProperty("--range-progress", `${value}%`);
        const label = this.contentEl.querySelector(".volume-value");
        if (label) label.textContent = `${value}%`;
      }
    });

    this.contentEl.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      switch (target.dataset.action) {
        case "quality-select":
          vscode.postMessage({
            type: "command",
            cmd: "quality",
            payload: { quality: (target as HTMLSelectElement).value },
          });
          break;
        case "translation-check":
          vscode.postMessage({
            type: "command",
            cmd: "translation",
            payload: { value: (target as HTMLInputElement).checked },
          });
          break;
        case "search-kind-select": {
          const kind = (target as HTMLSelectElement).value === "playlist" ? "playlist" : "song";
          if (kind === this.searchKind) return;
          this.searchKind = kind;
          if (this.searchDraft.trim()) this.runSearch();
          break;
        }
        case "volume-slider":
          vscode.postMessage({
            type: "command",
            cmd: "volume",
            payload: { value: Number((target as HTMLInputElement).value) },
          });
          break;
        case "accent-select":
          vscode.postMessage({
            type: "command",
            cmd: "accent",
            payload: { value: (target as HTMLSelectElement).value },
          });
          break;
        default:
          break;
      }
    });

    this.contentEl.addEventListener("keydown", (event) => {
      const target = event.target as HTMLInputElement;
      if (event.key !== "Enter") return;
      if (target.dataset.field === "search") {
        event.preventDefault();
        this.runSearch();
      }
    });
  }

  /* ---------------------------------------------------------------- 消息 */

  onMessage(message: HostMessage): void {
    switch (message.type) {
      case "snapshot":
        this.applySnapshot(message.snapshot);
        break;
      case "load":
        this.audio.pause();
        this.audio.src = message.url;
        this.audio.volume = this.mutedVolume();
        this.audio.muted = Boolean(this.snapshot?.muted);
        if (message.startAt && message.startAt > 0) {
          const startAt = message.startAt;
          const seekOnce = () => {
            this.audio.currentTime = startAt;
            this.audio.removeEventListener("loadedmetadata", seekOnce);
          };
          this.audio.addEventListener("loadedmetadata", seekOnce);
        }
        if (message.autoplay) this.playSafely();
        this.updatePlayButton();
        break;
      case "account":
        this.account = message.account;
        if (message.account) this.qr = null;
        if (this.view === "account" || this.view === "home") this.renderContent();
        break;
      case "home":
        this.home = message.data;
        if (this.account !== message.data.account) this.account = message.data.account;
        if (this.view === "home") this.renderContent();
        break;
      case "list":
        this.list = message.list;
        this.renderLimit = 300;
        this.editingList = false;
        this.pushView("list", false);
        break;
      case "search":
        // 只接受最新一次搜索的结果，避免旧响应覆盖新结果
        if (typeof message.result.seq === "number" && message.result.seq < this.lastSearchSeq) break;
        if (typeof message.result.seq === "number") this.lastSearchSeq = message.result.seq;
        this.searchResult = message.result;
        this.searchDraft = message.result.keyword;
        if (this.view !== "search") this.pushView("search", false);
        else this.renderContent();
        break;
      case "queue":
        this.queueData = { tracks: message.tracks, index: message.index, contextName: message.contextName };
        if (this.view === "queue") this.renderContent();
        break;
      case "lyric":
        if (this.snapshot?.current && message.lyric.trackId !== this.snapshot.current.id) break;
        this.lyricLoading = false;
        this.lyricLines = parseLrc(message.lyric.lrc, message.lyric.translation);
        this.activeLyric = -1;
        if (this.view === "now") this.renderLyrics();
        break;
      case "qr": {
        const svg = message.qr.svg || this.qr?.svg || "";
        this.qr = { ...message.qr, svg };
        if (this.view === "login" && this.loginTab === "qr") this.renderContent();
        break;
      }
      case "liked":
        this.likedIds = new Set(message.ids);
        if (this.snapshot?.current) this.snapshot.liked = this.likedIds.has(this.snapshot.current.id);
        if (this.view === "now" || this.view === "list" || this.view === "queue") this.renderContent();
        this.updatePlayerLike();
        break;
      case "playlistTracks":
        if (this.list?.playlistId === message.playlistId) {
          if (message.removed) {
            this.list.tracks = this.list.tracks.filter((track) => track.id !== message.trackId);
          } else if (
            this.snapshot?.current &&
            this.snapshot.current.id === message.trackId &&
            !this.list.tracks.some((track) => track.id === message.trackId)
          ) {
            this.list.tracks.push(this.snapshot.current);
          }
          this.list.trackCount = this.list.tracks.length;
          this.list.subtitle = `${this.list.tracks.length} 首`;
          if (this.view === "list") this.renderContent();
        }
        // 首页的「我的歌单」数量也要跟着变
        this.home = null;
        vscode.postMessage({ type: "command", cmd: "home" });
        break;
      case "toast":
        this.toast(message.level, message.message);
        break;
      case "busy":
        if (message.active) this.busy.add(message.scope);
        else this.busy.delete(message.scope);
        this.updateBusyBar();
        break;
      case "config":
        if (this.snapshot) {
          this.snapshot.quality = message.config.quality;
          this.snapshot.preferredQuality = message.config.preferredQuality;
        }
        this.translationEnabled = message.config.translation;
        this.applyAccent(message.config.accent);
        if (this.view === "settings" || this.view === "now") this.renderContent();
        break;
      case "ui":
        if (message.action === "search") this.pushView("search");
        else if (message.action === "nowplaying") this.openNow();
        else if (message.action === "login") {
          this.loginTab = "qr";
          this.pushView("login");
        } else if (message.action === "home") this.goHome();
        else if (message.action === "reload") this.reloadCurrent();
        break;
      case "control":
        if (message.action === "toggle") this.toggle();
        else if (message.action === "play") this.playSafely();
        else if (message.action === "pause") this.audio.pause();
        else if (message.action === "stop") {
          this.audio.pause();
          this.audio.removeAttribute("src");
          this.audio.load();
          this.updatePlayButton();
        } else if (message.action === "volume") {
          const value = Number(message.value ?? 70);
          this.audio.volume = value / 100;
          this.audio.muted = value === 0;
        }
        break;
    }
  }

  private applySnapshot(snapshot: PlayerSnapshot): void {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    this.updatePlayer(snapshot);
    const trackChanged = previous?.current?.id !== snapshot.current?.id;
    if (trackChanged) {
      // 换歌后旧歌词必须作废，否则会一直停留在上一首的歌词上
      this.lyricLines = [];
      this.activeLyric = -1;
      if (this.view === "now" && snapshot.current) this.requestLyric(snapshot.current.id);
    }
    if (this.view === "queue" && (trackChanged || previous?.queueLength !== snapshot.queueLength)) this.renderContent();
    else if (this.view === "now") {
      if (trackChanged) this.renderContent();
      else this.updateDisc();
    }
  }

  private requestLyric(trackId: number): void {
    this.lyricLoading = true;
    vscode.postMessage({ type: "command", cmd: "lyric", payload: { id: trackId } });
  }

  /* ---------------------------------------------------------------- 视图 */

  private pushView(view: ViewName, pushStack = true): void {
    if (this.view !== view && pushStack) this.stack.push(this.view);
    this.view = view;
    if (view === "queue") vscode.postMessage({ type: "command", cmd: "queue" });
    if (view === "now" && this.snapshot?.current) {
      this.requestLyric(this.snapshot.current.id);
    }
    if (view === "login" && this.loginTab === "qr" && !this.qr) this.requestQr();
    if (view === "home") this.ensureHome();
    this.renderHeader();
    this.renderContent();
  }

  private requestQr(): void {
    this.qr = { key: "", svg: "", status: "loading", message: "正在生成二维码…" };
    vscode.postMessage({ type: "command", cmd: "qrLogin" });
  }

  private back(): void {
    const previous = this.stack.pop();
    this.view = previous ?? "home";
    if (this.view === "home") this.ensureHome();
    this.renderHeader();
    this.renderContent();
  }

  /** 首页数据缺失时补一次请求，避免停留在「正在加载推荐…」。 */
  private ensureHome(): void {
    if (!this.home) vscode.postMessage({ type: "command", cmd: "home" });
  }

  private goHome(): void {
    this.stack.length = 0;
    this.view = "home";
    this.home = null;
    vscode.postMessage({ type: "command", cmd: "home" });
    this.renderHeader();
    this.renderContent();
  }

  private openNow(): void {
    if (!this.snapshot?.current) {
      this.toast("info", "还没有在播放的歌曲");
      return;
    }
    if (this.view === "now") return;
    this.pushView("now");
  }

  private reloadCurrent(): void {
    switch (this.view) {
      case "home":
        this.home = null;
        vscode.postMessage({ type: "command", cmd: "home" });
        break;
      case "list":
        if (this.list?.playlistId) {
          vscode.postMessage({ type: "command", cmd: "playlist", payload: { id: this.list.playlistId } });
        } else if (this.list?.title === "每日推荐") {
          vscode.postMessage({ type: "command", cmd: "daily" });
        }
        break;
      case "search":
        this.runSearch();
        break;
      case "queue":
        vscode.postMessage({ type: "command", cmd: "queue" });
        break;
      default:
        break;
    }
  }

  private renderHeader(): void {
    const titles: Record<ViewName, [string, string]> = {
      home: [
        "Netease Music",
        this.account
          ? `${this.account.nickname}${
              this.account.vipTier === "none"
                ? ""
                : ` · ${VIP_META[this.account.vipTier].short}${this.account.vipLevel > 0 ? ` LV${this.account.vipLevel}` : ""}`
            }`
          : "未登录",
      ],
      list: [this.list?.title ?? "歌单", this.list?.subtitle ?? ""],
      search: ["搜索", "找到你想要的音乐"],
      account: ["我的", this.account ? this.account.nickname : "登录网易云"],
      login: ["登录", "登录后可同步歌单与每日推荐"],
      now: ["正在播放", this.snapshot?.current?.artists.join(" / ") ?? ""],
      queue: ["播放队列", this.snapshot ? `${this.snapshot.queueLength} 首` : ""],
      settings: ["设置", "播放与显示偏好"],
    };
    const [title, sub] = titles[this.view];
    const titleEl = this.headerEl.querySelector("#page-title") as HTMLElement;
    const subEl = this.headerEl.querySelector("#page-sub") as HTMLElement;
    titleEl.textContent = title;
    if (this.view === "home" && this.account) {
      subEl.innerHTML = `${esc(this.account.nickname)}${vipToken(this.account.vipTier, this.account.vipLevel)}`;
    } else {
      subEl.textContent = sub;
    }
    const backBtn = this.headerEl.querySelector(".back") as HTMLElement;
    backBtn.hidden = this.view === "home";
  }

  private renderContent(): void {
    const active = document.activeElement as HTMLInputElement | null;
    const focusField = active?.dataset?.field;
    const selection = active?.selectionStart ?? null;

    let html = "";
    switch (this.view) {
      case "home":
        html = this.viewHome();
        break;
      case "list":
        html = this.viewList();
        break;
      case "search":
        html = this.viewSearch();
        break;
      case "account":
        html = this.viewAccount();
        break;
      case "login":
        html = this.viewLogin();
        break;
      case "now":
        html = this.viewNow();
        break;
      case "queue":
        html = this.viewQueue();
        break;
      case "settings":
        html = this.viewSettings();
        break;
    }
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.innerHTML = html;
    this.contentEl.scrollTop = this.view === "now" ? 0 : scrollTop;
    this.renderHeader();
    this.updateBusyBar();
    if (this.view === "now") {
      this.renderLyrics();
      this.updateDisc();
    }
    if (focusField) {
      const restored = this.contentEl.querySelector<HTMLInputElement>(`[data-field="${focusField}"]`);
      if (restored) {
        restored.focus();
        if (selection !== null) restored.setSelectionRange(selection, selection);
      }
    }
  }

  private viewHome(): string {
    const home = this.home;
    if (!home) {
      return `<div class="empty"><div class="empty-icon">${icon("music")}</div>正在加载推荐…</div>`;
    }
    const cards = home.recommend
      .map(
        (playlist) => `
        <div class="card" data-action="open-playlist" data-id="${playlist.id}" title="${esc(playlist.name)}">
          <div class="thumb">
            ${playlist.coverUrl ? `<img src="${cover(playlist.coverUrl, 220)}" alt="" loading="lazy" />` : ""}
            ${playlist.playCount ? `<span class="play-count">${icon("play")}${fmtCount(playlist.playCount)}</span>` : ""}
          </div>
          <div class="name">${esc(playlist.name)}</div>
        </div>`,
      )
      .join("");
    const mine = home.mine.length
      ? home.mine
          .slice(0, 60)
          .map(
            (playlist) => `
        <div class="row" data-action="open-playlist" data-id="${playlist.id}">
          <div class="thumb-sm">${playlist.coverUrl ? `<img src="${cover(playlist.coverUrl, 80)}" alt="" loading="lazy" />` : ""}</div>
          <div class="body">
            <div class="name">${esc(playlist.name)}</div>
            <div class="by">${playlist.trackCount} 首${playlist.subscribed ? " · 已收藏" : ""}</div>
          </div>
          <span class="dur">›</span>
        </div>`,
          )
          .join("")
      : `<div class="note">${home.loggedIn ? "还没有创建或收藏歌单" : "登录后显示你的歌单"}</div>`;
    return `
      <div class="quick">
        <button class="quick-item" data-action="open-daily">
          <span class="ico">${icon("calendar")}</span><span class="label">每日推荐</span>
        </button>
        <button class="quick-item" data-action="open-liked">
          <span class="ico">${icon("heart")}</span><span class="label">我喜欢的</span>
        </button>
        <button class="quick-item" data-action="open-search">
          <span class="ico">${icon("search")}</span><span class="label">搜索</span>
        </button>
      </div>
      <div class="section-title">推荐歌单 <span class="hint">根据你的口味</span></div>
      ${cards ? `<div class="grid">${cards}</div>` : `<div class="empty">暂无推荐，稍后再试</div>`}
      <div class="section-title">我的歌单 <span class="hint">${home.mine.length ? `${home.mine.length} 个` : ""}</span></div>
      ${mine}
    `;
  }

  private viewList(): string {
    const list = this.list;
    if (!list) return `<div class="empty">加载中…</div>`;
    const tracks = list.tracks;
    const editable = this.editingList && Boolean(list.playlistId);
    const rows = tracks
      .slice(0, this.renderLimit)
      .map((track, index) => this.trackRow(track, index, "play-index", editable))
      .join("");
    const more =
      tracks.length > this.renderLimit
        ? `<button class="btn ghost block" data-action="more" style="margin-top:8px">显示更多（还有 ${tracks.length - this.renderLimit} 首）</button>`
        : "";
    return `
      <div class="list-head">
        ${list.coverUrl ? `<div class="cover"><img src="${cover(list.coverUrl, 180)}" alt="" /></div>` : ""}
        <div class="info">
          <div class="name">${esc(list.title)}</div>
          <div class="desc">${esc([list.subtitle, list.description?.slice(0, 60)].filter(Boolean).join(" · "))}</div>
          <div class="ops">
            <button class="btn" data-action="play-all">${icon("play")}播放全部</button>
            ${
              list.playlistId
                ? `<button class="btn ghost" data-action="toggle-edit">${this.editingList ? "完成" : "编辑"}</button>`
                : ""
            }
          </div>
        </div>
      </div>
      <div class="rows">${rows || `<div class="empty">这个歌单还没有歌曲</div>`}</div>
      ${more}
    `;
  }

  private trackRow(track: Track, index: number, action: string, editable = false): string {
    const playing = this.snapshot?.current?.id === track.id;
    const liked = this.likedIds.has(track.id);
    return `
      <div class="row${playing ? " playing" : ""}" data-action="${action}" data-index="${index}" title="${esc(track.name)}">
        <span class="idx">${playing ? `<span class="eq"><i></i><i></i><i></i></span>` : index + 1}</span>
        <div class="body">
          <div class="name">${esc(track.name)}${vipBadge(track)}</div>
          <div class="by">${esc(track.artists.join(" / "))}</div>
        </div>
        <button class="row-like${liked ? " active" : ""}" data-action="like-row" data-id="${track.id}" title="${liked ? "取消喜欢" : "喜欢"}">${icon(liked ? "heartFilled" : "heart")}</button>
        ${
          editable
            ? `<button class="row-remove" data-action="remove-track" data-id="${track.id}" title="从歌单移除">${icon("minus")}</button>`
            : ""
        }
        <span class="dur">${fmtTime(track.duration / 1000)}</span>
      </div>`;
  }

  private viewSearch(): string {
    const result = this.searchResult;
    const body = result
      ? result.kind === "song"
        ? result.songs.length
          ? result.songs
              .map((track, index) => `
                <div class="row" data-action="play-result" data-index="${index}" title="${esc(track.name)}">
                  <span class="idx">${index + 1}</span>
                  <div class="body">
                    <div class="name">${esc(track.name)}${vipBadge(track)}</div>
                    <div class="by">${esc(track.artists.join(" / "))}${track.album ? ` · ${esc(track.album)}` : ""}</div>
                  </div>
                  <span class="dur">${fmtTime(track.duration / 1000)}</span>
                </div>`)
              .join("")
          : `<div class="empty"><div class="empty-icon">${icon("search")}</div>没有找到相关歌曲</div>`
        : result.playlists.length
          ? result.playlists
              .map(
                (playlist) => `
              <div class="row" data-action="open-playlist" data-id="${playlist.id}">
                <div class="thumb-sm">${playlist.coverUrl ? `<img src="${cover(playlist.coverUrl, 80)}" alt="" loading="lazy" />` : ""}</div>
                <div class="body">
                  <div class="name">${esc(playlist.name)}</div>
                  <div class="by">${playlist.trackCount} 首${playlist.creatorName ? ` · ${esc(playlist.creatorName)}` : ""}</div>
                </div>
              </div>`,
              )
              .join("")
          : `<div class="empty">没有找到相关歌单</div>`
      : `<div class="empty"><div class="empty-icon">${icon("search")}</div>输入关键词搜索歌曲或歌单</div>`;
    return `
      <div class="search-bar">
        <input data-field="search" placeholder="搜索歌曲 / 歌单" value="${esc(this.searchDraft)}" />
        <select class="native-select compact" data-action="search-kind-select" aria-label="搜索类型">
          <option value="song"${this.searchKind === "song" ? " selected" : ""}>单曲</option>
          <option value="playlist"${this.searchKind === "playlist" ? " selected" : ""}>歌单</option>
        </select>
        <button class="btn" data-action="do-search" title="搜索">${icon("search")}</button>
      </div>
      ${body}
    `;
  }

  private viewAccount(): string {
    if (!this.account) {
      return `
        <div class="empty">
          <div class="empty-icon">${icon("user")}</div>
          <div>还没有登录网易云账号</div>
          <div style="margin-top:10px"><button class="btn" data-action="open-login">去登录</button></div>
        </div>`;
    }
    const account = this.account;
    const token = vipToken(account.vipTier, account.vipLevel);
    const ring = account.vipTier === "none" ? "" : ` ${account.vipTier}`;
    const expire = account.vipExpireAt ? `${fmtDate(account.vipExpireAt)} 到期` : "未开通";
    const levelText = account.vipLevel > 0 ? ` · LV.${account.vipLevel}` : "";
    return `
      <div class="profile">
        <div class="avatar-ring${ring}">
          ${account.avatarUrl ? `<img src="${cover(account.avatarUrl, 96)}" alt="" />` : `<img alt="" />`}
        </div>
        <div class="info">
          <div class="name">${esc(account.nickname)}</div>
          <div class="sub">${token}<span class="uid">UID ${account.userId}</span></div>
        </div>
      </div>
      <div class="setting">
        <div>
          <div class="label">账号权益</div>
          <div class="desc">${vipLabelText(account.vipTier)}${levelText}${
            account.vipExpireAt ? ` · ${expire}` : ""
          }</div>
        </div>
        ${token}
      </div>
      <div class="section-title">快捷入口</div>
      <div class="row" data-action="open-liked">
        <span class="idx">${icon("heart")}</span>
        <div class="body"><div class="name">我喜欢的音乐</div></div>
      </div>
      <div class="row" data-action="open-daily">
        <span class="idx">${icon("calendar")}</span>
        <div class="body"><div class="name">每日推荐</div></div>
      </div>
      <div style="margin-top:14px">
        <button class="btn ghost block" data-action="logout">退出登录</button>
      </div>
      <div class="note" style="margin-top:10px">登录信息仅保存在本机的 VS Code 全局存储中。</div>
    `;
  }

  private viewLogin(): string {
    const tab = (value: LoginTab, label: string) =>
      `<button class="tab${this.loginTab === value ? " active" : ""}" data-action="login-tab" data-tab="${value}">${label}</button>`;
    const body =
      this.loginTab === "qr"
        ? this.qrPanel()
        : this.loginTab === "password"
          ? `
        <form class="form" data-form="password">
          <div class="field">
            <label>手机号 / 邮箱</label>
            <input name="account" autocomplete="off" placeholder="手机号或邮箱" />
          </div>
          <div class="field">
            <label>密码</label>
            <input name="password" type="password" autocomplete="off" placeholder="登录密码" />
          </div>
          <button class="btn block" type="submit">登录</button>
        </form>`
          : this.loginTab === "captcha"
            ? `
        <form class="form" data-form="captcha">
          <div class="field">
            <label>手机号</label>
            <input name="phone" inputmode="numeric" autocomplete="off" placeholder="中国大陆手机号" />
          </div>
          <div class="field">
            <label>验证码</label>
            <div class="row-inline">
              <input name="captcha" inputmode="numeric" autocomplete="off" placeholder="短信验证码" />
              <button class="btn ghost" type="button" data-action="send-captcha">获取验证码</button>
            </div>
          </div>
          <button class="btn block" type="submit">登录</button>
        </form>`
            : `
        <form class="form" data-form="cookie">
          <div class="field">
            <label>Cookie</label>
            <input name="cookie" autocomplete="off" placeholder="MUSIC_U=..." />
          </div>
          <button class="btn block" type="submit">使用 Cookie 登录</button>
        </form>
        <div class="note" style="margin-top:8px">在浏览器登录 music.163.com 后，从开发者工具复制包含 MUSIC_U 的 Cookie。</div>`;
    return `
      <div class="tabs">
        ${tab("qr", "扫码")}${tab("password", "密码")}${tab("captcha", "验证码")}${tab("cookie", "Cookie")}
      </div>
      ${body}
      <div class="divider">提示</div>
      <div class="note">接口由网易云音乐官方桌面客户端协议直连，登录状态只保存在本机，不会上传。</div>
    `;
  }

  private qrPanel(): string {
    const qr = this.qr;
    const status = qr?.status ?? "loading";
    const message =
      qr?.message ??
      (status === "loading" ? "正在生成二维码…" : "点击下方按钮获取二维码");
    const box = qr?.svg
      ? `<div class="qr-box${status === "expired" ? " dim" : ""}">${qr.svg}</div>`
      : `<div class="qr-box placeholder"><span class="spinner"></span></div>`;
    return `
      <div class="qr-panel">
        ${box}
        <div class="qr-status ${status}">${esc(message)}</div>
        <button class="btn ghost" data-action="refresh-qr">${qr?.svg ? "刷新二维码" : "获取二维码"}</button>
        <div class="note" style="text-align:center">手机打开网易云音乐 App，点左上角「扫一扫」</div>
      </div>`;
  }

  private viewNow(): string {
    const current = this.snapshot?.current;
    if (!current) {
      return `<div class="empty"><div class="empty-icon">${icon("music")}</div>还没有播放歌曲</div>`;
    }
    const liked = this.likedIds.has(current.id);
    return `
      <div class="now">
        <div class="hero">
          <div class="disc spin" id="disc">
            ${current.coverUrl ? `<img src="${cover(current.coverUrl, 360)}" alt="" />` : ""}
          </div>
        </div>
        <div class="head-info">
          <div class="name">${esc(current.name)}${vipBadge(current)}</div>
          <div class="by">${esc(current.artists.join(" / "))}${current.album ? ` · ${esc(current.album)}` : ""}</div>
        </div>
        <div class="now-ops">
          <button class="now-op${liked ? " active" : ""}" data-action="toggle-like" title="${liked ? "取消喜欢" : "喜欢"}">
            ${icon(liked ? "heartFilled" : "heart")}<span>${liked ? "已喜欢" : "喜欢"}</span>
          </button>
          <button class="now-op" data-action="add-to-playlist" title="添加到歌单">
            ${icon("playlistAdd")}<span>歌单</span>
          </button>
        </div>
        <div class="lyrics" id="lyrics"></div>
      </div>
    `;
  }

  private viewQueue(): string {
    const data = this.queueData;
    if (!data || !data.tracks.length) {
      return `<div class="empty"><div class="empty-icon">${icon("list")}</div>播放队列是空的</div>`;
    }
    const rows = data.tracks
      .map((track, index) => {
        const playing = this.snapshot?.current?.id === track.id;
        const liked = this.likedIds.has(track.id);
        return `
        <div class="row${playing ? " playing" : ""}" data-action="jump" data-index="${index}">
          <span class="idx">${playing ? `<span class="eq"><i></i><i></i><i></i></span>` : index + 1}</span>
          <div class="body">
            <div class="name">${esc(track.name)}${vipBadge(track)}</div>
            <div class="by">${esc(track.artists.join(" / "))}</div>
          </div>
          <button class="row-like${liked ? " active" : ""}" data-action="like-row" data-id="${track.id}" title="${liked ? "取消喜欢" : "喜欢"}">${icon(liked ? "heartFilled" : "heart")}</button>
          <span class="dur">${fmtTime(track.duration / 1000)}</span>
        </div>`;
      })
      .join("");
    return `
      <div class="queue-head">
        <span>${esc(data.contextName || "当前队列")} · ${data.tracks.length} 首</span>
        <span class="link" data-action="clear-queue">清空</span>
      </div>
      ${rows}`;
  }

  private viewSettings(): string {
    const preferred = this.snapshot?.preferredQuality ?? this.snapshot?.quality ?? "exhigh";
    const active = this.snapshot?.quality ?? preferred;
    const degraded = preferred !== active;
    const labelOf = (value: Quality) => QUALITY_META.find((item) => item.value === value)?.label ?? value;
    const isSvip = this.account?.vipTier === "svip";
    const options = QUALITY_META.map((item) => {
      const suffix = SVIP_LEVELS.has(item.value) && !isSvip && this.account ? "（需 SVIP）" : "";
      return `<option value="${item.value}"${preferred === item.value ? " selected" : ""}>${item.label} · ${item.desc}${suffix}</option>`;
    }).join("");
    const vipRow = this.account
      ? `<div class="setting">
          <div>
            <div class="label">账号权益</div>
            <div class="desc">${vipLabelText(this.account.vipTier)}${
              this.account.vipLevel > 0 ? ` · LV.${this.account.vipLevel}` : ""
            }${this.account.vipExpireAt ? ` · ${fmtDate(this.account.vipExpireAt)} 到期` : ""}</div>
          </div>
          ${vipToken(this.account.vipTier, this.account.vipLevel)}
        </div>`
      : `<div class="setting">
          <div>
            <div class="label">账号权益</div>
            <div class="desc">未登录，会员音质会被降级</div>
          </div>
        </div>`;
    return `
      ${vipRow}
      <div class="setting">
        <div>
          <div class="label">播放音质</div>
          <div class="desc">不可用时自动降级；播放条显示实际音质</div>
        </div>
      </div>
      <select class="native-select" data-action="quality-select" aria-label="播放音质">${options}</select>
      ${
        degraded
          ? `<div class="note" style="margin:-4px 0 10px">未登录，当前临时使用「${labelOf(active)}」，登录后自动回到「${labelOf(preferred)}」。</div>`
          : ""
      }
      <div class="setting">
        <div>
          <div class="label">强调色</div>
          <div class="desc">按钮、进度条、歌词高亮</div>
        </div>
      </div>
      <select class="native-select" data-action="accent-select" aria-label="强调色">
        ${ACCENT_LABELS.map(
          (item) =>
            `<option value="${item.value}"${this.accent === item.value ? " selected" : ""}>${item.label}</option>`,
        ).join("")}
      </select>
      <div class="setting">
        <div>
          <div class="label">音量</div>
          <div class="desc"><span class="volume-value">${this.volume()}%</span>${
            this.snapshot?.muted ? " · 已静音" : ""
          }</div>
        </div>
        <button class="icon-btn" data-action="toggle-mute" title="${
          this.snapshot?.muted ? "取消静音" : "静音"
        }">${icon(this.snapshot?.muted || this.volume() === 0 ? "volumeX" : "volume")}</button>
      </div>
      <input
        type="range"
        class="volume-slider"
        min="0"
        max="100"
        value="${this.volume()}"
        data-action="volume-slider"
        aria-label="音量"
        style="--range-progress: ${this.volume()}%"
      />
      <div class="setting">
        <label class="check-line">
          <input type="checkbox" data-action="translation-check"${this.translationEnabled ? " checked" : ""} />
          <span>显示歌词翻译</span>
        </label>
      </div>
      <div class="setting">
        <div>
          <div class="label">播放队列</div>
          <div class="desc">当前 ${this.snapshot?.queueLength ?? 0} 首 · ${this.modeLabel()}</div>
        </div>
      </div>
      <div class="note" style="margin-top:12px">
        更多参数可打开 VS Code 设置里的 Netease Music 选项。
        所有播放都在侧边栏内完成，不会弹出独立窗口。
      </div>
      <button class="btn ghost block" data-action="open-settings-page" style="margin-top:10px">更多设置…</button>
    `;
  }

  private modeLabel(): string {
    return MODE_META[this.snapshot?.mode ?? "order"].label;
  }

  /* ---------------------------------------------------------------- 交互 */

  private async onAction(action: string, target: HTMLElement): Promise<void> {
    switch (action) {
      case "back":
        this.back();
        break;
      case "open-search":
        this.pushView("search");
        break;
      case "open-settings":
        this.pushView("settings");
        break;
      case "open-account":
        this.pushView("account");
        break;
      case "open-login":
        this.loginTab = "qr";
        this.pushView("login");
        break;
      case "login-tab":
        this.loginTab = (target.dataset.tab as LoginTab) ?? "qr";
        if (this.loginTab === "qr" && !this.qr) this.requestQr();
        this.renderContent();
        break;
      case "refresh-qr":
        this.requestQr();
        this.renderContent();
        break;
      case "open-playlist":
        vscode.postMessage({ type: "command", cmd: "playlist", payload: { id: Number(target.dataset.id) } });
        break;
      case "open-daily":
        vscode.postMessage({ type: "command", cmd: "daily" });
        break;
      case "open-liked":
        vscode.postMessage({ type: "command", cmd: "liked" });
        break;
      case "open-now":
        this.openNow();
        break;
      case "open-queue":
        this.pushView("queue");
        break;
      case "do-search":
        this.runSearch();
        break;
      case "play-index": {
        if (!this.list) return;
        this.playFrom(this.list.tracks, Number(target.dataset.index), this.list.contextName);
        break;
      }
      case "play-result": {
        if (!this.searchResult) return;
        this.playFrom(this.searchResult.songs, Number(target.dataset.index), `搜索：${this.searchResult.keyword}`);
        break;
      }
      case "play-all": {
        if (!this.list?.tracks.length) return;
        this.playFrom(this.list.tracks, 0, this.list.contextName);
        break;
      }
      case "more":
        this.renderLimit += 300;
        this.renderContent();
        break;
      case "jump":
        vscode.postMessage({ type: "command", cmd: "jump", payload: { index: Number(target.dataset.index) } });
        break;
      case "clear-queue":
        vscode.postMessage({ type: "command", cmd: "clearQueue" });
        this.queueData = { tracks: [], index: -1, contextName: "" };
        this.renderContent();
        break;
      case "toggle":
        this.toggle();
        break;
      case "toggle-like": {
        const id = this.snapshot?.current?.id;
        if (!id) {
          this.toast("info", "还没有在播放的歌曲");
          break;
        }
        vscode.postMessage({ type: "command", cmd: "toggleLike", payload: { id } });
        break;
      }
      case "like-row": {
        const id = Number(target.dataset.id ?? 0);
        if (!id) break;
        vscode.postMessage({ type: "command", cmd: "toggleLike", payload: { id } });
        break;
      }
      case "add-to-playlist": {
        const id = this.snapshot?.current?.id ?? Number(target.dataset.id ?? 0);
        if (!id) {
          this.toast("info", "还没有选择歌曲");
          break;
        }
        vscode.postMessage({ type: "command", cmd: "addToPlaylist", payload: { id } });
        break;
      }
      case "toggle-edit":
        this.editingList = !this.editingList;
        this.renderContent();
        break;
      case "remove-track": {
        const playlistId = this.list?.playlistId;
        const trackId = Number(target.dataset.id ?? 0);
        if (!playlistId || !trackId) break;
        vscode.postMessage({ type: "command", cmd: "removeTrack", payload: { playlistId, trackId } });
        break;
      }
      case "toggle-mute": {
        const muted = this.snapshot?.muted ?? false;
        vscode.postMessage({
          type: "command",
          cmd: "volume",
          payload: { value: muted ? (this.snapshot?.volume ?? 70) : 0 },
        });
        break;
      }
      case "open-settings-page":
        vscode.postMessage({ type: "command", cmd: "openSettings" });
        break;
      case "next":
        vscode.postMessage({ type: "command", cmd: "next" });
        break;
      case "prev":
        vscode.postMessage({ type: "command", cmd: "previous" });
        break;
      case "cycle-mode": {
        const order: PlayMode[] = ["order", "shuffle", "single"];
        const next = order[(order.indexOf(this.snapshot?.mode ?? "order") + 1) % order.length];
        vscode.postMessage({ type: "command", cmd: "mode", payload: { mode: next } });
        break;
      }
      case "set-quality":
        vscode.postMessage({ type: "command", cmd: "quality", payload: { quality: target.dataset.quality } });
        break;
      case "send-captcha": {
        const form = target.closest("form");
        const phone = (form?.querySelector('[name="phone"]') as HTMLInputElement | null)?.value ?? "";
        vscode.postMessage({ type: "command", cmd: "sendCaptcha", payload: { phone } });
        break;
      }
      case "logout":
        vscode.postMessage({ type: "command", cmd: "logout" });
        break;
      case "lyric-seek": {
        const time = Number(target.dataset.time ?? 0);
        if (Number.isFinite(time) && time >= 0) this.audio.currentTime = time;
        break;
      }
      default:
        break;
    }
  }

  private onSubmit(form: HTMLFormElement): void {
    const kind = form.dataset.form;
    const values = new FormData(form);
    if (kind === "password") {
      vscode.postMessage({
        type: "command",
        cmd: "loginPassword",
        payload: { account: String(values.get("account") ?? ""), password: String(values.get("password") ?? "") },
      });
    } else if (kind === "captcha") {
      vscode.postMessage({
        type: "command",
        cmd: "loginCaptcha",
        payload: { phone: String(values.get("phone") ?? ""), captcha: String(values.get("captcha") ?? "") },
      });
    } else if (kind === "cookie") {
      vscode.postMessage({
        type: "command",
        cmd: "loginCookie",
        payload: { cookie: String(values.get("cookie") ?? "") },
      });
    }
  }

  private runSearch(): void {
    const keyword = this.searchDraft.trim();
    if (!keyword) {
      this.toast("info", "请输入搜索关键词");
      return;
    }
    this.searchResult = null;
    vscode.postMessage({ type: "command", cmd: "search", payload: { keyword, kind: this.searchKind, offset: 0 } });
  }

  private playFrom(tracks: Track[], index: number, contextName: string): void {
    if (!tracks.length) return;
    vscode.postMessage({
      type: "command",
      cmd: "playTracks",
      payload: { tracks, index, contextName },
    });
  }

  private toggle(): void {
    if (!this.audio.src) {
      this.toast("info", "还没有选择歌曲");
      return;
    }
    if (this.audio.paused) this.playSafely();
    else this.audio.pause();
  }

  /**
   * 播放并吞掉 AbortError：切歌或暂停打断 play() 时浏览器会 reject，
   * 这是正常竞态，不代表音频真的坏了。
   */
  private playSafely(): void {
    const result = this.audio.play();
    if (result && typeof result.catch === "function") {
      result.catch((err: Error) => {
        if (err.name === "AbortError" || /interrupted by a call to pause/i.test(err.message)) return;
        vscode.postMessage({ type: "audio", event: "error", message: `无法开始播放：${err.message}` });
      });
    }
  }

  private mutedVolume(): number {
    if (this.snapshot?.muted) return 0;
    return (this.snapshot?.volume ?? 70) / 100;
  }

  /* ---------------------------------------------------------------- 播放器 */

  private duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : (this.snapshot?.current?.duration ?? 0) / 1000;
  }

  private volume(): number {
    return this.snapshot?.volume ?? 70;
  }

  private updatePlayer(snapshot: PlayerSnapshot): void {
    const nameEl = this.playerEl.querySelector(".track-line .name") as HTMLElement;
    const byEl = this.playerEl.querySelector(".track-line .by") as HTMLElement;
    const coverEl = this.playerEl.querySelector(".track-line .cover") as HTMLElement;
    const badge = this.playerEl.querySelector(".track-line .badge") as HTMLElement;
    const current = snapshot.current;
    nameEl.innerHTML = current ? `${esc(current.name)}${vipBadge(current)}` : "未在播放";
    byEl.textContent = current ? current.artists.join(" / ") : "选择一首歌开始";
    coverEl.innerHTML = current?.coverUrl ? `<img src="${cover(current.coverUrl, 80)}" alt="" />` : "";
    const levelLabel = snapshot.trial ? "试听" : LEVEL_LABEL[snapshot.actualLevel] ?? "";
    badge.textContent = levelLabel;
    badge.hidden = !levelLabel;
    badge.classList.toggle("trial", snapshot.trial);
    const modeBtn = this.playerEl.querySelector(".mode") as HTMLElement;
    modeBtn.innerHTML = icon(MODE_META[snapshot.mode].icon);
    modeBtn.title = MODE_META[snapshot.mode].label;
    const playBtn = this.playerEl.querySelector(".play-btn") as HTMLElement;
    playBtn.classList.toggle("loading", snapshot.loading);
    if (!this.audio.src) {
      this.audio.volume = (snapshot.muted ? 0 : snapshot.volume) / 100;
    }
    this.updatePlayButton();
    this.updatePlayerLike();
    this.updateProgress();
  }

  private applyAccent(accent: string): void {
    this.accent = accent;
    const color = ACCENT_MAP[accent] ?? ACCENT_MAP.theme;
    document.documentElement.style.setProperty("--net-accent", color);
  }

  private updatePlayerLike(): void {
    const btn = this.playerEl?.querySelector<HTMLElement>(".like-btn");
    if (!btn) return;
    const current = this.snapshot?.current;
    const liked = Boolean(current && this.likedIds.has(current.id));
    btn.classList.toggle("active", liked);
    btn.title = liked ? "取消喜欢" : "喜欢";
    btn.innerHTML = icon(liked ? "heartFilled" : "heart");
  }

  private updatePlayButton(): void {
    const btn = this.playerEl?.querySelector<HTMLElement>(".play-btn");
    if (!btn) return;
    const playing = !this.audio.paused && Boolean(this.audio.src);
    btn.innerHTML = icon(playing ? "pause" : "play");
    btn.title = playing ? "暂停" : "播放";
  }

  private updateDisc(): void {
    const disc = this.contentEl.querySelector("#disc");
    if (!disc) return;
    disc.classList.toggle("paused", this.audio.paused);
  }

  private updateProgress(): void {
    if (!this.progressEl || this.dragging) return;
    const duration = this.duration();
    const position = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
    this.progressEl.value = String(Math.round(ratio * 1000));
    this.progressEl.style.setProperty("--range-progress", `${(ratio * 100).toFixed(2)}%`);
    if (this.currentTimeEl) this.currentTimeEl.textContent = fmtTime(position);
    if (this.totalTimeEl) this.totalTimeEl.textContent = fmtTime(duration);
  }

  private onTimeUpdate(): void {
    this.updateProgress();
    this.updateLyricHighlight();
    // 每秒上报一次播放位置，重载时用于恢复进度
    const now = Date.now();
    if (now - this.lastTimeReport >= 1000 && !this.audio.paused) {
      this.lastTimeReport = now;
      vscode.postMessage({ type: "audio", event: "time", value: this.audio.currentTime });
    }
  }

  /* ---------------------------------------------------------------- 歌词 */

  private renderLyrics(): void {
    const box = this.contentEl.querySelector("#lyrics");
    if (!box) return;
    if (!this.snapshot?.current) return;
    const lines = this.lyricLines;
    if (!lines.length) {
      box.innerHTML = `<div class="placeholder">${this.lyricLoading ? "加载歌词…" : "暂无歌词"}</div>`;
      return;
    }
    box.innerHTML = lines
      .map(
        (line, index) => `
        <div class="line" data-action="lyric-seek" data-time="${line.time.toFixed(2)}" data-index="${index}">
          ${esc(line.text)}${line.translation && this.translationEnabled ? `<span class="tr">${esc(line.translation)}</span>` : ""}
        </div>`,
      )
      .join("");
    this.activeLyric = -1;
    this.updateLyricHighlight();
  }

  private updateLyricHighlight(): void {
    if (this.view !== "now") return;
    const box = this.contentEl.querySelector("#lyrics");
    if (!box || !this.lyricLines.length) return;
    const time = this.audio.currentTime;
    let index = -1;
    for (let i = 0; i < this.lyricLines.length; i += 1) {
      if (this.lyricLines[i].time <= time + 0.15) index = i;
      else break;
    }
    if (index === this.activeLyric) return;
    this.activeLyric = index;
    const nodes = box.querySelectorAll<HTMLElement>(".line");
    nodes.forEach((node, i) => node.classList.toggle("active", i === index));
    const activeNode = index >= 0 ? nodes[index] : undefined;
    if (activeNode) {
      // 用相对歌词容器的位置计算，避免 offsetParent 变化导致算偏
      const boxRect = box.getBoundingClientRect();
      const nodeRect = activeNode.getBoundingClientRect();
      const deltaInBox = nodeRect.top - boxRect.top + box.scrollTop;
      const target = deltaInBox - box.clientHeight / 2 + nodeRect.height / 2;
      box.scrollTop = Math.max(0, target);
    }
  }

  /* ---------------------------------------------------------------- 提示 */

  private toast(level: "info" | "error" | "success", message: string): void {
    // 通知与报错统一交给 VS Code 原生通知
    vscode.postMessage({ type: "notify", level, message });
  }

  private updateBusyBar(): void {
    let bar = this.contentEl.querySelector(".busy-bar");
    if (this.busy.size === 0) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "busy-bar";
      bar.innerHTML = "<i></i>";
      this.contentEl.appendChild(bar);
    }
  }
}

/* ------------------------------------------------------------------ 启动 */

const app = new App();
app.mount();
vscode.postMessage({ type: "ready" });
window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as HostMessage | undefined;
  if (data && typeof data === "object" && typeof (data as { type?: unknown }).type === "string") {
    app.onMessage(data);
  }
});
