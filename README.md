# Netease Music

在 VS Code 的**侧边栏**里听网易云音乐。所有界面、播放控制、歌词都留在侧边栏内，**不会打开任何独立的编辑器窗口或主面板**。

> 非官方插件，与网易云音乐官方无关。接口使用官方桌面客户端的 EAPI 协议直连。

## 特性

- **纯侧边栏**：注册为活动栏 `WebviewView`，不创建 `WebviewPanel`，不弹大窗口，不占用编辑区。
- **播放不中断**：侧边栏切到后台仍保持 webview 存活，音频继续播放。
- **推荐与歌单**：首页推荐歌单、我的歌单、每日推荐、我喜欢的音乐，点开即播。
- **搜索**：单曲 / 歌单搜索，结果直接成队列播放。
- **完整播放器**：播放 / 暂停、上一首 / 下一首、进度拖动、音量、列表循环 / 随机 / 单曲循环。
- **歌词**：正在播放页显示滚动歌词与翻译，点击歌词可跳转。
- **音质**：标准 / 较高 / 极高 / 无损 / Hi-Res / 高清臻音 / 沉浸环绕声 / 超清母带 共 8 档，不可用时按 母带→Hi-Res→无损→极高→较高→标准 自动降级，播放条显示服务端实际给出的音质。
- **原生控件优先**：状态栏显示当前歌曲、命令面板用原生 QuickPick 选音质、原生 InputBox 搜索、设置页使用系统下拉框与复选框。
- **会员等级探测**：按会员权益包识别 普通用户 / 音乐包 / 黑胶VIP / 黑胶SVIP，显示为客户端风格 token（金色黑胶圆标 + `SVIP·LV7`）与到期时间；非 SVIP 会在音质档位上标注「需 SVIP」。
- **登录**：扫码、手机号密码、短信验证码、Cookie 四种方式；扫码后自动轮询，手机确认即登录；登录状态仅存于本机 VS Code 全局存储。

## 安装

**从 Marketplace 安装（推荐）**

在 VS Code 扩展面板搜索 **Netease Music**，或执行：

```bash
code --install-extension starstwinkle.netease-music-sidebar
```

**手动安装 vsix**

从 [Releases](https://github.com/Stars-Twinkle/vscode-netease-music/releases) 下载最新的 `netease-music-sidebar-*.vsix`，然后：

```bash
code --install-extension <下载的 vsix 文件名>
```

安装后左侧活动栏会出现网易云图标（“Netease Music”），点击即可打开侧边栏。

## 使用

| 操作 | 位置 |
| --- | --- |
| 打开侧边栏 | 活动栏图标，或命令 `Netease Music: 打开侧边栏` |
| 播放 / 暂停 | 播放条中央按钮，或命令 `Netease Music: 播放 / 暂停` |
| 上一首 / 下一首 | 播放条，或命令面板 |
| 切换音质 | 标题栏对勾图标 / 命令面板（原生 QuickPick），或设置页下拉框 |
| 搜索 | 侧边栏标题栏放大镜；命令 `Netease Music: 搜索（输入关键词）` 使用原生输入框 |
| 登录 | 侧边栏标题栏人像图标 → 去登录（默认扫码） |
| 设置 | 侧边栏标题栏齿轮：音质、歌词翻译 |

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Alt+N Space` | 播放 / 暂停 |
| `Ctrl+Alt+N →` | 下一首 |
| `Ctrl+Alt+N ←` | 上一首 |
| `Ctrl+Alt+N L` | 喜欢 / 取消喜欢 |
| `Ctrl+Alt+N M` | 静音 / 取消静音 |
| `Ctrl+Alt+N F` | 打开搜索 |
| `Ctrl+Alt+N Shift+F` | 输入关键词搜索 |

## 发布（维护者）

1. 在 `CHANGELOG.md` 顶部写好 `## <新版本>` 条目；
2. 设置 PAT：`$env:VSCE_PAT = "<Azure DevOps Personal Access Token>"`；
3. 执行：

```bash
pnpm release:patch   # 修复
pnpm release:minor   # 新功能
pnpm release:major   # 不兼容大改
pnpm release:patch -- --dry-run   # 只演练
```

脚本会依次构建、打包、上传 Marketplace、提交、打标签并创建 GitHub Release。

播放条始终固定在侧边栏底部；点击封面或歌名进入「正在播放」查看歌词，点左上角返回。

## 设置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `neteaseSidebar.quality` | `exhigh` | 播放音质，8 档：standard / higher / exhigh / lossless / hires / jyeffect / sky / jymaster |
| `neteaseSidebar.volume` | `70` | 初始音量 |
| `neteaseSidebar.lyricsTranslation` | `true` | 歌词页显示翻译 |
| `neteaseSidebar.apiHost` | `https://interface.music.163.com` | EAPI 主机，一般无需修改 |
| `neteaseSidebar.userAgent` | 空 | 自定义 UA，留空使用内置桌面客户端 UA |

## 隐私

- 只请求 `music.163.com` 系列域名，不上传任何本地数据。
- 登录 Cookie 保存在 VS Code 的 `globalState`（本机用户目录），退出登录即清除。
- 不包含任何统计、遥测或第三方上报代码。

## 开发

```bash
npm install
npm run build      # 生成 dist/extension.js、dist/webview.js、dist/webview.css
npm run typecheck  # 类型检查
npm run package    # 打出 vsix
node esbuild.mjs --smoke && node dist/smoke.cjs   # 接口冒烟测试
```

## 免责声明

本项目仅供学习交流，音乐版权归网易云音乐及版权方所有。请勿用于商业用途，下载/缓存内容的传播风险由使用者自行承担。
