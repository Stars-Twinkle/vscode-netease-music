/**
 * 冒烟测试：直接调用 EAPI 客户端，验证加密、Cookie 与接口是否可用。
 * 运行：node esbuild.mjs smoke && node dist/smoke.cjs
 */
import { CookieJar, NeteaseClient } from "../src/api/client";

const log = (level: string, message: string, data?: unknown) =>
  console.log(`[${level}] ${message}${data === undefined ? "" : " " + JSON.stringify(data)}`);

async function main(): Promise<void> {
  const client = new NeteaseClient(
    () => ({ host: "https://interface.music.163.com", userAgent: "", timeoutMs: 20_000 }),
    new CookieJar(),
    log as never,
  );

  console.log("== 匿名搜索 ==");
  const search = await client.search("晴天", "song", 5, 0);
  console.log(
    "结果：",
    search.songs.slice(0, 3).map((song) => `${song.name} - ${song.artists.join("/")} (${song.id})`),
  );
  if (!search.songs.length) throw new Error("搜索没有返回歌曲");

  console.log("== 歌曲播放地址 ==");
  for (const quality of ["standard", "exhigh", "lossless"] as const) {
    try {
      const result = await client.songUrl(search.songs[0].id, quality);
      console.log(quality, "=>", result.url ? `${result.url.slice(0, 90)}… (${result.type}, ${result.br})` : `无地址：${result.message}`);
    } catch (err) {
      console.log(quality, "=> 失败：", (err as Error).message);
    }
  }

  console.log("== 推荐歌单 ==");
  const recommend = await client.personalizedPlaylists(4);
  console.log(
    "结果：",
    recommend.map((playlist) => `${playlist.name} (${playlist.id}, ${playlist.trackCount} 首)`),
  );

  if (recommend.length) {
    console.log("== 歌单详情 ==");
    const detail = await client.playlistDetail(recommend[0].id);
    console.log(`${detail.name}：${detail.tracks.length} 首，前 3 首：`, detail.tracks.slice(0, 3).map((track) => track.name));
    if (detail.tracks.length) {
      console.log("== 歌词 ==");
      const lyric = await client.lyric(detail.tracks[0].id);
      console.log("歌词长度：", lyric.lrc.length, "翻译长度：", lyric.translation.length);
    }
  }

  console.log("== 每日推荐（未登录应返回空） ==");
  console.log(await client.dailySongs());

  console.log("\n全部冒烟测试通过");
}

main().catch((err) => {
  console.error("冒烟测试失败：", err);
  process.exit(1);
});
