import { build, context } from "esbuild";
import { mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  target: ["es2022"],
  legalComments: "none",
};

/** 扩展宿主：Node + CJS，vscode 由运行时提供。 */
const host = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  external: ["vscode"],
};

/** 侧边栏 webview：浏览器 + IIFE，CSS 由 esbuild 抽成 dist/webview.css。 */
const ui = {
  ...shared,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
};

if (watch) {
  const hostCtx = await context(host);
  const uiCtx = await context(ui);
  await Promise.all([hostCtx.watch(), uiCtx.watch()]);
  console.log("[watch] 监听中…");
} else if (process.argv.includes("--smoke")) {
  await build({
    ...shared,
    entryPoints: ["scripts/smoke.ts"],
    outfile: "dist/smoke.cjs",
    platform: "node",
    format: "cjs",
    minify: false,
    sourcemap: false,
  });
  console.log("[build] 冒烟测试已生成");
} else if (process.argv.includes("--probe")) {
  await build({
    ...shared,
    entryPoints: ["scripts/probe-vip.ts"],
    outfile: "dist/probe.cjs",
    platform: "node",
    format: "cjs",
    minify: false,
    sourcemap: false,
  });
  console.log("[build] 会员探测已生成");
} else if (process.argv.includes("--lyric")) {
  await build({
    ...shared,
    entryPoints: ["scripts/probe-lyric.ts"],
    outfile: "dist/probe-lyric.cjs",
    platform: "node",
    format: "cjs",
    minify: false,
    sourcemap: false,
  });
  console.log("[build] 歌词探测已生成");
} else {
  await Promise.all([build(host), build(ui)]);
  console.log("[build] 完成");
}
