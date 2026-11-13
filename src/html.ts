import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

function nonce(): string {
  return randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
}

/** 侧边栏 HTML 外壳：只加载本地打包资源，CSP 只放行封面图与音频 CDN。 */
export function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    "media-src https: blob:",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    "connect-src https:",
    `font-src ${webview.cspSource}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${style}" />
<title>Netease Music</title>
</head>
<body>
<div id="app" class="app">
  <div class="boot"><span class="spinner"></span><span>正在启动 Netease Music…</span></div>
</div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
}
