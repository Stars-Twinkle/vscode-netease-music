/** 只服务于 music.163.com 的最小 Cookie 容器。 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();
  private generation = 0;

  get sessionGeneration(): number {
    return this.generation;
  }

  constructor(initial?: Record<string, string> | string) {
    if (typeof initial === "string") this.mergeCookieHeader(initial);
    else if (initial) for (const [k, v] of Object.entries(initial)) this.cookies.set(k, v);
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    if (!name) return;
    if (value === "" || value === "deleted") this.cookies.delete(name);
    else this.cookies.set(name, value);
  }

  clear(): void {
    this.generation++;
    this.cookies.clear();
  }

  isEmpty(): boolean {
    return this.cookies.size === 0;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.cookies.entries());
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  mergeCookieHeader(header: string): void {
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (name) this.set(name, value);
    }
  }

  /** 返回是否有变化。 */
  absorbSetCookie(headers: Headers): boolean {
    let changed = false;
    for (const line of setCookieList(headers)) {
      const first = line.split(";", 1)[0];
      const idx = first.indexOf("=");
      if (idx <= 0) continue;
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (!name) continue;
      if (/expires=Thu, 01 Jan 1970/i.test(line) || /max-age=0(;|$)/i.test(line)) {
        if (this.cookies.delete(name)) changed = true;
        continue;
      }
      if (this.cookies.get(name) !== value) {
        this.cookies.set(name, value);
        changed = true;
      }
    }
    return changed;
  }
}

function setCookieList(headers: Headers): string[] {
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie() ?? [];
  const merged = headers.get("set-cookie");
  if (!merged) return [];
  return merged.split(/,(?=\s*[A-Za-z0-9_-]+=)/g).map((s) => s.trim());
}
