import type {
  AccountInfo,
  LyricPayload,
  PlaylistDetail,
  PlaylistRef,
  Quality,
  Track,
  VipTier,
} from "./api/types";

export type { AccountInfo, LyricPayload, PlaylistDetail, PlaylistRef, Quality, Track, VipTier };

export type PlayMode = "order" | "single" | "shuffle";

/** 宿主广播的播放器快照（不含完整队列，队列单独按需下发）。 */
export interface PlayerSnapshot {
  current: Track | null;
  queueLength: number;
  index: number;
  /** 当前队列来源名称，如“每日推荐”“我喜欢的音乐” */
  contextName: string;
  playing: boolean;
  loading: boolean;
  volume: number;
  muted: boolean;
  mode: PlayMode;
  quality: Quality;
  /** 用户设置的偏好音质（未登录时生效音质可能被临时降级） */
  preferredQuality: Quality;
  /** 正在播放试听片段 */
  trial: boolean;
  /** 服务端实际给出的音质（可能因版权/会员被降级） */
  actualLevel: string;
  /** 当前曲目是否已红心 */
  liked: boolean;
  /** 播放失败原因（如无版权），由界面提示，不阻塞 */
  notice?: string;
}

export interface HomeData {
  recommend: PlaylistRef[];
  daily: Track[];
  mine: PlaylistRef[];
  dailyError?: string;
  loggedIn: boolean;
  account: AccountInfo | null;
}

export interface SearchResult {
  keyword: string;
  kind: "song" | "playlist";
  songs: Track[];
  playlists: PlaylistRef[];
  count: number;
  hasMore: boolean;
}

export interface LyricMessage {
  trackId: number;
  lrc: string;
  translation: string;
}

export type QrStatus = "waiting" | "scanned" | "confirmed" | "expired" | "error" | "loading";

export interface QrState {
  key: string;
  /** 首次下发时带二维码 SVG，后续只更新状态，避免重复传输。 */
  svg: string;
  status: QrStatus;
  message: string;
}

/** 侧边栏里统一展示的歌曲列表（歌单 / 每日推荐 / 我喜欢的音乐 / 专辑）。 */
export interface TrackList {
  title: string;
  subtitle?: string;
  description?: string;
  coverUrl?: string;
  playlistId?: number;
  contextName: string;
  tracks: Track[];
  trackCount?: number;
}

/** 扩展 → 侧边栏 */
export type HostMessage =
  | { type: "snapshot"; snapshot: PlayerSnapshot }
  | { type: "load"; track: Track; url: string; autoplay: boolean; trial: boolean; startAt?: number }
  | { type: "queue"; tracks: Track[]; index: number; contextName: string }
  | { type: "account"; account: AccountInfo | null }
  | { type: "home"; data: HomeData }
  | { type: "list"; list: TrackList }
  | { type: "search"; result: SearchResult }
  | { type: "lyric"; lyric: LyricMessage }
  | { type: "qr"; qr: QrState }
  | { type: "liked"; ids: number[] }
  | { type: "playlistTracks"; playlistId: number; trackId: number; removed: boolean }
  | { type: "toast"; level: "info" | "error" | "success"; message: string }
  | { type: "busy"; scope: string; active: boolean; text?: string }
  | { type: "config"; config: { quality: Quality; preferredQuality: Quality; translation: boolean; accent: string } }
  | { type: "ui"; action: "reload" | "search" | "nowplaying" | "login" | "home" }
  | { type: "control"; action: "toggle" | "play" | "pause" | "stop" | "volume" | "seek"; value?: number };

/** 侧边栏 → 扩展 */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "command"; cmd: string; payload?: Record<string, unknown> }
  | { type: "notify"; level: "info" | "success" | "error"; message: string }
  | { type: "audio"; event: "ended" | "error" | "play" | "pause" | "time"; value?: number; message?: string };
