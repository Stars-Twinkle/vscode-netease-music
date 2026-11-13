/** 临时：检查指定歌曲的歌词返回内容。 */
import { CookieJar, NeteaseClient } from "../src/api/client";

async function main(): Promise<void> {
  const client = new NeteaseClient(
    () => ({ host: "https://interface.music.163.com", userAgent: "", timeoutMs: 15_000 }),
    new CookieJar(),
    () => {},
  );
  const keyword = process.argv[2] ?? "SEM NADA";
  const search = await client.search(keyword, "song", 5, 0);
  for (const song of search.songs.slice(0, 4)) {
    try {
      const lyric = await client.lyric(song.id);
      const head = lyric.lrc.slice(0, 160).replace(/\n/g, "\\n");
      console.log(`\n[${song.name}] ${song.artists.join("/")} id=${song.id}`);
      console.log(`  lrc 长度=${lyric.lrc.length} 翻译长度=${lyric.translation.length}`);
      console.log(`  开头: ${head}`);
    } catch (err) {
      console.log(`\n[${song.name}] id=${song.id} 歌词失败: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
