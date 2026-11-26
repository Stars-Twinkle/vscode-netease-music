import { request } from "node:https";
import { isIPv4 } from "node:net";

const endpoints = {
  alidns: "https://223.5.5.5/resolve",
  dnspod: "https://doh.pub/dns-query",
};

export type DohProvider = keyof typeof endpoints;
interface RecordAnswer { name: string; type: number; TTL: number; data: string }

function normalize(name: string): string {
  return name.toLowerCase().replace(/\.$/, "");
}

export class DohResolver {
  private cached?: { key: string; expires: number; addresses: string[]; next: number };

  async resolve(provider: DohProvider, hostname: string, signal: AbortSignal): Promise<string> {
    const key = provider + ":" + hostname;
    const cached = this.cached;
    if (cached && cached.key === key && cached.expires > Date.now()) {
      return cached.addresses[cached.next++ % cached.addresses.length];
    }
    const query = new URL(endpoints[provider]);
    query.search = new URLSearchParams({ name: hostname, type: "A" }).toString();
    const res = await fetch(query, { headers: { Accept: "application/dns-json" }, redirect: "error", signal });
    if (!res.ok) throw new Error(`DoH 查询失败（${provider} HTTP ${res.status}）`);
    const reply = await res.json() as { Status: number; TC?: boolean; Answer?: RecordAnswer[] };
    if (reply.Status !== 0 || reply.TC || !Array.isArray(reply.Answer)) {
      throw new Error(`DoH 未返回完整的 DNS 应答（${provider}）`);
    }
    const answers = reply.Answer.filter(r => r && typeof r.name === "string" && typeof r.data === "string");
    const seen = new Set<string>();
    let name = normalize(hostname);
    let ttl = Infinity;
    while (!seen.has(name)) {
      seen.add(name);
      const records = answers.filter(r => normalize(r.name) === name);
      const ips = records.filter(r => r.type === 1 && isIPv4(r.data));
      if (ips.length) {
        ttl = Math.min(ttl, ...ips.map(r => r.TTL));
        const addresses = ips.map(r => r.data);
        if (Number.isFinite(ttl) && ttl > 0) {
          this.cached = { key, expires: Date.now() + ttl * 1000, addresses, next: 1 };
        }
        return addresses[0];
      }
      const alias = records.find(r => r.type === 5);
      if (!alias) break;
      ttl = Math.min(ttl, alias.TTL);
      name = normalize(alias.data);
    }
    throw new Error(`DoH 未返回 ${hostname} 的 IPv4 地址（${provider}）`);
  }
}

/** 仅替换套接字地址。HTTPS 请求仍用原域名生成 Host、SNI 并验证证书。 */
export function postAtAddress(url: URL, address: string, headers: Record<string, string>, body: string,
  signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST", headers: { ...headers, "Accept-Encoding": "identity" },
      signal, family: 4, agent: false,
      lookup: (_host, _options, done) => done(null, address, 4),
    }, async res => {
      try {
        const status = res.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          res.destroy();
          throw new Error("API 返回重定向，已拒绝");
        }
        const responseHeaders = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        }
        const chunks: Buffer[] = [];
        for await (const chunk of res) chunks.push(chunk as Buffer);
        resolve(new Response(status === 204 || status === 205 ? null : Buffer.concat(chunks), { status, headers: responseHeaders }));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
    req.end(body);
  });
}
