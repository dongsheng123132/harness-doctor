# Harness Doctor

`harness-doctor` 是一个零依赖、只读优先的 AI Agent Harness 体检工具。目前检查：

- DeepSeek Harness (`dsh`)
- Claude Code
- Codex CLI
- OpenClaw

它检查命令路径、版本、Node 兼容性、已知配置位置、凭据环境变量是否存在、localhost 服务端口和 PATH 重复项。它不读取或输出凭据值，也不修改配置。

## 安装

```bash
npm install -g github:dongsheng123132/harness-doctor
```

需要 Node.js 20+。检查 DSH 时会额外验证 DSH 自己要求的 Node.js 22.19+ 或 24+。

## 使用

```bash
harness-doctor
harness-doctor --target dsh
harness-doctor --target dsh,codex --json
harness-doctor --target all --strict
```

默认检查 localhost 端口；完全离线扫描可用：

```bash
harness-doctor --no-ports
```

## JSON 契约

```json
{
  "schema_version": "harness-doctor/v1",
  "ok": true,
  "exit_code": 0,
  "mode": "read_only",
  "targets": ["dsh"],
  "summary": {
    "pass": 4,
    "warn": 2,
    "fail": 0
  },
  "checks": [
    {
      "id": "tool.dsh.command",
      "target": "dsh",
      "status": "pass",
      "summary": "DeepSeek Harness: 0.1.0-rc.6",
      "details": {
        "path": "C:\\...\\dsh.cmd",
        "version": "0.1.0-rc.6",
        "error": null
      },
      "fix_id": null
    }
  ]
}
```

退出码：

- `0`：没有失败项；普通模式允许 warning
- `1`：存在失败项，或 `--strict` 下存在 warning
- `2`：参数错误

`fix_id` 是稳定的修复建议标识，目前只报告、不自动执行。后续修复器可以显式选择某一个 `fix_id`，不会用一个危险的 `--fix-all` 静默改机器。

## 安全边界

- 不读 Key 内容，只报告哪些环境变量名称存在。
- 不联网；端口探测只连接 `127.0.0.1`。
- 不创建、修改或删除 Harness 配置。
- 版本探测有超时。
- stdout 只输出报告，意外错误走 stderr。

报告会包含本机命令和配置路径，公开贴日志前请自行确认路径中的用户名是否需要隐藏。

## 开发

```bash
npm test
npm run check
npm pack --dry-run
```

## License

MIT。Harness Doctor 不是 DeepSeek、Anthropic、OpenAI 或 OpenClaw 的官方产品。
