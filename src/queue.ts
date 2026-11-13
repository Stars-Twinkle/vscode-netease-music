import type { PlayMode, Track } from "./protocol";

/**
 * 播放队列：只管“下一首是谁”，不碰音频。
 * 顺序 = 列表循环；单曲 = 自动续播同一首；随机 = 洗牌后顺序播放且不重复上一首。
 */
export class PlayQueue {
  private tracks: Track[] = [];
  private index = -1;
  private mode: PlayMode = "order";
  private order: number[] = [];
  private contextName = "";

  get list(): readonly Track[] {
    return this.tracks;
  }

  get current(): Track | null {
    return this.index >= 0 && this.index < this.tracks.length ? this.tracks[this.index] : null;
  }

  get currentIndex(): number {
    return this.index;
  }

  get size(): number {
    return this.tracks.length;
  }

  get name(): string {
    return this.contextName;
  }

  get playMode(): PlayMode {
    return this.mode;
  }

  set(tracks: Track[], startIndex: number, contextName: string): Track | null {
    this.tracks = [...tracks];
    this.contextName = contextName;
    this.index = Math.max(0, Math.min(startIndex, this.tracks.length - 1));
    this.rebuildOrder();
    return this.current;
  }

  append(tracks: Track[]): void {
    const known = new Set(this.tracks.map((track) => track.id));
    const additions = tracks.filter((track) => !known.has(track.id));
    if (!additions.length) return;
    this.tracks.push(...additions);
    this.rebuildOrder();
  }

  insertNext(track: Track): void {
    if (!this.tracks.length) {
      this.set([track], 0, track.name);
      return;
    }
    this.tracks.splice(this.index + 1, 0, track);
    this.rebuildOrder();
  }

  setMode(mode: PlayMode): PlayMode {
    this.mode = mode;
    if (mode === "shuffle") this.rebuildOrder();
    return this.mode;
  }

  /** 换队列后重置随机顺序，保证当前曲目排在最前。 */
  private rebuildOrder(): void {
    this.order = this.tracks.map((_, i) => i);
    if (this.mode !== "shuffle") return;
    for (let i = this.order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    const currentPos = this.order.indexOf(this.index);
    if (currentPos > 0) {
      [this.order[0], this.order[currentPos]] = [this.order[currentPos], this.order[0]];
    }
  }

  private shuffleNext(): number {
    if (!this.order.length) return -1;
    const pos = this.order.indexOf(this.index);
    const nextPos = pos < 0 ? 0 : pos + 1;
    if (nextPos < this.order.length) return this.order[nextPos];
    // 一轮放完，重新洗牌但避免与上一首重复
    const last = this.index;
    this.order = this.tracks.map((_, i) => i).filter((i) => i !== last);
    for (let i = this.order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    return this.order[0] ?? -1;
  }

  /**
   * 下一首。
   * @param auto true 表示歌曲自然播完（单曲循环保持原曲），false 表示用户主动切歌。
   */
  next(auto = false): Track | null {
    if (!this.tracks.length) return null;
    if (this.mode === "single" && auto) return this.current;
    if (this.tracks.length === 1) return this.tracks[0];
    if (this.mode === "shuffle") {
      const nextIndex = this.shuffleNext();
      if (nextIndex >= 0) this.index = nextIndex;
      return this.current;
    }
    this.index = (this.index + 1) % this.tracks.length;
    return this.current;
  }

  previous(): Track | null {
    if (!this.tracks.length) return null;
    if (this.tracks.length === 1) return this.tracks[0];
    if (this.mode === "shuffle") {
      const pos = this.order.indexOf(this.index);
      const prevPos = pos <= 0 ? this.order.length - 1 : pos - 1;
      this.index = this.order[prevPos] ?? this.index;
      return this.current;
    }
    this.index = (this.index - 1 + this.tracks.length) % this.tracks.length;
    return this.current;
  }

  /** 直接跳到队列中的某首歌。 */
  jump(index: number): Track | null {
    if (index < 0 || index >= this.tracks.length) return null;
    this.index = index;
    return this.current;
  }

  /** 单曲循环时用户手动“下一首”应真正换歌。 */
  skipForManual(): Track | null {
    return this.next(false);
  }

  toJSON(): { tracks: Track[]; index: number; contextName: string } {
    return { tracks: this.tracks, index: this.index, contextName: this.contextName };
  }

  restore(data: { tracks?: Track[]; index?: number; contextName?: string }): void {
    if (!data?.tracks?.length) return;
    this.tracks = [...data.tracks];
    this.contextName = data.contextName ?? "";
    this.index = Math.max(0, Math.min(data.index ?? 0, this.tracks.length - 1));
    this.rebuildOrder();
  }
}
