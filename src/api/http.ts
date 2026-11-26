import { randomBytes } from "node:crypto";
import { DohResolver, postAtAddress, type DohProvider } from "./doh";
import { CookieJar } from "./cookies";
import { eapi as encryptEapi, eapiDecrypt } from "./crypto";

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

export const DEFAULT_HOST = "https://interface.music.163.com";

/** 只允许 HTTPS 且属于网易云 API 域名，防止自定义 apiHost 把凭据发往第三方。 */
function isAllowedHost(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    // API 实际只走 music.163.com 及其子域（如 interface.music.163.com）
    return host === "music.163.com" || host.endsWith(".music.163.com");
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TransportOptions {
  host: string;
  dnsMode?: "system" | DohProvider;
  userAgent: string;
  timeoutMs: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  retryOnRisk?: boolean;
}

export type Logger = (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;

/** 服务端偶尔会把两个 JSON 对象拼在一起，这里做宽松解析。 */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const boundary = trimmed.indexOf("}{");
    if (boundary > 0) {
      try {
        return JSON.parse(trimmed.slice(0, boundary + 1));
      } catch {
        /* 继续抛出原始错误 */
      }
    }
    throw err;
  }
}

function randomDeviceId(): string {
  return randomBytes(26).toString("hex").toUpperCase();
}

/**
 * 唯一的传输层：EAPI（桌面客户端加密协议）。
 * 不走 webplayer、不加载 HTML，全部接口共用同一个 Cookie 容器。
 */
export class EapiTransport {
  readonly jar: CookieJar;
  private readonly resolver = new DohResolver();
  private readonly deviceId: string;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly getOptions: () => TransportOptions,
    jar: CookieJar,
    private readonly log: Logger,
    private readonly onCookiesChange?: () => void,
  ) {
    this.jar = jar;
    this.deviceId = this.jar.get("deviceId") ?? randomDeviceId();
    this.applyFingerprint();
  }

  get host(): string {
    const configured = this.getOptions().host?.trim();
    if (!configured || configured === "https://music.163.com") return DEFAULT_HOST;
    const normalized = configured.replace(/\/+$/, "");
    if (isAllowedHost(normalized)) return normalized;
    // 自定义主机不在白名单内时回退，避免把登录凭据发到第三方地址
    this.log("warn", "自定义 apiHost 不在允许范围内，已回退默认主机", normalized);
    return DEFAULT_HOST;
  }

  /** 风控要求完整的设备指纹，只发 `os` 会被当成探测请求（-462）。 */
  private applyFingerprint(): void {
    if (!this.jar.get("os")) this.jar.set("os", "pc");
    if (!this.jar.get("appver")) this.jar.set("appver", "3.1.17.204416");
    if (!this.jar.get("osver")) this.jar.set("osver", "Microsoft-Windows-10-Professional-build-19045-64bit");
    if (!this.jar.get("channel")) this.jar.set("channel", "netease");
    if (!this.jar.get("deviceId")) this.jar.set("deviceId", this.deviceId);
    if (!this.jar.get("versioncode")) this.jar.set("versioncode", "140");
  }

  private buildHeader(): Record<string, string> {
    const now = Date.now();
    const header: Record<string, string> = {
      osver: this.jar.get("osver") ?? "Microsoft-Windows-10-Professional-build-19045-64bit",
      deviceId: this.jar.get("deviceId") ?? this.deviceId,
      os: this.jar.get("os") ?? "pc",
      appver: this.jar.get("appver") ?? "3.1.17.204416",
      versioncode: this.jar.get("versioncode") ?? "140",
      mobilename: this.jar.get("mobilename") ?? "",
      buildver: String(now).slice(0, 10),
      resolution: "1920x1080",
      __csrf: this.jar.get("__csrf") ?? "",
      channel: this.jar.get("channel") ?? "netease",
      requestId: `${now}_${String(Math.floor(Math.random() * 1000)).padStart(4, "0")}`,
    };
    const musicU = this.jar.get("MUSIC_U");
    const musicA = this.jar.get("MUSIC_A");
    if (musicU) header.MUSIC_U = musicU;
    if (musicA) header.MUSIC_A = musicA;
    return header;
  }

  cookieHeader(): string {
    if (this.jar.isEmpty()) return "";
    const header = this.buildHeader();
    const pairs = Object.entries(header)
      .filter(([key]) => !["requestId", "__csrf", "MUSIC_U", "MUSIC_A"].includes(key))
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value ?? ""))}`);
    const jarHeader = this.jar.header();
    return [jarHeader, pairs.join("; ")].filter(Boolean).join("; ");
  }

  private async throttle(): Promise<void> {
    const run = async (): Promise<void> => {
      const wait = Math.max(0, this.lastRequestAt + 160 - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** 提前解析 API 主机，避免第一次请求在 DoH 查询上等待。 */
  async warmup(): Promise<void> {
    const opts = this.getOptions();
    if (opts.dnsMode !== "alidns" && opts.dnsMode !== "dnspod") return;
    let hostname: string;
    try {
      hostname = new URL(this.host).hostname;
    } catch {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const address = await this.resolver.resolve(opts.dnsMode, hostname, controller.signal);
      this.log("info", `API DNS 预热完成：${hostname} → ${address}`);
    } catch (err) {
      this.log("warn", "API DNS 预热失败，首次请求仍会重试", (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  async post<T = unknown>(path: string, body: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<T> {
    try {
      return await this.perform<T>(path, body, options);
    } catch (err) {
      if (
        options.retryOnRisk !== false &&
        err instanceof ApiError &&
        (err.code === 406 || err.code === -462 || err.code === -460)
      ) {
        this.log("warn", `触发风控，8 秒后重试：${path}（code=${err.code}）`);
        await new Promise((r) => setTimeout(r, 8_000));
        return this.perform<T>(path, body, { ...options, retryOnRisk: false });
      }
      throw err;
    }
  }

  private async perform<T>(path: string, body: Record<string, unknown>, options: RequestOptions): Promise<T> {
    await this.throttle();
    const opts = this.getOptions();
    this.applyFingerprint();
    const header = this.buildHeader();
    const payload = encryptEapi(path, { ...body, header });
    const url = `${this.host}/eapi${path.replace(/^\/api/, "")}`;
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: "https://music.163.com",
      Origin: "https://music.163.com",
      "User-Agent": opts.userAgent || DESKTOP_UA,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    const timeout = options.timeoutMs ?? opts.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const started = Date.now();
    const generation = this.jar.sessionGeneration;
    try {
      const body = `params=${encodeURIComponent(payload)}`;
      let res: Response;
      if (opts.dnsMode === "alidns" || opts.dnsMode === "dnspod") {
        const target = new URL(url);
        const address = await this.resolver.resolve(opts.dnsMode, target.hostname, controller.signal);
        this.log("debug", `API DNS ${opts.dnsMode}: ${target.hostname} → ${address}`);
        res = await postAtAddress(target, address, headers, body, controller.signal);
      } else {
        res = await fetch(url, {
          method: "POST", headers, body, signal: controller.signal, redirect: "error",
        });
      }
      if (generation === this.jar.sessionGeneration && this.jar.absorbSetCookie(res.headers)) this.onCookiesChange?.();
      let text = await res.text();
      if (text.trim().startsWith("#14")) text = eapiDecrypt(text.trim());
      this.log("debug", `eapi ${path}`, { status: res.status, ms: Date.now() - started, bytes: text.length });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}：${path}`, undefined, res.status, text.slice(0, 500));
      let parsed: unknown;
      try {
        parsed = parseLooseJson(text);
      } catch {
        throw new ApiError(`响应解析失败：${path}`, undefined, res.status, text.slice(0, 300));
      }
      const code = (parsed as { code?: number } | null)?.code;
      if (typeof code === "number" && code < 0) {
        throw new ApiError(describeCode(code), code, res.status, parsed);
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiError(`请求超时（${timeout}ms）：${path}`);
      }
      if (err instanceof TypeError && /redirect/i.test(err.message)) {
        throw new ApiError("服务端返回了重定向，已拒绝以保护登录凭据");
      }
      throw new ApiError(`网络错误：${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function describeCode(code: number): string {
  switch (code) {
    case -462:
      return "接口被风控拦截，请稍后重试";
    case -460:
      return "请求被拒绝（可能是网络环境异常）";
    case 301:
      return "请先登录网易云账号";
    case 400:
      return "请求参数有误";
    case 404:
      return "接口不存在";
    case 406:
      return "访问过于频繁，请稍后重试";
    case 502:
      return "服务端繁忙，请稍后重试";
    default:
      return `接口返回错误（code=${code}）`;
  }
}

export function requireOk<T extends { code?: number }>(data: T, what: string): T {
  if (data.code !== undefined && data.code !== 200 && data.code !== 801) {
    const message = (data as { message?: string; msg?: string }).message ?? (data as { msg?: string }).msg;
    throw new ApiError(`${what}失败（code=${data.code}）${message ? `：${message}` : ""}`, data.code, undefined, data);
  }
  return data;
}
