import { CookieJar } from "./cookies";
import { md5 } from "./crypto";
import { ApiError, EapiTransport, type Logger, type TransportOptions } from "./http";
import { requireOk } from "./http";
import type {
  AccountInfo,
  LyricPayload,
  PlaylistDetail,
  PlaylistRef,
  Quality,
  SongUrlResult,
  Track,
  VipTier,
} from "./types";

/* ------------------------------------------------------------------ 归一化 */

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 网易云的 `ar`/`artists`、`al`/`album`、`dt`/`duration` 两套字段都得兼容。 */
export function normalizeTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, any>;
  const id = num(item.id ?? item.songId);
  if (!id) return null;
  const artistSource = arr(item.ar ?? item.artists);
  const artists = artistSource
    .map((a) => str((a as Record<string, unknown>)?.name))
    .filter((name) => Boolean(name));
  const album = (item.al ?? item.album ?? {}) as Record<string, unknown>;
  const cover = str(album.picUrl ?? album.blurPicUrl ?? item.picUrl ?? item.albumPic);
  const privilege = item.privilege as Record<string, unknown> | undefined;
  return {
    id,
    name: str(item.name ?? item.songName ?? "未知歌曲"),
    artists: artists.length ? artists : [str(item.artistName) || "未知歌手"],
    album: str(album.name ?? item.albumName ?? ""),
    coverUrl: cover ? cover.replace(/^http:/, "https:") : "",
    duration: num(item.dt ?? item.duration ?? item.songDuration),
    fee: privilege ? num(privilege.fee, 0) : item.fee === undefined ? undefined : num(item.fee),
    noCopyright: privilege ? num(privilege.st, 0) < 0 : undefined,
  };
}

function normalizeTracks(input: unknown): Track[] {
  return arr(input)
    .map(normalizeTrack)
    .filter((track): track is Track => track !== null);
}

function normalizePlaylist(raw: unknown): PlaylistRef | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, any>;
  const id = num(item.id ?? item.playlistId);
  if (!id) return null;
  const cover = str(item.coverImgUrl ?? item.picUrl ?? item.coverUrl);
  return {
    id,
    name: str(item.name ?? "未命名歌单"),
    coverUrl: cover ? cover.replace(/^http:/, "https:") : "",
    trackCount: num(item.trackCount ?? item.songCount),
    playCount: item.playCount === undefined ? undefined : num(item.playCount),
    creatorName: str(item.creator?.nickname ?? item.creatorName ?? ""),
    subscribed: item.subscribed === undefined ? undefined : Boolean(item.subscribed),
    specialType: item.specialType === undefined ? undefined : num(item.specialType),
  };
}

function normalizePlaylists(input: unknown): PlaylistRef[] {
  return arr(input)
    .map(normalizePlaylist)
    .filter((playlist): playlist is PlaylistRef => playlist !== null);
}

function accountFrom(data: { account?: any; profile?: any }): AccountInfo {
  const profile = data.profile ?? {};
  const account = data.account ?? {};
  return {
    userId: num(profile.userId ?? account.id),
    nickname: str(profile.nickname ?? account.nickname ?? "网易云用户"),
    avatarUrl: str(profile.avatarUrl ?? ""),
    vipType: num(profile.vipType ?? account.vipType),
    vipTier: "none",
    vipLevel: 0,
    vipExpireAt: 0,
  };
}

function idsParam(ids: number[]): string {
  return JSON.stringify(ids);
}

const LOGIN_MESSAGES: Record<number, string> = {
  400: "请求参数有误，请检查手机号 / 邮箱格式",
  501: "账号不存在",
  502: "密码错误",
  503: "该账号登录过于频繁，请稍后再试",
  509: "操作过于频繁，请 15 分钟后再试",
  8821: "验证码错误或已过期",
};

function translateLoginError(err: unknown): Error {
  if (err instanceof ApiError && err.code !== undefined && LOGIN_MESSAGES[err.code]) {
    return new ApiError(LOGIN_MESSAGES[err.code], err.code, err.status, err.body);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/* -------------------------------------------------------------------- 客户端 */

export interface ClientOptions extends TransportOptions {
  /* 复用 TransportOptions */
}

export class NeteaseClient {
  readonly http: EapiTransport;

  constructor(
    getOptions: () => ClientOptions,
    jar: CookieJar,
    log: Logger,
    onCookiesChange?: () => void,
  ) {
    this.http = new EapiTransport(getOptions, jar, log, onCookiesChange);
  }

  get jar(): CookieJar {
    return this.http.jar;
  }

  isLoggedIn(): boolean {
    return Boolean(this.jar.get("MUSIC_U"));
  }

  /* ------------------------------------------------------------ 登录 / 账号 */

  async account(): Promise<AccountInfo | null> {
    if (!this.isLoggedIn()) return null;
    const data = await this.http.post<{ code: number; account?: any; profile?: any }>("/api/nuser/account/get");
    if (data.code !== 200 || !data.account) return null;
    if (data.account.id && !data.profile) {
      return {
        userId: num(data.account.id),
        nickname: `用户 ${data.account.id}`,
        avatarUrl: "",
        vipType: num(data.account.vipType),
        vipTier: "none",
        vipLevel: 0,
        vipExpireAt: 0,
      };
    }
    const base = accountFrom(data);
    try {
      const vip = await this.vipInfo();
      return { ...base, vipTier: vip.tier, vipLevel: vip.level, vipExpireAt: vip.expireAt };
    } catch {
      // 会员接口失败时退回 vipType：>0 至少说明有某种会员
      return { ...base, vipTier: num(base.vipType) > 0 ? "vip" : "none", vipLevel: 0, vipExpireAt: 0 };
    }
  }

  /**
   * 会员等级。`profile.vipType`（11 / 110）无法区分 VIP 与 SVIP，
   * 这里以会员接口的权益包为准：redplus = 黑胶 PLUS（SVIP 权益）。
   */
  async vipInfo(): Promise<{ tier: VipTier; level: number; expireAt: number }> {
    const data = await this.http.post<{ code?: number; data?: Record<string, any> }>(
      "/api/music-vip-membership/front/vip/info",
      {},
      { retryOnRisk: false },
    );
    const payload = data?.data ?? {};
    const now = Date.now();
    const active = (entry: unknown): number => {
      const expire = Number((entry as { expireTime?: number } | undefined)?.expireTime ?? 0);
      return expire > now ? expire : 0;
    };
    const level = num(payload.associator?.vipLevel ?? payload.redVipLevel);
    const plus = active(payload.redplus);
    if (plus) return { tier: "svip", level, expireAt: plus };
    const red = active(payload.associator) || active(payload.familyVip);
    if (red) return { tier: "vip", level, expireAt: red };
    const music = active(payload.musicPackage);
    if (music) return { tier: "music", level: 0, expireAt: music };
    return { tier: "none", level: 0, expireAt: 0 };
  }

  async sendCaptcha(phone: string, countryCode = "86"): Promise<void> {
    const data = await this.http.post<{ code: number; message?: string }>("/api/sms/captcha/sent", {
      ctcode: countryCode,
      secrete: "music_middleuser_pclogin",
      cellphone: phone,
    });
    requireOk(data, "发送验证码");
  }

  async loginCellphone(params: {
    phone: string;
    countryCode?: string;
    password?: string;
    captcha?: string;
  }): Promise<AccountInfo> {
    const body: Record<string, unknown> = {
      type: "1",
      https: "true",
      phone: params.phone,
      countrycode: params.countryCode ?? "86",
      remember: "true",
    };
    if (params.captcha) body.captcha = params.captcha;
    else body.password = md5(params.password ?? "");
    try {
      const data = await this.http.post<{ code: number; account?: any; profile?: any }>(
        "/api/w/login/cellphone",
        body,
      );
      requireOk(data, "手机登录");
      return accountFrom(data);
    } catch (err) {
      throw translateLoginError(err);
    }
  }

  async loginEmail(username: string, password: string): Promise<AccountInfo> {
    try {
      const data = await this.http.post<{ code: number; account?: any; profile?: any }>("/api/w/login", {
        type: "0",
        https: "true",
        username,
        password: md5(password),
        rememberLogin: "true",
      });
      requireOk(data, "邮箱登录");
      return accountFrom(data);
    } catch (err) {
      throw translateLoginError(err);
    }
  }

  async qrKey(): Promise<string> {
    const data = await this.http.post<{ code: number; unikey?: string }>("/api/login/qrcode/unikey", { type: 1 });
    requireOk(data, "获取二维码");
    if (!data.unikey) throw new ApiError("二维码生成失败");
    return data.unikey;
  }

  qrContent(key: string): string {
    return `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
  }

  /** 801 等待扫码 / 802 已扫码待确认 / 803 登录成功 / 800 已过期 */
  async qrCheck(key: string): Promise<{ code: number; message?: string; nickname?: string }> {
    const data = await this.http.post<{ code: number; message?: string; nickname?: string }>(
      "/api/login/qrcode/client/login",
      { key, type: 1 },
    );
    return { code: data.code, message: data.message, nickname: data.nickname };
  }

  async logout(): Promise<void> {
    try {
      await this.http.post("/api/logout");
    } catch {
      /* 退出登录的请求失败不阻塞本地登出 */
    }
    this.jar.clear();
  }

  /* ------------------------------------------------------------ 目录 / 歌单 */

  async userPlaylists(uid: number): Promise<PlaylistRef[]> {
    const data = await this.http.post<{ code: number; playlist?: unknown[] }>("/api/user/playlist", {
      uid,
      limit: 1000,
      offset: 0,
    });
    requireOk(data, "获取歌单列表");
    return normalizePlaylists(data.playlist);
  }

  async playlistDetail(id: number): Promise<PlaylistDetail> {
    const data = await this.http.post<{ code: number; playlist?: any }>("/api/v6/playlist/detail", {
      id,
      n: 1000,
      s: 8,
    });
    requireOk(data, "获取歌单详情");
    const raw = data.playlist;
    const playlist = normalizePlaylist(raw);
    if (!playlist) throw new ApiError("歌单不存在或不可见");
    let tracks = normalizeTracks(raw?.tracks);
    const trackIds = arr(raw?.trackIds)
      .map((entry: any) => num(entry?.id ?? entry))
      .filter((value) => value > 0);
    if (trackIds.length > tracks.length) {
      const loaded = new Map(tracks.map((track) => [track.id, track]));
      for (let i = 0; i < trackIds.length; i += 500) {
        const chunk = trackIds.slice(i, i + 500);
        for (const song of await this.songDetail(chunk)) loaded.set(song.id, song);
      }
      const ordered = trackIds.map((trackId) => loaded.get(trackId)).filter((t): t is Track => Boolean(t));
      tracks = ordered.length ? ordered : [...loaded.values()];
    }
    return {
      ...playlist,
      trackCount: Math.max(playlist.trackCount, tracks.length),
      description: str(raw?.description),
      creatorName: str(raw?.creator?.nickname ?? playlist.creatorName),
      tracks,
    };
  }

  async songDetail(ids: number[]): Promise<Track[]> {
    if (!ids.length) return [];
    const data = await this.http.post<{ code: number; songs?: unknown[] }>("/api/v3/song/detail", {
      c: JSON.stringify(ids.map((id) => ({ id }))),
    });
    requireOk(data, "获取歌曲详情");
    return normalizeTracks(data.songs);
  }

  async personalizedPlaylists(limit = 12): Promise<PlaylistRef[]> {
    const data = await this.http.post<{ code: number; result?: unknown[] }>("/api/personalized/playlist", {
      limit,
      total: true,
      n: 1000,
    });
    requireOk(data, "获取推荐歌单");
    return normalizePlaylists(data.result);
  }

  /** 未登录会返回 301，此时返回空数组交由界面引导登录。 */
  async dailySongs(): Promise<Track[]> {
    const data = await this.http.post<{ code: number; data?: { dailySongs?: unknown[] } }>(
      "/api/v3/discovery/recommend/songs",
    );
    if (data.code === 301) return [];
    requireOk(data, "获取每日推荐");
    return normalizeTracks(data.data?.dailySongs);
  }

  async search(
    keyword: string,
    kind: "song" | "playlist" | "album" = "song",
    limit = 30,
    offset = 0,
  ): Promise<{ songs: Track[]; playlists: PlaylistRef[] }> {
    const typeCode = kind === "playlist" ? 1000 : kind === "album" ? 10 : 1;
    const data = await this.http.post<any>("/api/cloudsearch/pc", {
      s: keyword,
      type: typeCode,
      limit,
      offset,
    });
    requireOk(data, "搜索");
    const result = data.result ?? {};
    if (kind === "song") return { songs: normalizeTracks(result.songs), playlists: [] };
    if (kind === "album") {
      const songs = arr(result.albums).flatMap((album: any) => normalizeTracks(album?.songs));
      return { songs, playlists: [] };
    }
    return { songs: [], playlists: normalizePlaylists(result.playlists) };
  }

  /* ------------------------------------------------------------- 播放 / 歌词 */

  async songUrl(id: number, quality: Quality): Promise<SongUrlResult> {
    const data = await this.http.post<{ code: number; data?: any[] }>("/api/song/enhance/player/url/v1", {
      ids: idsParam([id]),
      level: quality,
      encodeType: "flac",
      ...(quality === "sky" ? { immerseType: "c51" } : {}),
    });
    const item = data.data?.[0];
    if (data.code !== 200 || !item) throw new ApiError("无法获取播放地址");
    const url = item.url ? String(item.url).replace(/^http:/, "https:") : null;
    const trial = Boolean(item.freeTrialInfo);
    const result: SongUrlResult = {
      id: num(item.id, id),
      url,
      br: num(item.br),
      type: item.type ? String(item.type) : null,
      level: item.level ? String(item.level) : null,
      trial,
    };
    if (!url) {
      result.message = num(item.code, 0) === 404 ? "该歌曲暂无版权" : "该歌曲需要会员或购买后才能播放";
    } else if (trial && item.freeTrialInfo) {
      result.message = "当前仅能试听片段";
    }
    return result;
  }

  async lyric(id: number): Promise<LyricPayload> {
    const data = await this.http.post<{
      code: number;
      lrc?: { lyric?: string };
      tlyric?: { lyric?: string };
    }>("/api/song/lyric", { id, lv: -1, kv: -1, tv: -1 });
    requireOk(data, "获取歌词");
    return { lrc: data.lrc?.lyric ?? "", translation: data.tlyric?.lyric ?? "" };
  }

  async like(id: number, like: boolean): Promise<void> {
    const data = await this.http.post<{ code: number; msg?: string }>("/api/radio/like", {
      alg: "itembased",
      trackId: id,
      like,
      time: 3,
    });
    if (data.code === 301) throw new ApiError("请先登录后再收藏", 301);
    requireOk(data, like ? "红心" : "取消红心");
  }

  /** 添加歌曲到歌单。 */
  async addToPlaylist(pid: number, trackIds: number[]): Promise<void> {
    const data = await this.http.post<{ code: number; message?: string }>("/api/playlist/manipulate/tracks", {
      op: "add",
      pid,
      trackIds: JSON.stringify(trackIds),
      imme: "true",
    });
    requireOk(data, "添加到歌单");
  }

  /** 从歌单移除歌曲（只能操作自己的歌单）。 */
  async removeFromPlaylist(pid: number, trackIds: number[]): Promise<void> {
    const data = await this.http.post<{ code: number; message?: string }>("/api/playlist/manipulate/tracks", {
      op: "del",
      pid,
      trackIds: JSON.stringify(trackIds),
    });
    requireOk(data, "从歌单移除");
  }

  /** 新建歌单，返回新歌单 id。 */
  async createPlaylist(name: string): Promise<number> {
    const data = await this.http.post<{ code: number; id?: number; playlist?: { id?: number } }>(
      "/api/playlist/create",
      { name, privacy: "0", type: "playlist" },
    );
    requireOk(data, "创建歌单");
    const id = num(data.id ?? data.playlist?.id);
    if (!id) throw new ApiError("新建歌单失败");
    return id;
  }
}

export type { Track, PlaylistRef, PlaylistDetail, AccountInfo, LyricPayload, SongUrlResult, Quality };
export { CookieJar };
