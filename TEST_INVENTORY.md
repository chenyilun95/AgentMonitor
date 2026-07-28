# AgentMonitor Test Inventory

**框架**: Vitest v3.2.7  
**总计**: 60 个测试文件 / 418 个测试用例 / 全部通过 ✅  
**注意**: 运行 server 测试前需先 `cd shared && npm run build`，否则 16 个文件因 `@agent-monitor/shared` 解析失败而报错

---

## 总览

| 模块     | 测试文件数 | 测试用例数 | 状态   |
| -------- | ---------- | ---------- | ------ |
| shared   | 3          | 31         | ✅ 全部通过 |
| server   | 33         | 263        | ✅ 全部通过 |
| client   | 24         | 124        | ✅ 全部通过 |
| relay    | 0          | 0          | ⚠️ 无测试 |
| **合计** | **60**     | **418**    | ✅     |

---

## Shared 模块 (3 文件 / 31 用例)

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `instructionFiles.test.ts` | 4 | Provider 到指令文件名的映射 (CLAUDE.md / AGENTS.md) |
| `models.test.ts` | 17 | ReasoningEffort 校验、REASONING_EFFORTS 常量、各 Provider 的推理等级 |
| `tunnelCrypto.test.ts` | 10 | 加密/解密 round-trip、Unicode/大负载、篡改检测、消息信封 |

---

## Server 模块 (33 文件 / 263 用例)

### 核心业务逻辑

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `AgentManager.create.test.ts` | 2 | Agent 创建：初始 prompt 存储、空 prompt 处理 |
| `AgentManager.delete.test.ts` | 7 | Agent 删除：session 文件清理、Worktree 安全检查（脏状态/未合并/运行中） |
| `AgentManager.restore.test.ts` | 16 | 会话恢复：JSONL 截断、对话种子、Worktree 集成状态推导、队列消息、Codex 恢复 |
| `AgentManager.cost.test.ts` | 6 | 费用追踪：结果费用存储、累加、嵌套费用、API 定价、缓存 token 计价 |
| `AgentManager.codexTools.test.ts` | 3 | Codex 工具消息：可折叠命令执行消息、图片附件、大负载截断 |
| `AgentManager.reasoningEffort.test.ts` | 11 | 推理等级：Codex/Claude 参数传递、模型选择、不支持等级跳过 |
| `AgentProcess.test.ts` | 3 | Agent 进程：初始状态、NDJSON 解析、退出事件 |
| `AgentProcess.codexArgs.test.ts` | 3 | Codex 参数构建：过期 flag 移除、bypass flag、config override |
| `AgentStore.test.ts` | 13 | 存储层：CRUD、持久化、延迟合并、JSON/SQLite 混合存储、legacy 迁移、模板管理 |
| `agentSnapshot.test.ts` | 2 | 快照工具：列表消息预览截断、分页查询 |

### 外部 Agent 扫描

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `ExternalAgentScanner.test.ts` | 5 | Codex session 导入、token 使用量、session ID 查找、实时追加、进程清理 |
| `SessionReader.test.ts` | 2 | Claude/Codex session 列表和元数据读取 |

### Git 与 Worktree

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `GitOperations.test.ts` | 5 | 仓库检测、fast-forward pull、push、脏工作区拒绝、并发锁 |
| `WorktreeManager.test.ts` | 5 | Worktree 创建/删除、CLAUDE.md 不修改、清理失败报告、Codex AGENTS.md |
| `WorktreeSnapshotManager.test.ts` | 2 | 代码快照：脏文件和未跟踪文件捕获/恢复 |

### 飞书 (Feishu) 集成

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `FeishuCardBuilder.test.ts` | 30 | 卡片构建：状态颜色/标签、Agent 卡片、列表卡片、文本卡片、帮助卡片 |
| `FeishuNotifier.test.ts` | 9 | 通知器：配置检查、人工介入通知、失败通知、卡住通知、流水线完成 |
| `FeishuService.test.ts` | 27 | 服务层：消息处理、命令路由、卡片交互、事件集成、持久化、生命周期 |

### Pipeline / 编排

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `HarnessOrchestrator.test.ts` | 1 | 评估器输出无 verdict 时失败而非通过 |
| `MetaAgentManager.test.ts` | 7 | Pipeline：启停、默认配置、配置更新、状态事件、防重复启动、Worktree/Direct 选择 |

### 运行时能力

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `RuntimeCapabilities.test.ts` | 4 | Claude effort 解析、版本阈值、不支持值归一化 |
| `SkillManager.test.ts` | 3 | Skill 去重、幂等导入、冲突检测 |

### 认证与安全

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `auth.test.ts` | 20 | 无密码模式、密码认证流程（登录/登出/JWT）、tunnel-auth header、完整生命周期 |

### HTTP 路由

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `routes.test.ts` | 7 | 模板 CRUD、目录列表、指令文件查找、Agent 日志/分页 |
| `directoryRoutes.test.ts` | 2 | 保存目录的持久化和路径校验 |
| `settingsRoutes.test.ts` | 7 | 设置 CRUD、字段校验（retention、deletePolicy）、部分更新合并 |
| `skillRoutes.test.ts` | 16 | Skill CRUD、本地导入、去重/冲突、404 处理 |
| `taskRoutes.test.ts` | 7 | 任务 CRUD、校验、Agent Manager 启停、失败任务重置 |
| `tasks.test.ts` | 7 | 任务存储：CRUD、排序、清理、元配置持久化 |

### 工具函数

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `pathUtils.test.ts` | 7 | 路径展开（~）、相对路径解析、空路径、路径压缩 |
| `codexStderr.test.ts` | 9 | Codex stderr 过滤：piped-stdin 忽略、可恢复诊断降级、工具失败保留 |
| `DirectoryBrowser.test.ts` | 10 | 目录浏览：列表、排序、不存在目录、父目录、~展开、文件预览 |
| `imageAttachments.test.ts` | 5 | 图片提取：本地路径/Markdown/远程 URL、去重、大输出跳过、base64/MCP |

---

## Client 模块 (24 文件 / 124 用例)

### 页面/组件测试

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `App.test.tsx` | 1 | 应用导航渲染 |
| `Dashboard.test.tsx` | 12 | 排序、输入等待高亮、重命名、保存目录管理、Git/非Git模式、Worktree 操作 |
| `AgentChat.test.tsx` | 6 | React hooks 顺序回归、正常渲染、加载失败重试 |
| `AgentChat.test.ts` | 2 | 工具消息详情：legacy codex 格式、结构化字段 |
| `AgentChatNavigation.test.tsx` | 4 | 连接处理：加载失败、重连、Direct Edit 冲突警告、滚动定位 |
| `ChatMarkdown.test.tsx` | 7 | Markdown 渲染：KaTeX 数学公式、加粗、代码、GFM、工作区文件链接 |
| `ChatMessageItem.test.tsx` | 7 | 消息项渲染：用户/助手/工具消息、折叠/展开、点击回调 |
| `CreateAgent.test.tsx` | 3 | Agent 创建界面：权限默认值、空 prompt、目录选择 |
| `FileBrowserView.test.tsx` | 3 | 文件浏览：加载目录、错误展示、Markdown 文件打开 |
| `components/PendingQuestionBanner.test.tsx` | 2 | 类型导入验证 |

### Hooks 测试

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `useAuth.test.tsx` | 2 | 认证 hook：本地模式检测、未认证重定向 |
| `hooks/useRuntimeCapabilities.test.ts` | 3 | 运行时能力 hook：初始 null、fetch 解析、错误处理 |
| `hooks/useSocket.test.ts` | 3 | Socket hook：挂载订阅、卸载清理、事件处理 |

### 工具函数测试

| 测试文件 | 用例数 | 测试内容 |
| --- | --- | --- |
| `lib/agentStatus.test.ts` | 6 | Agent 状态映射（class / label） |
| `lib/basePath.test.ts` | 2 | 应用基础路径检测 |
| `lib/commitPrompt.test.ts` | 7 | Git 提交 prompt 构建：Direct/Worktree 模式、rebase/merge 流程 |
| `lib/i18n.test.ts` | 5 | 国际化：中英文 key 完整性、空值检测 |
| `lib/markdownFileLinks.test.ts` | 3 | Markdown 文件链接解析：工作区内解析、Worktree 映射、外部链接忽略 |
| `lib/resumeCommand.test.ts` | 7 | Agent 恢复命令构建：claude/codex、model flag、权限 flag、addDirs |
| `lib/slashCommands.test.ts` | 24 | 斜杠命令：定义验证、各命令执行逻辑（/help /exit /plan /rename 等） |
| `lib/theme.test.ts` | 3 | 主题切换逻辑 |
| `lib/toolMessages.test.ts` | 6 | 工具消息解析：非工具消息返回 null、legacy 格式、结构化字段 |
| `imageSources.test.ts` | 4 | 图片源解析：浏览器可加载源、本地路径路由、相对路径、序列化输出拒绝 |
| `instructionFiles.test.ts` | 2 | 指令文件名和标签替换 |

---

## 测试覆盖分析

### 覆盖良好的领域
- **Agent 生命周期** (创建/删除/恢复/费用) — 45 个用例
- **飞书集成** — 66 个用例，覆盖卡片构建、通知、服务交互
- **认证与安全** — 20 个用例，完整生命周期
- **HTTP 路由** — 46 个用例，覆盖所有 API 端点
- **Git/Worktree 操作** — 12 个用例
- **客户端 UI 组件** — 47 个用例
- **工具函数/Lib** — 丰富的单元测试

### 潜在改进方向
1. **relay 模块无测试** — 目前 0 个测试文件
2. **HarnessOrchestrator 仅 1 个用例** — 评估/编排逻辑覆盖较薄
3. **E2E / 集成测试缺失** — 没有端到端测试套件
4. **Client 组件 act() 警告** — `AgentChat.test.tsx` 存在 React `act()` 包裹警告
5. **构建依赖** — server 测试依赖 shared 的构建产物，CI 中需确保构建顺序

---

## 运行方式

```bash
# 全部测试（需先构建 shared）
cd shared && npm run build && cd ..
npm test

# 分模块运行
npm run test:shared
npm run test:server   # 需先 build shared
npm run test:client
```
