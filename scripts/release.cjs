#!/usr/bin/env node
/**
 * 一键发布：改版本 → 构建 → 打包 → 上传 Marketplace → 提交打标签 → GitHub Release
 *
 * 用法：
 *   $env:VSCE_PAT = "<Azure DevOps PAT>"
 *   node scripts/release.cjs patch        # 修复
 *   node scripts/release.cjs minor        # 新功能
 *   node scripts/release.cjs major        # 不兼容大改
 *   node scripts/release.cjs patch --dry-run
 *
 * 发布前必须在 CHANGELOG.md 顶部写好 ## <新版本> 条目。
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
process.chdir(root);

const args = process.argv.slice(2);
const kind = args.find((arg) => ["patch", "minor", "major"].includes(arg)) ?? "patch";
const dryRun = args.includes("--dry-run");

const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const previousVersion = pkg.version;
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
  kind === "major"
    ? `${major + 1}.0.0`
    : kind === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
if (!changelog.includes(`## ${next}`)) {
  console.error(`✗ CHANGELOG.md 里还没有「## ${next}」条目，先补更新说明再发布。`);
  process.exit(1);
}

const token = process.env.VSCE_PAT;
if (!token && !dryRun) {
  console.error("✗ 缺少环境变量 VSCE_PAT（Azure DevOps Personal Access Token）。");
  process.exit(1);
}

const vsix = `netease-music-sidebar-${next}.vsix`;

function run(command, options = {}) {
  console.log(`\n$ ${command}`);
  if (dryRun) return;
  try {
    execSync(command, { stdio: "inherit", shell: true, ...options });
  } catch (error) {
    if (options.ignoreFailure) {
      console.warn(`! 命令失败（已忽略）：${command}`);
      return;
    }
    console.error(`✗ 命令失败：${command}`);
    process.exit(1);
  }
}

pkg.version = next;
if (!dryRun) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`版本：${previousVersion} → ${next}（${kind}）`);

run("node esbuild.mjs");
run("npx --yes @vscode/vsce package --no-dependencies");
// PAT 通过环境变量 VSCE_PAT 交给 vsce，不写进命令行，日志里也不会出现
run(`npx --yes @vscode/vsce publish --packagePath "${vsix}"`);
run(`git add -A && git commit -m "chore: release ${next}"`);
run(`git tag ${next}`, { ignoreFailure: true });
run("git push && git push --tags", { ignoreFailure: true });
run(
  `gh release create ${next} "./${vsix}" --title "Netease Music ${next}" --generate-notes`,
  { ignoreFailure: true },
);

console.log(dryRun ? `\n（演练）将发布 ${next}` : `\n✓ 已发布 ${next}`);
