/** 侧边栏渲染所需的精简数据模型（全部由接口响应归一化而来）。 */

export interface Track {
  id: number;
  name: string;
  artists: string[];
  album: string;
  coverUrl: string;
  /** 毫秒 */
  duration: number;
  fee?: number;
  noCopyright?: boolean;
}

export interface PlaylistRef {
  id: number;
  name: string;
  coverUrl: string;
  trackCount: number;
  playCount?: number;
  creatorName?: string;
  subscribed?: boolean;
}

export interface PlaylistDetail extends PlaylistRef {
  description?: string;
  creatorName?: string;
  tracks: Track[];
}

/** 会员等级：音乐包 < 黑胶VIP < 黑胶SVIP */
export type VipTier = "none" | "music" | "vip" | "svip";

export interface AccountInfo {
  userId: number;
  nickname: string;
  avatarUrl: string;
  /** 原始 vipType（不同接口取值不一致，仅作参考） */
  vipType?: number;
  vipTier: VipTier;
  /** 会员成长等级（黑胶等级，1–10） */
  vipLevel: number;
  /** 会员到期时间（毫秒时间戳），0 表示无 */
  vipExpireAt: number;
}

export interface LyricPayload {
  lrc: string;
  translation: string;
}

export interface SongUrlResult {
  id: number;
  url: string | null;
  br: number;
  type: string | null;
  level: string | null;
  /** 试听片段（未购买/无版权时的 30 秒片段） */
  trial: boolean;
  message?: string;
}

/** 与服务端 `level` 参数一一对应，含 SVIP 的臻音 / 沉浸 / 母带。 */
export type Quality =
  | "standard"
  | "higher"
  | "exhigh"
  | "lossless"
  | "hires"
  | "jyeffect"
  | "sky"
  | "jymaster";

export interface Toplist {
  id: number;
  name: string;
  coverUrl: string;
  updateFrequency?: string;
}
