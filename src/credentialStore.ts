import type { ExtensionContext } from "vscode";

const COOKIE_KEY = "neteaseSidebar.cookies";
const CLEANUP_KEY = "neteaseSidebar.cookieCleanupPending";
type Cookies = Record<string, string>;

function isCookieRecord(value: unknown): value is Cookies {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([name, cookie]) => name.length > 0 && typeof cookie === "string");
}

export class CredentialStore {
  private writes: Promise<void> = Promise.resolve();
  private allowUpdates = true;

  constructor(private readonly ctx: ExtensionContext, private readonly warn: (message: string) => void) {}

  async load(): Promise<Cookies | undefined> {
    if (this.ctx.globalState.get<boolean>(CLEANUP_KEY)) {
      this.allowUpdates = false;
      try {
        await this.clearStoredSession();
      } catch {
        this.warn("退出后的凭据清理尚未完成，下次启动将重试");
      }
      return undefined;
    }
    const legacy = this.ctx.globalState.get<unknown>(COOKIE_KEY);
    let stored: string | undefined;
    try {
      stored = await this.ctx.secrets.get(COOKIE_KEY);
    } catch {
      this.warn("暂时无法读取安全存储，本次以游客身份启动");
      this.allowUpdates = false;
      return undefined;
    }
    if (stored !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        // 继续检查旧版本的副本。
      }
      if (isCookieRecord(parsed)) {
        if (legacy !== undefined) {
          try {
            await this.ctx.globalState.update(COOKIE_KEY, undefined);
          } catch {
            this.warn("明文凭据清理失败，下次启动将重试");
          }
        }
        return parsed;
      }
      this.warn("安全存储中的 Cookie 格式无效，将尝试恢复旧副本");
    }
    if (!isCookieRecord(legacy)) return undefined;
    try {
      await this.ctx.secrets.store(COOKIE_KEY, JSON.stringify(legacy));
      await this.ctx.globalState.update(COOKIE_KEY, undefined);
    } catch {
      this.warn("凭据迁移未完成，下次启动将重试");
    }
    return legacy;
  }

  save(cookies: Cookies, explicitLogin = false): Promise<void> {
    if (!explicitLogin && !this.allowUpdates) return Promise.resolve();
    if (explicitLogin) this.allowUpdates = true;
    const value = JSON.stringify(cookies);
    return this.enqueue(async () => {
      if (explicitLogin && this.ctx.globalState.get<boolean>(CLEANUP_KEY)) {
        await this.clearStoredSession();
      }
      await this.ctx.secrets.store(COOKIE_KEY, value);
    });
  }

  logout(): Promise<void> {
    this.allowUpdates = false;
    return this.enqueue(async () => {
      try {
        await this.ctx.globalState.update(CLEANUP_KEY, true);
      } catch {
        this.warn("无法记录待清理状态，将直接清理已保存的凭据");
      }
      await this.clearStoredSession();
    });
  }

  private async clearStoredSession(): Promise<void> {
    // 删除旧副本在先，避免在中途退出时重新迁移已注销的会话。
    if (this.ctx.globalState.get(COOKIE_KEY) !== undefined) {
      await this.ctx.globalState.update(COOKIE_KEY, undefined);
    }
    await this.ctx.secrets.delete(COOKIE_KEY);
    if (this.ctx.globalState.get<boolean>(CLEANUP_KEY)) {
      await this.ctx.globalState.update(CLEANUP_KEY, undefined);
    }
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.writes.then(write);
    this.writes = next.catch(() => {});
    return next;
  }
}
