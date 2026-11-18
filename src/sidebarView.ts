import * as vscode from "vscode";
import { NeteaseClient } from "./api/client";
import { ApiError } from "./api/http";
import type {
  AccountInfo,
  HomeData,
  HostMessage,
  PlayerSnapshot,
  PlayMode,
  QrState,
  Quality,
  Track,
  TrackList,
  WebviewMessage,
} from "./protocol";
import { PlayQueue } from "./queue";
import { buildHtml } from "./html";
import { renderQrSvg } from "./qr";

export const VIEW_ID = "neteaseSidebar.view";

const KEYS = {
  cookies: "neteaseSidebar.cookies",
  queue: "neteaseSidebar.queue",
  volume: "neteaseSidebar.volume",
  mode: "neteaseSidebar.mode",
  muted: "neteaseSidebar.muted",
} as const;

const QUALITY_CHAIN: Record<Quality, Quality[]> = {
  jymaster: ["jymaster", "hires", "lossless", "exhigh", "higher", "standard"],
  sky: ["sky", "jymaster", "hires", "lossless", "exhigh", "higher", "standard"],
  jyeffect: ["jyeffect", "hires", "lossless", "exhigh", "higher", "standard"],
  hires: ["hires", "lossless", "exhigh", "higher", "standard"],
  lossless: ["lossless", "exhigh", "higher", "standard"],
  exhigh: ["exhigh", "higher", "standard"],
  higher: ["higher", "standard"],
  standard: ["standard"],
};

export const QUALITY_LABELS: Record<string, string> = {
  standard: "标准",
  higher: "较高",
  exhigh: "极高",
  lossless: "无损",
  hires: "Hi-Res",
  jyeffect: "高清臻音",
  sky: "沉浸环绕声",
  jymaster: "超清母带",
};

const MODE_ORDER: PlayMode[] = ["order", "shuffle", "single"];

export interface Logger {
  (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void;
}

interface CachedUrl {
  url: string;
  trial: boolean;
  at: number;
  level: string;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 侧边栏唯一的宿主：负责所有接口调用、队列状态与音频指令。
 * 不创建任何 WebviewPanel，界面只存在于侧边栏视图内。
 */
export class SidebarView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private readonly pending: HostMessage[] = [];
  private readonly readyWaiters: Array<() => void> = [];

  private readonly queue = new PlayQueue();
  private playing = false;
  private loading = false;
  private muted = false;
  private trial = false;
  private actualLevel = "";
  private notice?: string;
  private playingBeforeHide = false;

  private volume = 70;
  private quality: Quality = "exhigh";
  private preferredQuality: Quality = "exhigh";
  private translation = true;
  private accent = "theme";
  private account: AccountInfo | null = null;
  private lastHome?: HomeData;

  private readonly urlCache = new Map<string, CachedUrl>();
  private invalidStreak = 0;
  private likedIds = new Set<number>();

  private qrTimer?: ReturnType<typeof setTimeout>;
  private qrGeneration = 0;

  /** 当前播放位置（秒）与已装载的曲目，用于重载时保留进度 */
  private position = 0;
  private loadedTrackId = 0;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly client: NeteaseClient,
    private readonly log: Logger,
    private readonly onSnapshot?: (snapshot: PlayerSnapshot) => void,
  ) {
    this.volume = clampVolume(ctx.globalState.get<number>(KEYS.volume) ?? 70);
    this.muted = ctx.globalState.get<boolean>(KEYS.muted) ?? false;
    const mode = ctx.globalState.get<PlayMode>(KEYS.mode);
    if (mode && MODE_ORDER.includes(mode)) this.queue.setMode(mode);
    const saved = ctx.globalState.get<{ tracks?: Track[]; index?: number; contextName?: string }>(KEYS.queue);
    if (saved) this.queue.restore(saved);
    this.readConfig();
  }

  /* ------------------------------------------------------------ 生命周期 */

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml(view.webview, this.ctx.extensionUri);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => void this.onMessage(message));
    view.onDidChangeVisibility(() => {
      if (!view.visible) {
        this.playingBeforeHide = this.playing;
        return;
      }
      this.emitSnapshot();
      if (this.playingBeforeHide && !this.playing) {
        // 面板被隐藏期间音频上下文可能已中止，重新装载（保持暂停，避免意外外放）。
        void this.playCurrent(false);
      }
      this.playingBeforeHide = this.playing;
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  dispose(): void {
    this.stopQrPolling();
    this.view = undefined;
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") {
      this.ready = true;
      this.flushPending();
      while (this.readyWaiters.length) this.readyWaiters.shift()?.();
      this.sendConfig();
      this.emitSnapshot();
      void this.loadHome(true);
      void this.refreshLiked();
      if (this.queue.current) void this.playCurrent(false);
      return;
    }
    if (message.type === "audio") {
      this.onAudioEvent(message);
      return;
    }
    if (message.type === "notify") {
      this.toast(message.level, message.message);
      return;
    }
    if (message.type === "command") {
      try {
        await this.handleCommand(message.cmd, message.payload ?? {});
      } catch (err) {
        this.log("error", `命令失败：${message.cmd}`, errorText(err));
        this.toast("error", errorText(err));
        this.setBusy("", false);
      }
    }
  }

  private onAudioEvent(message: Extract<WebviewMessage, { type: "audio" }>): void {
    switch (message.event) {
      case "ended":
        void this.advance(true);
        break;
      case "play":
        this.playing = true;
        this.emitSnapshot();
        break;
      case "pause":
        this.playing = false;
        this.emitSnapshot();
        break;
      case "error":
        this.playing = false;
        this.notice = message.message ?? "音频加载失败";
        this.emitSnapshot();
        this.toast("error", this.notice);
        break;
      case "time":
        if (typeof message.value === "number" && Number.isFinite(message.value)) {
          this.position = message.value;
        }
        break;
    }
  }

  /* -------------------------------------------------------------- 消息发送 */

  private post(message: HostMessage): void {
    if (!this.view) return;
    if (!this.ready) {
      this.pending.push(message);
      if (this.pending.length > 40) this.pending.shift();
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private flushPending(): void {
    if (!this.view) return;
    const queue = [...this.pending];
    this.pending.length = 0;
    for (const message of queue) void this.view.webview.postMessage(message);
  }

  private toast(level: "info" | "error" | "success", message: string): void {
    if (level === "error") void vscode.window.showErrorMessage(message);
    else void vscode.window.showInformationMessage(message);
  }

  private setBusy(scope: string, active: boolean, text?: string): void {
    this.post({ type: "busy", scope, active, text });
  }

  private snapshot(): PlayerSnapshot {
    return {
      current: this.queue.current,
      queueLength: this.queue.size,
      index: this.queue.currentIndex,
      contextName: this.queue.name,
      playing: this.playing,
      loading: this.loading,
      volume: this.volume,
      muted: this.muted,
      mode: this.queue.playMode,
      quality: this.quality,
      preferredQuality: this.preferredQuality,
      trial: this.trial,
      actualLevel: this.actualLevel,
      liked: Boolean(this.queue.current && this.likedIds.has(this.queue.current.id)),
      notice: this.notice,
    };
  }

  private emitSnapshot(): void {
    const snapshot = this.snapshot();
    this.post({ type: "snapshot", snapshot });
    this.onSnapshot?.(snapshot);
  }

  private sendConfig(): void {
    this.post({
      type: "config",
      config: {
        quality: this.quality,
        preferredQuality: this.preferredQuality,
        translation: this.translation,
        accent: this.accent,
      },
    });
  }

  /* ---------------------------------------------------------------- 外部命令 */

  async ensureReady(): Promise<boolean> {
    if (this.ready && this.view) return true;
    for (const command of [VIEW_ID + ".focus", "workbench.view.extension.neteaseSidebar"]) {
      try {
        await vscode.commands.executeCommand(command);
      } catch {
        /* 容器尚未注册时忽略 */
      }
      if (this.ready && this.view) return true;
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async togglePlayback(): Promise<void> {
    if (!(await this.ensureReady())) return;
    this.post({ type: "control", action: "toggle" });
  }

  async commandNext(): Promise<void> {
    if (!(await this.ensureReady())) return;
    await this.advance(false);
  }

  async commandPrevious(): Promise<void> {
    if (!(await this.ensureReady())) return;
    const track = this.queue.previous();
    if (!track) return;
    this.saveQueue();
    await this.playCurrent(true);
  }

  async requestUi(action: "reload" | "search" | "nowplaying" | "login"): Promise<void> {
    if (!(await this.ensureReady())) return;
    this.post({ type: "ui", action });
  }

  async toggleMute(): Promise<void> {
    if (!(await this.ensureReady())) return;
    this.muted = !this.muted;
    await this.ctx.globalState.update(KEYS.muted, this.muted);
    this.post({ type: "control", action: "volume", value: this.muted ? 0 : this.volume });
    this.emitSnapshot();
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  /** 供原生 QuickPick 调用：写入设置、通知界面，并按需重新加载当前曲目。 */
  async setQuality(quality: Quality): Promise<void> {
    if (!QUALITY_CHAIN[quality]) return;
    await vscode.workspace
      .getConfiguration("neteaseSidebar")
      .update("quality", quality, vscode.ConfigurationTarget.Global);
    this.readConfig();
    this.sendConfig();
    this.urlCache.clear();
    if (this.quality !== this.preferredQuality) {
      this.toast("info", "未登录，该音质将在登录后自动启用");
    }
    if (this.queue.current) await this.playCurrent(this.playing, true);
    else this.emitSnapshot();
  }

  /** 供原生 InputBox 调用：打开搜索页并直接展示结果。 */
  async searchFromCommand(keyword: string): Promise<void> {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    if (!(await this.ensureReady())) return;
    this.post({ type: "ui", action: "search" });
    await this.runSearch(trimmed, "song", 0);
  }

  async refresh(): Promise<void> {
    if (!(await this.ensureReady())) return;
    this.urlCache.clear();
    await this.requestUi("reload");
  }

  async logout(): Promise<void> {
    await this.client.logout();
    this.account = null;
    this.lastHome = undefined;
    this.likedIds.clear();
    this.post({ type: "liked", ids: [] });
    void vscode.commands.executeCommand("setContext", "neteaseSidebar.loggedIn", false);
    await this.saveCookies();
    this.post({ type: "account", account: null });
    this.applyQualityForLogin();
    this.sendConfig();
    this.toast("success", "已退出登录");
    this.post({ type: "ui", action: "home" });
    if (this.queue.current) void this.playCurrent(this.playing, true);
  }

  /* ------------------------------------------------------------------ 命令 */

  private async handleCommand(cmd: string, payload: Record<string, unknown>): Promise<void> {
    switch (cmd) {
      case "init":
        this.sendConfig();
        this.emitSnapshot();
        void this.refreshAccount(true);
        break;
      case "home":
        await this.loadHome();
        break;
      case "playlist":
        await this.openPlaylist(Number(payload.id));
        break;
      case "daily":
        await this.openDaily();
        break;
      case "liked":
        await this.openLiked();
        break;
      case "search":
        await this.runSearch(String(payload.keyword ?? ""), payload.kind === "playlist" ? "playlist" : "song", Number(payload.offset ?? 0));
        break;
      case "playTracks": {
        const tracks = Array.isArray(payload.tracks) ? (payload.tracks as Track[]) : [];
        if (!tracks.length) return;
        const index = Number(payload.index ?? 0);
        const name = String(payload.contextName ?? "播放队列");
        await this.startQueue(tracks, Number.isFinite(index) ? index : 0, name);
        break;
      }
      case "playNow": {
        const track = payload.track as Track | undefined;
        if (!track) return;
        this.queue.insertNext(track);
        this.queue.jump(this.queue.currentIndex + 1);
        this.saveQueue();
        await this.playCurrent(true);
        break;
      }
      case "toggle":
        this.post({ type: "control", action: "toggle" });
        break;
      case "next":
        await this.advance(false);
        break;
      case "previous": {
        const track = this.queue.previous();
        if (!track) return;
        this.saveQueue();
        await this.playCurrent(true);
        break;
      }
      case "mode": {
        const requested = payload.mode as PlayMode | undefined;
        const mode = requested && MODE_ORDER.includes(requested) ? requested : this.nextMode();
        this.queue.setMode(mode);
        await this.ctx.globalState.update(KEYS.mode, mode);
        this.emitSnapshot();
        this.toast("info", `播放模式：${modeLabel(mode)}`);
        break;
      }
      case "volume": {
        const value = clampVolume(Number(payload.value ?? this.volume));
        this.volume = value;
        this.muted = value === 0;
        await this.ctx.globalState.update(KEYS.volume, value);
        await this.ctx.globalState.update(KEYS.muted, this.muted);
        this.emitSnapshot();
        break;
      }
      case "queue":
        this.post({ type: "queue", tracks: [...this.queue.list], index: this.queue.currentIndex, contextName: this.queue.name });
        break;
      case "clearQueue":
        this.queue.set([], 0, "");
        this.playing = false;
        this.notice = undefined;
        this.trial = false;
        this.actualLevel = "";
        this.saveQueue();
        this.post({ type: "control", action: "stop" });
        this.emitSnapshot();
        break;
      case "translation": {
        const value = Boolean(payload.value);
        await vscode.workspace
          .getConfiguration("neteaseSidebar")
          .update("lyricsTranslation", value, vscode.ConfigurationTarget.Global);
        this.readConfig();
        this.sendConfig();
        break;
      }
      case "accent": {
        const value = String(payload.value ?? "theme");
        await vscode.workspace
          .getConfiguration("neteaseSidebar")
          .update("accentColor", value, vscode.ConfigurationTarget.Global);
        this.readConfig();
        this.sendConfig();
        break;
      }
      case "openSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:starstwinkle.netease-music-sidebar",
        );
        break;
      case "jump": {
        const track = this.queue.jump(Number(payload.index ?? -1));
        if (!track) return;
        this.saveQueue();
        await this.playCurrent(true);
        break;
      }
      case "lyric":
        await this.loadLyric(Number(payload.id ?? this.queue.current?.id ?? 0));
        break;
      case "account":
        await this.refreshAccount(true);
        break;
      case "loginPassword":
        await this.loginWithPassword(String(payload.account ?? ""), String(payload.password ?? ""));
        break;
      case "loginCaptcha":
        await this.loginWithCaptcha(String(payload.phone ?? ""), String(payload.captcha ?? ""));
        break;
      case "qrLogin":
        await this.startQrLogin();
        break;
      case "cancelQr":
        this.stopQrPolling();
        break;
      case "sendCaptcha":
        await this.sendCaptcha(String(payload.phone ?? ""));
        break;
      case "loginCookie":
        await this.loginWithCookie(String(payload.cookie ?? ""));
        break;
      case "logout":
        await this.logout();
        break;
      case "like":
        await this.toggleLike(Number(payload.id ?? this.queue.current?.id ?? 0));
        break;
      case "toggleLike":
        await this.toggleLike(Number(payload.id ?? this.queue.current?.id ?? 0));
        break;
      case "addToPlaylist":
        await this.addToPlaylist(Number(payload.id ?? this.queue.current?.id ?? 0));
        break;
      case "removeTrack":
        await this.removeTrack(Number(payload.playlistId ?? 0), Number(payload.trackId ?? 0));
        break;
      case "quality": {
        const next = String(payload.quality ?? "") as Quality;
        await this.setQuality(next);
        break;
      }
      default:
        this.log("warn", `未知命令：${cmd}`);
    }
  }

  private nextMode(): PlayMode {
    const current = MODE_ORDER.indexOf(this.queue.playMode);
    return MODE_ORDER[(current + 1) % MODE_ORDER.length];
  }

  /* ------------------------------------------------------------------ 数据 */

  private async loadHome(force = false): Promise<void> {
    if (this.lastHome && !force) {
      this.post({ type: "home", data: this.lastHome });
      return;
    }
    this.setBusy("home", true, "正在加载推荐…");
    try {
      const account = await this.refreshAccount(false);
      this.post({ type: "account", account });
      const [recommend, daily, mine] = await Promise.all([
        this.client.personalizedPlaylists(9).catch((err) => {
          this.log("warn", "推荐歌单加载失败", errorText(err));
          return [];
        }),
        account ? this.client.dailySongs().catch(() => []) : Promise.resolve<Track[]>([]),
        account ? this.client.userPlaylists(account.userId).catch(() => []) : Promise.resolve([]),
      ]);
      const data: HomeData = {
        recommend,
        daily,
        mine,
        loggedIn: Boolean(account),
        account,
      };
      if (!account) data.dailyError = "登录后可查看每日推荐与你喜欢的音乐";
      this.lastHome = data;
      this.post({ type: "home", data });
    } catch (err) {
      this.log("error", "首页加载失败", errorText(err));
      this.toast("error", `推荐加载失败：${errorText(err)}`);
      this.post({
        type: "home",
        data: {
          recommend: [],
          daily: [],
          mine: [],
          loggedIn: Boolean(this.account),
          account: this.account,
          dailyError: "加载失败，可点标题栏刷新重试",
        },
      });
    } finally {
      this.setBusy("home", false);
    }
  }

  private async openPlaylist(id: number): Promise<void> {
    if (!Number.isFinite(id) || id <= 0) return;
    this.setBusy("list", true, "正在加载歌单…");
    try {
      const detail = await this.client.playlistDetail(id);
      const list: TrackList = {
        title: detail.name,
        subtitle: `${detail.tracks.length} 首${detail.creatorName ? ` · ${detail.creatorName}` : ""}`,
        description: detail.description,
        coverUrl: detail.coverUrl,
        playlistId: detail.id,
        contextName: detail.name,
        tracks: detail.tracks,
      };
      this.post({ type: "list", list });
    } finally {
      this.setBusy("list", false);
    }
  }

  private async openDaily(): Promise<void> {
    if (!this.client.isLoggedIn()) {
      this.toast("error", "登录后即可查看每日推荐");
      this.post({ type: "ui", action: "login" });
      return;
    }
    this.setBusy("list", true, "正在加载每日推荐…");
    try {
      const tracks = await this.client.dailySongs();
      const today = new Date();
      const list: TrackList = {
        title: "每日推荐",
        subtitle: `${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${tracks.length} 首`,
        contextName: "每日推荐",
        tracks,
      };
      this.post({ type: "list", list });
    } finally {
      this.setBusy("list", false);
    }
  }

  private async openLiked(): Promise<void> {
    const account = await this.refreshAccount(false);
    if (!account) {
      this.toast("error", "登录后即可查看我喜欢的音乐");
      this.post({ type: "ui", action: "login" });
      return;
    }
    this.setBusy("list", true, "正在加载我喜欢的音乐…");
    try {
      const playlists = await this.client.userPlaylists(account.userId);
      const liked = playlists.find((item) => item.name.includes("喜欢的音乐") || item.id === -1);
      if (!liked) {
        this.toast("error", "没有找到“我喜欢的音乐”歌单");
        return;
      }
      await this.openPlaylistInternal(liked.id, "我喜欢的音乐");
    } finally {
      this.setBusy("list", false);
    }
  }

  private async openPlaylistInternal(id: number, contextName: string): Promise<void> {
    const detail = await this.client.playlistDetail(id);
    this.post({
      type: "list",
      list: {
        title: contextName,
        subtitle: `${detail.tracks.length} 首`,
        description: detail.description,
        coverUrl: detail.coverUrl,
        playlistId: detail.id,
        contextName,
        tracks: detail.tracks,
      },
    });
  }

  private async runSearch(keyword: string, kind: "song" | "playlist", offset: number): Promise<void> {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    this.setBusy("search", true, "正在搜索…");
    try {
      const result = await this.client.search(trimmed, kind, 30, offset);
      this.post({
        type: "search",
        result: {
          keyword: trimmed,
          kind,
          songs: result.songs,
          playlists: result.playlists,
          count: kind === "song" ? result.songs.length : result.playlists.length,
          hasMore: kind === "song" ? result.songs.length === 30 : result.playlists.length === 30,
        },
      });
    } finally {
      this.setBusy("search", false);
    }
  }

  private async loadLyric(id: number): Promise<void> {
    if (!id) return;
    try {
      const lyric = await this.client.lyric(id);
      this.post({ type: "lyric", lyric: { trackId: id, lrc: lyric.lrc, translation: lyric.translation } });
    } catch (err) {
      this.log("warn", "歌词加载失败", errorText(err));
      this.post({ type: "lyric", lyric: { trackId: id, lrc: "", translation: "" } });
    }
  }

  /* ------------------------------------------------------------------ 播放 */

  private async startQueue(tracks: Track[], index: number, contextName: string): Promise<void> {
    this.queue.set(tracks, index, contextName);
    this.invalidStreak = 0;
    this.saveQueue();
    this.emitSnapshot();
    await this.playCurrent(true);
  }

  private async advance(auto: boolean): Promise<void> {
    const track = this.queue.next(auto);
    if (!track) {
      this.playing = false;
      this.emitSnapshot();
      return;
    }
    this.saveQueue();
    await this.playCurrent(true);
  }

  private async playCurrent(autoplay: boolean, keepPosition = false): Promise<void> {
    const track = this.queue.current;
    if (!track) {
      this.playing = false;
      this.emitSnapshot();
      return;
    }
    this.loading = true;
    this.notice = undefined;
    this.emitSnapshot();
    try {
      const resolved = await this.resolvePlayable(track);
      if (!resolved.url) {
        this.loading = false;
        this.playing = false;
        this.notice = resolved.message ?? "无法获取播放地址";
        this.emitSnapshot();
        this.toast("error", `${track.name}：${this.notice}`);
        if (this.queue.size > 1 && this.invalidStreak < 3) {
          this.invalidStreak += 1;
          const next = this.queue.next(true);
          if (next && next.id !== track.id) {
            this.saveQueue();
            await this.playCurrent(autoplay);
          }
        }
        return;
      }
      this.invalidStreak = 0;
      this.trial = resolved.trial;
      this.actualLevel = resolved.level;
      // 同一首歌重载（切换音质、登录后重新取地址）保留进度；切歌从 0 开始
      const sameTrack = keepPosition && this.loadedTrackId === track.id;
      const startAt = sameTrack ? this.position : 0;
      if (!sameTrack) this.position = 0;
      this.loadedTrackId = track.id;
      this.post({ type: "load", track, url: resolved.url, autoplay, trial: resolved.trial, startAt });
      this.playing = autoplay;
    } catch (err) {
      this.notice = errorText(err);
      this.log("error", "播放失败", this.notice);
      this.toast("error", this.notice);
    } finally {
      this.loading = false;
      this.emitSnapshot();
    }
  }

  private async resolvePlayable(
    track: Track,
  ): Promise<{ url: string | null; trial: boolean; level: string; message?: string }> {
    let message: string | undefined;
    for (const level of QUALITY_CHAIN[this.quality] ?? ["standard"]) {
      const key = `${track.id}:${level}`;
      const cached = this.urlCache.get(key);
      if (cached && Date.now() - cached.at < 10 * 60_000) {
        return { url: cached.url, trial: cached.trial, level: cached.level };
      }
      const result = await this.client.songUrl(track.id, level);
      if (result.url) {
        const granted = result.level ?? level;
        this.urlCache.set(key, { url: result.url, trial: result.trial, at: Date.now(), level: granted });
        return { url: result.url, trial: result.trial, level: granted, message: result.message };
      }
      message = result.message ?? message;
    }
    return { url: null, trial: false, level: "", message };
  }

  /* ------------------------------------------------------------------ 账号 */

  private async refreshAccount(post: boolean): Promise<AccountInfo | null> {
    try {
      this.account = await this.client.account();
    } catch (err) {
      this.log("warn", "账号信息获取失败", errorText(err));
      this.account = null;
    }
    void vscode.commands.executeCommand("setContext", "neteaseSidebar.loggedIn", Boolean(this.account));
    if (post) this.post({ type: "account", account: this.account });
    return this.account;
  }

  private async afterLogin(): Promise<void> {
    await this.saveCookies();
    const account = await this.refreshAccount(true);
    this.lastHome = undefined;
    this.applyQualityForLogin();
    this.sendConfig();
    this.toast("success", account ? `已登录：${account.nickname}` : "登录成功");
    this.post({ type: "ui", action: "home" });
    void this.refreshLiked();
    // 登录后重新取播放地址：之前未登录可能只拿到试听或拿不到地址
    if (this.queue.current) await this.playCurrent(this.playing, true);
  }

  /* ---------------------------------------------------------------- 扫码登录 */

  private async startQrLogin(): Promise<void> {
    this.stopQrPolling();
    const generation = this.qrGeneration;
    this.post({ type: "qr", qr: { key: "", svg: "", status: "loading", message: "正在生成二维码…" } });
    try {
      const key = await this.client.qrKey();
      if (generation !== this.qrGeneration) return;
      this.post({
        type: "qr",
        qr: {
          key,
          svg: renderQrSvg(this.client.qrContent(key)),
          status: "waiting",
          message: "请用网易云音乐 App 扫码登录",
        },
      });
      this.scheduleQrCheck(key, generation, 1200, 0);
    } catch (err) {
      if (generation !== this.qrGeneration) return;
      this.log("warn", "二维码生成失败", errorText(err));
      this.post({ type: "qr", qr: { key: "", svg: "", status: "error", message: errorText(err) } });
    }
  }

  private stopQrPolling(): void {
    this.qrGeneration += 1;
    if (this.qrTimer) {
      clearTimeout(this.qrTimer);
      this.qrTimer = undefined;
    }
  }

  private scheduleQrCheck(key: string, generation: number, delay: number, attempt: number): void {
    this.qrTimer = setTimeout(() => void this.checkQr(key, generation, attempt), delay);
  }

  private async checkQr(key: string, generation: number, attempt: number): Promise<void> {
    if (generation !== this.qrGeneration) return;
    if (attempt > 100) {
      this.stopQrPolling();
      this.post({ type: "qr", qr: { key, svg: "", status: "expired", message: "二维码长时间未使用，请刷新" } });
      return;
    }
    try {
      const state = await this.client.qrCheck(key);
      if (generation !== this.qrGeneration) return;
      if (state.code === 800) {
        this.stopQrPolling();
        this.post({ type: "qr", qr: { key, svg: "", status: "expired", message: "二维码已过期，请点击刷新" } });
        return;
      }
      if (state.code === 803) {
        await this.finishQrLogin(key, state.nickname);
        return;
      }
      const scanned = state.code === 802;
      const qr: QrState = {
        key,
        svg: "",
        status: scanned ? "scanned" : "waiting",
        message: scanned ? "已扫码，请在手机上确认登录" : "请用网易云音乐 App 扫码登录",
      };
      this.post({ type: "qr", qr });
      this.scheduleQrCheck(key, generation, scanned ? 1500 : 2500, attempt + 1);
    } catch (err) {
      if (generation !== this.qrGeneration) return;
      this.log("warn", "二维码状态查询失败", errorText(err));
      this.post({ type: "qr", qr: { key, svg: "", status: "error", message: errorText(err) } });
    }
  }

  private async finishQrLogin(key: string, nickname?: string): Promise<void> {
    this.stopQrPolling();
    this.post({ type: "qr", qr: { key, svg: "", status: "confirmed", message: "登录成功，正在同步…" } });
    await this.saveCookies();
    const account = await this.refreshAccount(true);
    this.lastHome = undefined;
    this.toast("success", nickname ? `已登录：${nickname}` : account ? `已登录：${account.nickname}` : "登录成功");
    this.post({ type: "ui", action: "home" });
  }

  private async loginWithPassword(account: string, password: string): Promise<void> {
    if (!account || !password) {
      this.toast("error", "请填写账号和密码");
      return;
    }
    this.stopQrPolling();
    this.setBusy("login", true, "正在登录…");
    try {
      const isEmail = account.includes("@");
      if (isEmail) await this.client.loginEmail(account, password);
      else await this.client.loginCellphone({ phone: account, password });
      await this.afterLogin();
    } catch (err) {
      // 8821：密码正确但账号要求短信验证，改用顶部输入框完成二次验证
      if (err instanceof ApiError && err.code === 8821 && !account.includes("@")) {
        await this.promptCaptcha(account);
        return;
      }
      throw err;
    } finally {
      this.setBusy("login", false);
    }
  }

  /**
   * 二次验证：密码登录被要求短信验证码时，用 VS Code 原生输入框收集，
   * 不打断侧边栏，也不用切换到验证码页面。
   */
  private async promptCaptcha(phone: string): Promise<boolean> {
    let sent = false;
    try {
      await this.client.sendCaptcha(phone);
      sent = true;
    } catch (err) {
      this.log("warn", "自动发送验证码失败", errorText(err));
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        // 第二次尝试前补发一条验证码，避免旧码过期
        try {
          await this.client.sendCaptcha(phone);
          sent = true;
        } catch (err) {
          this.log("warn", "补发验证码失败", errorText(err));
        }
      }
      const input = await vscode.window.showInputBox({
        title: "Netease Music · 短信验证",
        prompt: sent
          ? `验证码已发送至 ${phone}，请输入短信中的验证码`
          : `该账号需要短信验证，请输入发送至 ${phone} 的验证码（若未收到请重新登录并点获取验证码）`,
        placeHolder: "短信验证码",
        ignoreFocusOut: true,
        validateInput: (value) => {
          const text = value.trim();
          if (!text) return "请输入验证码";
          return /^\d{4,8}$/.test(text) ? undefined : "验证码应为数字";
        },
      });

      if (input === undefined) {
        this.toast("info", "已取消短信验证");
        return false;
      }

      try {
        await this.client.loginCellphone({ phone, captcha: input.trim() });
        await this.afterLogin();
        return true;
      } catch (err) {
        const message = errorText(err);
        this.toast("error", message);
        if (attempt === 0) continue;
        return false;
      }
    }
    return false;
  }

  private async loginWithCaptcha(phone: string, captcha: string): Promise<void> {
    if (!phone || !captcha) {
      this.toast("error", "请填写手机号和验证码");
      return;
    }
    this.setBusy("login", true, "正在登录…");
    try {
      await this.client.loginCellphone({ phone, captcha });
      await this.afterLogin();
    } finally {
      this.setBusy("login", false);
    }
  }

  private async sendCaptcha(phone: string): Promise<void> {
    if (!/^\d{6,15}$/.test(phone)) {
      this.toast("error", "请输入正确的手机号");
      return;
    }
    this.setBusy("login", true, "正在发送验证码…");
    try {
      await this.client.sendCaptcha(phone);
      this.toast("success", "验证码已发送，请查收短信");
    } finally {
      this.setBusy("login", false);
    }
  }

  private async loginWithCookie(cookie: string): Promise<void> {
    const trimmed = cookie.trim();
    if (!trimmed) {
      this.toast("error", "请粘贴包含 MUSIC_U 的 Cookie");
      return;
    }
    if (!/MUSIC_U=/.test(trimmed)) {
      this.toast("error", "Cookie 中缺少 MUSIC_U 字段");
      return;
    }
    this.client.jar.mergeCookieHeader(trimmed);
    await this.afterLogin();
  }

  /** 登录后同步「我喜欢的音乐」里的歌曲 id，用于红心状态。 */
  private async refreshLiked(): Promise<void> {
    if (!this.client.isLoggedIn()) {
      this.likedIds.clear();
      this.post({ type: "liked", ids: [] });
      return;
    }
    try {
      const account = this.account ?? (await this.refreshAccount(false));
      if (!account) return;
      const playlists = await this.client.userPlaylists(account.userId);
      const liked =
        playlists.find((item) => item.specialType === 5) ?? playlists.find((item) => item.name.includes("喜欢的音乐"));
      if (!liked) return;
      const detail = await this.client.playlistDetail(liked.id);
      this.likedIds = new Set(detail.tracks.map((track) => track.id));
      this.post({ type: "liked", ids: [...this.likedIds] });
      this.emitSnapshot();
    } catch (err) {
      this.log("warn", "喜欢列表加载失败", errorText(err));
    }
  }

  private async toggleLike(id: number): Promise<void> {
    if (!id) return;
    if (!this.client.isLoggedIn()) {
      this.toast("error", "请先登录再收藏歌曲");
      this.post({ type: "ui", action: "login" });
      return;
    }
    const next = !this.likedIds.has(id);
    await this.client.like(id, next);
    if (next) this.likedIds.add(id);
    else this.likedIds.delete(id);
    this.post({ type: "liked", ids: [...this.likedIds] });
    this.toast("success", next ? "已添加到我喜欢的音乐" : "已取消喜欢");
    this.emitSnapshot();
  }

  private async addToPlaylist(id: number): Promise<void> {
    if (!id) {
      this.toast("info", "还没有选择歌曲");
      return;
    }
    if (!this.client.isLoggedIn()) {
      this.toast("error", "请先登录再添加歌单");
      this.post({ type: "ui", action: "login" });
      return;
    }
    const account = this.account ?? (await this.refreshAccount(false));
    if (!account) return;
    const playlists = (await this.client.userPlaylists(account.userId)).filter((item) => item.specialType !== 5);
    const items = [
      ...playlists.map((item) => ({ label: item.name, description: `${item.trackCount} 首`, value: item.id })),
      { label: "$(add) 新建歌单…", description: "输入名称后创建", value: -1 },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: "添加到歌单",
      placeHolder: "选择目标歌单",
      matchOnDescription: true,
    });
    if (!picked) return;
    let pid = picked.value;
    let targetName = picked.label;
    if (pid === -1) {
      const name = await vscode.window.showInputBox({
        title: "新建歌单",
        prompt: "输入歌单名称",
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : "名称不能为空"),
      });
      if (!name?.trim()) return;
      pid = await this.client.createPlaylist(name.trim());
      targetName = name.trim();
    }
    try {
      await this.client.addToPlaylist(pid, [id]);
      this.lastHome = undefined;
      this.toast("success", `已添加到「${targetName}」`);
      this.post({ type: "playlistTracks", playlistId: pid, trackId: id, removed: false });
    } catch (err) {
      // 歌单里已经有这首歌：默认改成移除，而不是报错
      if (err instanceof ApiError && err.code === 502) {
        await this.client.removeFromPlaylist(pid, [id]);
        this.lastHome = undefined;
        this.toast("info", `「${targetName}」里已有这首歌，已移除`);
        this.post({ type: "playlistTracks", playlistId: pid, trackId: id, removed: true });
        return;
      }
      throw err;
    }
  }

  /** 把歌曲从歌单移除。 */
  private async removeTrack(playlistId: number, trackId: number): Promise<void> {
    if (!playlistId || !trackId) return;
    if (!this.client.isLoggedIn()) {
      this.toast("error", "请先登录再编辑歌单");
      return;
    }
    await this.client.removeFromPlaylist(playlistId, [trackId]);
    this.lastHome = undefined;
    this.post({ type: "playlistTracks", playlistId, trackId, removed: true });
    this.toast("success", "已从歌单移除");
  }

  /* ------------------------------------------------------------ 配置 / 持久化 */

  private readConfig(): void {
    const config = vscode.workspace.getConfiguration("neteaseSidebar");
    const quality = config.get<string>("quality");
    if (quality && QUALITY_CHAIN[quality as Quality]) this.preferredQuality = quality as Quality;
    this.translation = config.get<boolean>("lyricsTranslation") ?? true;
    const accent = config.get<string>("accentColor");
    if (accent) this.accent = accent;
    this.applyQualityForLogin();
    const volume = config.get<number>("volume");
    if (typeof volume === "number" && this.ctx.globalState.get<number>(KEYS.volume) === undefined) {
      this.volume = clampVolume(volume);
    }
  }

  /** SVIP 专属音质在未登录时临时降级，登录后自动回升到用户设置。 */
  private applyQualityForLogin(): void {
    const svipOnly: Quality[] = ["jyeffect", "sky", "jymaster"];
    if (!this.client.isLoggedIn() && svipOnly.includes(this.preferredQuality)) {
      this.quality = "exhigh";
    } else {
      this.quality = this.preferredQuality;
    }
  }

  onConfigurationChanged(): void {
    const before = this.quality;
    this.readConfig();
    this.sendConfig();
    if (before !== this.quality) this.urlCache.clear();
  }

  async saveCookies(): Promise<void> {
    await this.ctx.globalState.update(KEYS.cookies, this.client.jar.toJSON());
  }

  private saveQueue(): void {
    const data = this.queue.toJSON();
    const capped = data.tracks.length > 400 ? data.tracks.slice(0, 400) : data.tracks;
    void this.ctx.globalState.update(KEYS.queue, { tracks: capped, index: data.index, contextName: data.contextName });
  }
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 70;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function modeLabel(mode: PlayMode): string {
  return mode === "single" ? "单曲循环" : mode === "shuffle" ? "随机播放" : "列表循环";
}
