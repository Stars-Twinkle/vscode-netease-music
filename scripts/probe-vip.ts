/**
 * 探测当前登录账号的会员等级字段。
 * 只读取本机 VS Code 的 globalState，不打印任何 Cookie 值。
 * 运行：node esbuild.mjs --probe && node dist/probe.cjs
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { CookieJar, NeteaseClient } from "../src/api/client";

const EXT_KEY = "local-dev.netease-music-sidebar";

function readCookies(): Record<string, string> {
  const dbPath = path.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "state.vscdb");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(EXT_KEY) as { value: string } | undefined;
  db.close();
  if (!row) throw new Error("没有找到扩展的 globalState 记录（还没登录过？）");
  const state = JSON.parse(row.value) as Record<string, unknown>;
  const cookies = state["neteaseSidebar.cookies"] as Record<string, string> | undefined;
  if (!cookies || !cookies.MUSIC_U) throw new Error("globalState 中没有 MUSIC_U");
  return cookies;
}

function describe(value: unknown, depth = 0): unknown {
  if (depth > 2) return "…";
  if (Array.isArray(value)) return value.length ? [describe(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (typeof child === "object" && child !== null) out[key] = describe(child, depth + 1);
      else out[key] = typeof child === "string" && child.length > 40 ? `${child.slice(0, 12)}…(${child.length})` : child;
    }
    return out;
  }
  return value;
}

async function main(): Promise<void> {
  const cookies = readCookies();
  console.log("Cookie 字段：", Object.keys(cookies).join(", "));
  console.log("MUSIC_U 长度：", cookies.MUSIC_U?.length);

  const client = new NeteaseClient(
    () => ({ host: "https://interface.music.163.com", userAgent: "", timeoutMs: 15_000 }),
    new CookieJar(cookies),
    () => {},
  );

  const account = await client.account();
  console.log("\n== account() ==");
  console.log(JSON.stringify(account, null, 2));

  const raw = await client.http.post<any>("/api/nuser/account/get");
  console.log("\n== /api/nuser/account/get profile 字段 ==");
  console.log(
    JSON.stringify(
      {
        vipType: raw?.profile?.vipType,
        accountVipType: raw?.account?.vipType,
        createTime: raw?.profile?.createTime,
        follows: raw?.profile?.follows,
        keys: Object.keys(raw?.profile ?? {}),
      },
      null,
      2,
    ),
  );

  for (const api of ["/api/music-vip-membership/front/vip/info"]) {
    console.log(`\n== ${api} ==`);
    try {
      const data = await client.http.post<any>(api, {});
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.log("失败：", (err as Error).message);
    }
  }

  // 用真实曲目探测实际能拿到的最高音质（最能反映会员权益）
  console.log("\n== 实际音质探测 ==");
  const playlists = await client.personalizedPlaylists(1);
  const detail = await client.playlistDetail(playlists[0].id);
  const track = detail.tracks.find((item) => !item.noCopyright) ?? detail.tracks[0];
  console.log("测试曲目：", track.name, "-", track.artists.join("/"), `id=${track.id}`);
  for (const level of ["standard", "exhigh", "lossless", "hires", "jyeffect", "sky", "jymaster"] as const) {
    try {
      const result = await client.songUrl(track.id, level);
      console.log(
        `  ${level.padEnd(9)} => level=${result.level ?? "-"} br=${result.br} type=${result.type ?? "-"} url=${result.url ? "有" : "无"} trial=${result.trial}`,
      );
    } catch (err) {
      console.log(`  ${level.padEnd(9)} => 失败：${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("探测失败：", err);
  process.exit(1);
});
