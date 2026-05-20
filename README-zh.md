# Agent Monitor

[English](README.md) | **中文文档**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Tests](https://img.shields.io/badge/Tests-159%20passing-22c55e?style=for-the-badge)](server/__tests__)
[![Docs](https://img.shields.io/badge/Docs-VitePress-646cff?style=for-the-badge&logo=vitepress&logoColor=white)](https://ericonaldo.github.io/AgentMonitor/)

一个 Agent 监控和调度仪表盘，用于在同一界面运行、监控和管理 **Claude Code** 和 **Codex** 智能体。通过可克隆任务模板，轻松创建智能体。实时流式输出、任务流水线、邮件 / WhatsApp / Slack 通知 —— 全部在浏览器中完成。

**[在线文档](https://ericonaldo.github.io/AgentMonitor/)** | **[快速开始](#快速开始)**

---

## 目录

- [核心功能](#核心功能)
- [演示](#演示)
- [截图](#截图)
- [快速开始](#快速开始)
- [配置](#配置)
- [使用方法](#使用方法)
- [API 参考](#api-参考)
- [远程访问（中继模式）](#远程访问中继模式)
- [提供者支持](#提供者支持)
- [测试](#测试)
- [架构](#架构)
- [许可证](#许可证)

---

## 核心功能

### 通过可克隆任务模板，轻松创建智能体
- **克隆智能体** —— 一键复制任意智能体的配置（目录、提供者、参数、指令文件内容），立即启动相同设置的新智能体，无需重复填写
- **指令模板** —— 创建可复用的指令集，在启动智能体时加载（Claude 使用 `CLAUDE.md`，Codex 使用 `AGENTS.md`）；首次运行会自动注入内置模板 `OpenCLI Skill Starter` 和 `Karpathy Coding Guardrails`
- **自动检测指令文件** —— 选择项目目录时，自动检测已有指令文件并提供加载选项（含跨 provider 兼容回退）
- **自动检测模型选项** —— 创建页面会根据本机已安装 CLI 版本展示 provider 对应的可选模型下拉
- **实时编辑** —— 随时修改智能体指令文件内容，无需重启

### 多智能体编排
- **统一仪表盘** —— 从单一界面创建、监控和管理 Claude Code 和 Codex 智能体
- **任务流水线** —— 定义顺序和并行任务工作流；内置的 Meta Agent Manager 自动端到端执行
- **Git Worktree 隔离** —— 当工作目录是 git 仓库时，每个智能体在独立 worktree 分支中运行，避免冲突；非 git 目录则直接在原目录工作，无需额外开销

### 外部代理自动发现
- **自动检测运行中的代理** —— 在仪表盘之外启动的 Claude Code 和 Codex 进程（例如从终端启动）会被自动发现并以 **EXT** 徽章显示
- **自动会话导入** —— 会自动从本地会话日志（`~/.claude/projects/**.jsonl` 与 `~/.codex/sessions/**.jsonl`）加载已有历史
- **历史 + 增量同步** —— 用户/助手/工具消息，以及 token 与上下文窗口等元数据会持续从本地会话文件同步
- **仅显示运行中的外部代理** —— 外部卡片只在对应本地 CLI 进程仍存活时显示，进程结束后会自动移除
- **安全删除模型** —— 外部代理卡片不能在 Agent Monitor 中删除（数据源是本地 CLI 进程与会话文件）
- **内部代理显示不变** —— Agent Monitor 创建的内部代理在停止后仍会保留显示（直到手动删除或命中保留期清理）
- **切换显示** —— 一键在仪表盘上显示或隐藏外部代理；设置跨会话保留

### 实时监控与交互
- **实时流式输出** —— 通过 WebSocket 实时查看智能体输出（本地和中继模式均支持），自动轮询兜底
- **PTY Web 终端** —— 切换全交互式 Shell（node-pty + xterm.js），在智能体工作目录中运行任意命令、启动 `claude`、调试代码 —— 直接在浏览器中操作
- **内置 OpenCLI 工具链** —— 执行 `server` 依赖安装时会自动同步 `@jackwener/opencli` 到最新版，并通过 PATH 暴露给 agent 子进程
- **Web 聊天界面** —— 结构化聊天视图，支持 25+ 斜杠命令与 CLI 行为一致；两种界面共存，可自由切换
- **会话恢复** —— 向已停止的智能体发送消息即可自动使用 `--resume` 重启，继续完整对话历史。对于 Codex，像 `--help` 这样以 `--` 开头的消息会按普通聊天内容转发，不会被当成 CLI 参数
- **克隆智能体** —— 复制现有智能体的配置，快速创建具有相同设置的新智能体
- **交互式提示** —— 当智能体需要输入（权限提示、选项）时，Web UI 显示通知横幅和可点击的选项按钮
- **费用与 Token 追踪** —— 实时显示每个智能体的费用（Claude）和 Token 使用量（Codex）
- **文件附件** —— 从剪贴板粘贴图片/文件（Ctrl+V）或点击附件按钮随消息发送文件；支持所有文件类型，最大 50 MB，内联预览显示文件名、大小和移除按钮
- **双击 Esc 中断** —— 按两次 Escape 向任何运行中的智能体发送 SIGINT
- **自动删除过期智能体** —— 可配置已停止内部智能体的保留时间（默认 24 小时，可在设置中调整）
- **可配置删除策略** —— 对于 Agent Monitor 创建的智能体，可配置删除时会话文件策略：每次询问、不清理会话文件、或按 `sessionId` 始终清理

### 通知 —— 邮件、WhatsApp 和 Slack
随时随地获取通知。Agent Monitor 在智能体需要人工介入时发送即时通知。

| 渠道 | 提供者 | 配置方式 |
|------|--------|----------|
| **邮件** | 任何 SMTP 服务器（Gmail、Outlook、Mailgun 等） | 配置 `SMTP_*` 环境变量 |
| **WhatsApp** | Twilio API | 配置 `TWILIO_*` 环境变量 |
| **Slack** | Slack Incoming Webhooks | 配置 `SLACK_WEBHOOK_URL` 或每个智能体的 webhook |

通知在以下情况触发：
- 智能体进入 `waiting_input` 状态，需要人工介入
- 流水线任务失败
- 卡住的智能体超过可配置的超时阈值
- 整个流水线完成

所有渠道可同时启用 —— 为每个智能体或全局配置管理员邮箱、WhatsApp 手机号和/或 Slack webhook。

> 查看 [通知指南](docs/guide/notifications.md) 获取详细配置说明。

### 远程访问 —— 中继服务器
- **随时随地访问** —— 通过公共中继服务器，从手机、笔记本或任何设备管理智能体
- **安全 WebSocket 隧道** —— 代理机器向外连接中继服务器，无需开放入站端口
- **批量远程智能体** —— 在高性能远程服务器上运行和监控大量智能体，从任何轻量设备远程控制
- **密码保护仪表盘** —— 基于 JWT 的认证，会话有效期 24 小时
- **自动重连** —— 连接断开时隧道自动重连（指数退避策略）
- **本地零开销** —— 未配置中继时，服务器以纯本地模式运行，无额外消耗

```
手机 / 笔记本 ──HTTP──▶ 公共服务器（中继 :3457）◀──WS 隧道── 代理机器（:3456）
```

> 查看 [远程访问指南](docs/guide/remote-access.md) 获取配置说明。

### 国际化
- **7 种语言**：英语、中文、日语（日本語）、韩语（한국어）、西班牙语、法语、德语
- 语言选择器跨会话持久化

---

## 演示

### 快速开始 — 使用模板创建智能体
![快速开始演示](docs/screenshots/demo-quickstart.gif)

*使用 CLAUDE.md 模板创建智能体 → 智能体自主运行 → 任务完成*

### 对话 & 终端
![对话与终端演示](docs/screenshots/demo-chat-terminal.gif)

*交互式对话 → 智能体调用工具执行任务 → PTY 终端 → 克隆智能体*

### 任务流水线
![流水线演示](docs/screenshots/demo-pipeline.gif)

*智能体管理器：添加任务 → 启动管理器 → 观察智能体顺序执行*

---

## 截图

| 仪表盘 | 任务流水线 |
|--------|-----------|
| ![仪表盘](docs/screenshots/dashboard.png) | ![流水线](docs/screenshots/pipeline.png) |

| 创建智能体 | 智能体对话 |
|----------|----------|
| ![创建智能体](docs/screenshots/create-agent.png) | ![智能体对话](docs/screenshots/agent-chat.png) |

| 模板 | 多语言支持 |
|------|------------|
| ![模板](docs/screenshots/templates.png) | ![仪表盘（中文）](docs/screenshots/dashboard-zh.png) |

| PTY Web 终端 | |
|-------------|--|
| ![终端](docs/screenshots/terminal.png) | 直接在浏览器中操作智能体工作目录的交互式 Shell —— 运行命令、启动 `claude` 或调试代码（支持本地模式和中继服务器模式） |

---

## 快速开始

### 前置条件

- **Node.js** >= 18
- **Claude Code CLI**（`claude`）—— 用于 Claude 智能体。Agent Monitor 会在运行时根据你本机安装的 CLI 自动探测可用的 `--effort` 取值；较旧版本通常只有 `low`、`medium`、`high`，较新版本可能还支持 `max`
- **Codex CLI**（`codex`）—— 用于 Codex 智能体
- **OpenCLI 运行时**（`@jackwener/opencli`）—— 在安装 `server` 依赖时自动安装（OpenCLI 自身要求 Node.js >= 20）
- **Git** —— 用于 worktree 隔离（可选；非 git 目录无需安装）

### 安装

```bash
git clone <repo-url> && cd AgentMonitor
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

执行 `cd server && npm install` 时会自动尝试同步 `@jackwener/opencli@latest`。

如果只是 **本地使用**，到这里就够了，**不需要配置 relay / 中继**。

### 生产环境

```bash
cd client && npx vite build && cd ..
cd server && npx tsx src/index.ts
```

在浏览器中打开 **http://localhost:3456**。

### 开发环境

```bash
npm run dev    # 同时启动服务端（tsx watch）+ 客户端（vite dev）
```

- 客户端开发服务器：http://localhost:5173（代理 API 到 :3456）
- API 服务器：http://localhost:3456

如果 Agent 和网页面板都运行在同一台机器上，到这里即可。下面的 relay / 中继配置只用于远程访问。

---

## 配置

所有配置通过环境变量完成。将 `.env.example` 复制为 `.env` 并设置所需的值。

普通本地启动时，可以直接忽略所有 `RELAY_*` 变量。

### 服务器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3456` | 服务器端口 |
| `CLAUDE_BIN` | `claude` | Claude CLI 二进制文件路径 |
| `CODEX_BIN` | `codex` | Codex CLI 二进制文件路径 |

### 邮件通知（SMTP）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SMTP_HOST` | — | SMTP 服务器主机名（如 `smtp.gmail.com`） |
| `SMTP_PORT` | `587` | SMTP 端口（`587` 为 STARTTLS，`465` 为 TLS） |
| `SMTP_SECURE` | `false` | 端口 465 时设为 `true` |
| `SMTP_USER` | — | SMTP 用户名 |
| `SMTP_PASS` | — | SMTP 密码或应用专用密码 |
| `SMTP_FROM` | `agent-monitor@localhost` | 发件人地址 |

### WhatsApp 通知（Twilio）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TWILIO_ACCOUNT_SID` | — | Twilio 账户 SID |
| `TWILIO_AUTH_TOKEN` | — | Twilio 认证令牌 |
| `TWILIO_WHATSAPP_FROM` | — | 启用 WhatsApp 的 Twilio 电话号码（如 `+14155238886`） |

### Slack 通知（Webhook）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SLACK_WEBHOOK_URL` | — | 默认 Slack Incoming Webhook URL |

### 可选：远程中继（隧道）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RELAY_URL` | — | 中继服务器的 WebSocket URL（如 `ws://your-server:3457/tunnel`） |
| `RELAY_TOKEN` | — | 隧道认证的共享密钥 |

本地模式下留空即可。只有需要远程访问时，才看后面的“Remote Access / 远程访问”章节。

> 如果未设置 SMTP、Twilio 或 Slack 凭据，相应的通知渠道将优雅地禁用 —— 事件将记录到服务器控制台。

---

## 使用方法

### 创建智能体

1. 在仪表盘点击 **"+ 新建智能体"**
2. 选择 **提供者** —— Claude Code 或 Codex
3. 设置 **名称**、**工作目录**（使用浏览按钮选择目录）和 **提示词**
4. 如果所选目录包含指令文件（`CLAUDE.md` 或 `AGENTS.md`），系统会提示您自动加载（按 provider 优先并带兼容回退）
5. 从运行时探测得到的下拉中选择 **模型**（或保留 `default`）
6. 配置 **参数选项**（如 `--dangerously-skip-permissions`、`--chrome`、`--permission-mode`）
7. 可选加载指令模板并在线编辑（Claude 为 `CLAUDE.md`，Codex 为 `AGENTS.md`）
8. 输入 **管理员邮箱**、**WhatsApp 手机号** 和/或 **Slack Webhook URL** 用于通知
9. 点击 **创建智能体**

当你选择了模型时：
- Claude：启动时通过 CLI `--model <选择值>` 生效
- Codex：会在首轮任务前注入 `/model <选择值>` 再执行提示词

**提示 —— 克隆现有智能体：** 点击任意智能体卡片上的 **克隆** 按钮，即可创建一个预填了相同目录、提供者、参数和指令文件内容（`CLAUDE.md` / `AGENTS.md`）的新智能体。配合模板可打造可复用的智能体库：创建一个包含标准指令的模板 → 使用该模板创建一个智能体 → 每次需要新实例时克隆即可。

模板快速上手：可直接使用内置 `OpenCLI Skill Starter` 模板，让 agent 主动发现并使用 `opencli`（如 `opencli list`、`opencli doctor`，优先结构化 JSON 输出）；如果你希望 agent 在编码时更克制、先澄清再实现，可使用内置 `Karpathy Coding Guardrails` 模板，它来自 andrej-karpathy-skills 的 `CLAUDE.md` 思路。

### 仪表盘

每个智能体以丰富信息卡片形式显示，包含：
- **项目与 Git 分支** —— 智能体正在哪个仓库和分支上工作
- **Pull Request 链接** —— 如果智能体创建了 PR，会自动检测并显示直达链接
- **模型与上下文使用** —— 使用的 LLM 模型及上下文窗口消耗可视化进度条
- **状态** —— 智能体是否正在工作、空闲或等待权限
- **任务描述** —— 智能体当前正在做什么的摘要
- **MCP 服务器** —— 连接的 Model Context Protocol 服务器（从 `--mcp-config` 解析）
- **费用 / Token 追踪** —— 每个智能体的费用（Claude）或 Token 使用量（Codex）

点击任何卡片打开完整的聊天界面。

### 智能体聊天

发送消息、查看对话历史、双击 Esc 中断、使用斜杠命令：

`/help` `/clear` `/status` `/cost` `/stop` `/compact` `/model` `/export`

对于 Codex 智能体，任何以 `--` 开头的消息都会在显式的 end-of-options 分隔符之后传递，因此像 `--help` 或 `--sandbox danger-full-access` 这样的文本会被当成普通对话内容，而不是 CLI 选项。

### 任务流水线

编排多步骤工作流，支持顺序和并行任务定义。Meta Agent Manager 自动分配智能体、监控进度、在失败时发送通知、完成后清理。

### 模板

创建、编辑和复用跨智能体的指令模板（`CLAUDE.md` / `AGENTS.md`）。

---

## API 参考

### 智能体

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/agents` | 列出所有智能体 |
| GET | `/api/agents/:id` | 获取智能体详情 |
| POST | `/api/agents` | 创建智能体 |
| POST | `/api/agents/:id/stop` | 停止智能体 |
| POST | `/api/agents/:id/message` | 发送消息 |
| POST | `/api/agents/:id/interrupt` | 中断智能体（SIGINT） |
| PUT | `/api/agents/:id/claude-md` | 更新 CLAUDE.md |
| DELETE | `/api/agents/:id` | 删除智能体（可选 body：`{ "purgeSessionFiles": true|false }`） |
| POST | `/api/agents/actions/stop-all` | 停止所有智能体 |

### 流水线任务

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/tasks` | 列出流水线任务 |
| POST | `/api/tasks` | 创建任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |
| POST | `/api/tasks/:id/reset` | 重置任务状态 |
| POST | `/api/tasks/clear-completed` | 清除已完成/失败的任务 |
| GET | `/api/meta/config` | 获取 Meta Agent 配置 |
| PUT | `/api/meta/config` | 更新 Meta Agent 配置 |
| POST | `/api/meta/start` | 启动 Meta Agent 管理器 |
| POST | `/api/meta/stop` | 停止 Meta Agent 管理器 |

### 模板

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/templates` | 列出模板 |
| GET | `/api/templates/:id` | 获取模板 |
| POST | `/api/templates` | 创建模板 |
| PUT | `/api/templates/:id` | 更新模板 |
| DELETE | `/api/templates/:id` | 删除模板 |

### 设置

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/settings` | 获取服务器设置（内部智能体保留时间、会话文件删除策略等） |
| GET | `/api/settings/runtime-capabilities` | 获取运行时探测能力（推理强度 + 模型可选项） |
| PUT | `/api/settings` | 更新服务器设置 |

### 其他

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传文件附件（multipart，最大 50 MB） |
| GET | `/api/sessions` | 列出之前的 Claude 会话 |
| GET | `/api/directories?path=/home` | 浏览服务器目录 |
| GET | `/api/directories/claude-md?path=/project&provider=codex` | 检查目录中的指令文件（`CLAUDE.md` / `AGENTS.md`，含兼容回退） |
| GET | `/api/health` | 健康检查 |

### Socket.IO 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `agent:join` | 客户端 → 服务端 | 订阅智能体消息 |
| `agent:leave` | 客户端 → 服务端 | 取消订阅 |
| `agent:send` | 客户端 → 服务端 | 发送消息 |
| `agent:interrupt` | 客户端 → 服务端 | 发送中断 |
| `agent:message` | 服务端 → 客户端 | 智能体输出（旧版） |
| `agent:update` | 服务端 → 客户端 | 完整智能体快照（实时流式） |
| `agent:snapshot` | 服务端 → 客户端 | 仪表盘广播更新 |
| `agent:status` | 服务端 → 客户端 | 状态变更 |
| `task:update` | 服务端 → 客户端 | 流水线任务更新 |
| `pipeline:complete` | 服务端 → 客户端 | 流水线完成 |
| `terminal:open` | 客户端 → 服务端 | 在智能体目录中打开 PTY 终端 |
| `terminal:input` | 客户端 → 服务端 | 向 PTY 发送按键输入 |
| `terminal:resize` | 客户端 → 服务端 | 调整 PTY 尺寸 |
| `terminal:close` | 客户端 → 服务端 | 关闭 PTY 会话 |
| `terminal:output` | 服务端 → 客户端 | PTY 输出数据 |
| `terminal:exit` | 服务端 → 客户端 | PTY 进程退出 |
| `meta:status` | 服务端 → 客户端 | Meta Agent 状态 |

---

## 远程访问（中继模式）

通过公共中继服务器从任何地方访问 Agent Monitor 仪表盘 —— 手机、笔记本或任何设备。中继通过安全隧道转发所有 HTTP 和 WebSocket 流量。

```
手机/笔记本 → HTTP → 公共服务器（中继 :3457）← WS 隧道 ← 本地机器（:3456）
```

### 配置步骤

1. **部署中继** 到公共服务器：
   ```bash
   bash relay/scripts/deploy.sh <你的密钥令牌> <你的仪表盘密码>
   ```

2. **连接本地服务器**，设置环境变量：
   ```bash
   RELAY_URL=ws://your-server:3457/tunnel RELAY_TOKEN=<你的密钥令牌> npx tsx server/src/index.ts
   ```

3. 从任何设备打开 **仪表盘** `http://your-server:3457` —— 使用密码登录

中继支持通过 `RELAY_PASSWORD` 进行 **密码登录**，保护仪表盘免受未授权访问。会话使用 24 小时过期的 JWT 令牌。隧道在连接断开时自动重连。未设置 `RELAY_URL` 时，服务器以纯本地模式运行，无中继开销。

---

## 提供者支持

| | Claude Code | Codex |
|---|---|---|
| **二进制文件** | `claude` | `codex` |
| **参数选项** | `--dangerously-skip-permissions`、`--permission-mode`、`--chrome`、`--max-budget-usd`、`--allowedTools`、`--disallowedTools`、`--add-dir`、`--mcp-config`、`--resume`、`--model` | `--dangerously-bypass-approvals-and-sandbox`、`--full-auto` |
| **模型选择** | 运行时探测下拉，启动时用 `--model` 应用 | 运行时探测下拉，首轮任务前用 `/model <name>` 应用 |
| **追踪** | 费用（USD） | Token 使用量 |

---

## 测试

```bash
npm test    # 40 个测试
```

---

## 架构

```
AgentMonitor/
  server/                   # Node.js + Express + Socket.IO
    src/
      services/
        AgentProcess.ts     # CLI 进程封装
        AgentManager.ts     # 智能体生命周期管理
        MetaAgentManager.ts # 流水线编排
        TunnelClient.ts     # 到中继服务器的出站隧道
        tunnelBridge.ts     # 隧道事件桥接
        TerminalService.ts  # PTY 终端管理（node-pty）
        WorktreeManager.ts  # Git worktree 操作
        EmailNotifier.ts    # SMTP 邮件通知
        WhatsAppNotifier.ts # Twilio WhatsApp 通知
        SlackNotifier.ts    # Slack webhook 通知
        SessionReader.ts    # 会话历史
        DirectoryBrowser.ts # 目录浏览
      store/AgentStore.ts   # JSON 持久化
      routes/               # REST 端点
      socket/handlers.ts    # WebSocket 处理器
    __tests__/              # 测试套件
  relay/                    # 公共中继服务器（独立部署）
    src/
      index.ts              # 中继入口
      tunnel.ts             # TunnelManager（WS 服务端）
      httpProxy.ts          # HTTP 隧道转发
      socketBridge.ts       # Socket.IO ↔ 隧道桥接
      config.ts             # 中继配置
    scripts/deploy.sh       # 构建并部署到公共服务器
  client/                   # React + Vite
    src/
      pages/                # 仪表盘、聊天、流水线、模板
      i18n/                 # 7 种语言本地化（EN/ZH/JA/KO/ES/FR/DE）
      api/                  # REST + Socket.IO 客户端
```

---

## 许可证

MIT
