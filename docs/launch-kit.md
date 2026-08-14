# Harness Doctor launch kit

## 一句话

一条命令，只读检查 DeepSeek Harness、Claude Code、Codex 和 OpenClaw；默认不改配置，也不输出密钥。

## 30 秒演示

```bash
npm install -g harness-doctor
harness-doctor --target all
harness-doctor --target dsh,codex --json
harness-doctor bundle --target all --output ./harness-support.json --json
```

演示时重点展示三件事：四类 Harness 的统一状态、可供脚本消费的稳定 JSON、脱敏支持包的 SHA-256 与不覆盖保护。

## 中文首发稿

### 标题

AI 编程工具装坏了，先别重装：一个只读的 Harness 体检器

### 正文

现在一台开发机上经常同时有 DeepSeek Harness、Claude Code、Codex 和 OpenClaw。真正麻烦的不是“有没有安装”，而是 Node 版本、PATH 重复、配置位置、凭据是否存在、localhost 端口等状态彼此打架。

我把这些检查收敛成了一个零依赖 CLI：`harness-doctor`。它默认只读，不读取或输出密钥值，也不会偷偷修改配置；需要售后协作时还能生成脱敏支持包。

```bash
npm install -g harness-doctor
harness-doctor --target all
```

项目同时发布为 npm 包、GitHub Release、Codex 插件和通用 Agent Skill。欢迎拿真实环境来测，尤其欢迎提交“误报、漏报、不同 Node/Windows/macOS 环境”的可复现案例。

- GitHub: https://github.com/dongsheng123132/harness-doctor
- npm: https://www.npmjs.com/package/harness-doctor
- skills.sh: https://skills.sh/dongsheng123132/harness-doctor/harness-doctor

## English launch copy

### Show HN title

Show HN: Harness Doctor – read-only diagnostics for AI coding harnesses

### Body

Developer machines increasingly run several AI harnesses side by side: DeepSeek Harness, Claude Code, Codex, and OpenClaw. When one stops working, the failure is often a Node version, duplicate PATH entry, config location, credential presence, or localhost port—not the model itself.

Harness Doctor turns those checks into one zero-dependency CLI. It is read-only by default, never prints secret values, emits stable JSON for automation, and can create a redacted support bundle without overwriting an existing file.

```bash
npm install -g harness-doctor
harness-doctor --target all
```

The project is also available as a Codex plugin and a portable Agent Skill. I would especially value reproducible reports from mixed Windows/macOS/Node environments.

- GitHub: https://github.com/dongsheng123132/harness-doctor
- npm: https://www.npmjs.com/package/harness-doctor

## 短文案

### X / 即刻 / 朋友圈

一台电脑装了 DeepSeek Harness、Claude Code、Codex、OpenClaw，坏一个就开始重装？我做了 `harness-doctor`：零依赖、默认只读、稳定 JSON、支持脱敏诊断包。`npm i -g harness-doctor`。

### GitHub Discussion

Harness Doctor 0.3.2 is available on npm. The first community milestone is broader environment coverage: please share reproducible false positives, missing checks, and mixed-tool conflicts. Secret values must never be included in reports.

## 推荐发布顺序

1. GitHub Release 与 npm 页面作为唯一落点。
2. DeepSeek Harness/OpenClaw/Codex 相关社区发布可运行的 30 秒演示，不发纯广告。
3. Show HN 只在作者能持续回复评论的时间发布。
4. 中文渠道优先 V2EX、掘金、知乎和公众号，正文保留真实命令与失败场景。
5. 不购买虚假 Star、下载量或点赞，不在无关 Issue 下贴链接。
