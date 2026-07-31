# amp-elixir

[English](README.md) | **简体中文**

Amp 原生的 Elixir/BEAM 开发插件：提供持久化 Eval、隔离的项目运行时，以及基于 ExAST 的语法结构搜索和替换。

它会自动启动一个独立的 BEAM Control Plane，不需要在目标项目的 `mix.exs` 中添加开发依赖。模型只看到三个高价值工具：

| 工具 | 用途 |
|---|---|
| `elixir_eval` | 在 `project`、`application`、`runtime` 或 `bridge` 环境执行 Elixir |
| `elixir_ast_search` | 按 Elixir AST 结构搜索代码，而不是使用正则表达式 |
| `elixir_ast_replace` | 按 Elixir AST 结构安全地批量替换代码 |

项目同时提供 `developing-elixir` Agent Skill，用来指导 Amp 何时主动调用这些工具、如何选择 Eval target、什么时候改用 Tidewave 或普通 shell/LSP，以及如何安全执行结构替换。安装器会同时部署插件和 Skill。

## 使用前提

- 已安装支持 Plugin API 的 Amp
- 已安装 Bun
- 已安装 Elixir 1.16 或更高版本
- 从包含 `mix.exs` 的 Mix 项目根目录启动 Amp

当前版本要求 Amp workspace 根目录直接包含 `mix.exs`，暂不自动选择 Umbrella 或 Monorepo 中的嵌套 Mix 项目。

## 安装

在插件项目中执行：

```bash
git clone https://github.com/youfun/amp-elixir.git
cd amp-elixir
bun install
bun run check
bun run install:global
```

`install:global` 会：

1. 构建 `dist/amp-elixir.js`；
2. 将插件复制到 `~/.config/amp/plugins/amp-elixir.js`；
3. 将 Bridge 复制到 `~/.local/share/amp-elixir/bridge`；
4. 将 Skill 复制到 `~/.config/agents/skills/developing-elixir/SKILL.md`。

Amp 不允许通过符号链接加载插件，因此修改或移动源码后，需要再次执行：

```bash
bun run install:global
```

然后在 Amp 命令面板执行 `plugins: reload`，或重启 Amp。

### 只在一个项目中安装

如果只想在单个 Mix 项目中测试，而不希望所有 Amp workspace 都启用插件：

```bash
cd /path/to/amp-elixir
bun install
bun run install:project -- /path/to/my_app
```

安装器会把构建后的插件写入：

```text
/path/to/my_app/.amp/plugins/amp-elixir.ts
```

同时会把项目 Skill 安装到：

```text
/path/to/my_app/.agents/skills/developing-elixir/SKILL.md
```

Bridge 会复制到 `.amp/amp-elixir/bridge`。安装后的插件文件不包含源码机器的绝对路径或用户名。

不要同时启用全局副本和项目副本，因为两者会注册相同的工具名。测试项目级安装前，请先重命名或删除 `~/.config/amp/plugins/amp-elixir.js`，再重新加载 Amp。

### 检查是否加载成功

在 Amp 命令面板中应能看到：

- `elixir: Elixir bridge status`
- `elixir: Diagnose Elixir bridge`
- `elixir: Restart Elixir bridge`

在 Mix 项目根目录检查 Skill 是否被发现：

```bash
amp skill list | grep developing-elixir
```

第一次调用 Elixir 工具或执行 Doctor 时，插件会下载并编译 Bridge 的 Mix 依赖；之后会复用 Mix 构建缓存。

## 日常使用

通常不需要手动写工具参数，直接在 Amp 对话中说明要使用哪个工具即可。

### 检查项目代码，但不启动应用

```text
使用 elixir_eval 的 project target，检查 MyApp.Content.Article 暴露了哪些函数，不要启动 Application。
```

`project` 是默认 target，适合：

- 调用纯函数；
- 检查模块和依赖；
- 查看编译后的宏或 DSL；
- 在数据库、Oban 或外部服务不可用时调查项目；
- 避免应用启动产生副作用。

等价参数示意：

```json
{
  "target": "project",
  "code": "MyApp.Content.Article.__info__(:functions)"
}
```

### 启动完整应用后执行

需要 Repo、Supervisor 或完整 Application 时使用 `application`：

```text
使用 elixir_eval 的 application target，查询 MyApp.Repo 当前配置，并列出 MyApp.Supervisor 的 children。
```

```json
{
  "target": "application",
  "code": "Application.get_env(:my_app, MyApp.Repo)"
}
```

注意：`application` 可能连接数据库、启动后台任务或访问外部服务。没有运行时需求时优先使用 `project`。

### 连续调查并复用变量

可信 Eval 会按 Amp thread 保留变量、alias、import 和 require。

第一次调用：

```elixir
articles = Enum.to_list(1..100)
```

同一 Amp thread 的下一次调用可以直接使用：

```elixir
Enum.sum(articles)
```

不同 Amp thread 使用不同的 Eval session，不会共享变量。当前持久化仅存在于插件进程内；执行 `plugins: reload`、重启 Amp 或重启 Bridge 后，内存状态会清空。

如果代码来源不可信，使用 sandbox 模式：

```json
{
  "mode": "sandbox",
  "code": "Enum.sum([1, 2, 3])"
}
```

Sandbox Eval 不保存线程状态，并使用更严格的隔离和超时。

## Runtime targets

| Target | 行为 | 推荐场景 |
|---|---|---|
| `project` | 加载目标项目代码和依赖，但不启动 Application | 默认代码探索、纯函数、模块和 DSL 检查 |
| `application` | 在独立托管 VM 中启动目标 Application | Repo、Supervisor、完整应用行为 |
| `runtime` | 连接通过 `PI_ELIXIR_NODE` 配置的现有分布式节点 | 真实 Phoenix/Oban/Worker 进程、ETS、消息队列 |
| `bridge` | 在隔离 Control Plane 中执行 | `AST`、`CodeMap`、`Pi.Docs` 等 Bridge helper |

### 连接已经运行的 BEAM 节点

先以分布式节点启动应用，例如：

```bash
elixir --name my_app@127.0.0.1 --cookie local_dev_cookie -S mix phx.server
```

再从相同环境启动 Amp：

```bash
export PI_ELIXIR_NODE=my_app@127.0.0.1
export ERL_FLAGS="--cookie local_dev_cookie"
amp
```

然后提示 Amp：

```text
使用 elixir_eval 的 runtime target，列出当前节点的 Supervisor 和消息队列最长的进程。
```

节点名、cookie 和网络必须匹配。普通本地 Phoenix 调试如果已经安装 Tidewave，使用 Tidewave MCP 通常更简单；`runtime` 主要用于未挂载 Tidewave 的 Worker、Release 或其他 BEAM 节点。

## 语法结构搜索

`elixir_ast_search` 使用 ExAST pattern。Pattern 必须是合法 Elixir，不是 ast-grep 语法。

规则：

- 小写变量捕获一个 AST 节点，例如 `reason`；
- `_` 匹配一个节点但不捕获；
- `...` 匹配零个或多个节点；
- 不要使用 `$NAME` 或 `$$$ARGS`。

### 查找函数调用

```text
使用 elixir_ast_search，在 lib/ 下查找所有 Repo.transaction(fn -> ... end)。
```

```json
{
  "pattern": "Repo.transaction(fn -> ... end)",
  "path": "lib"
}
```

### 查找并捕获错误原因

```json
{
  "pattern": "{:error, reason}",
  "path": "lib",
  "limit": 50
}
```

### 限制搜索上下文

```json
{
  "pattern": "Logger.debug(_)",
  "inside": "def handle_call(_, _, _) do ... end",
  "path": "lib"
}
```

也可以用 `patterns` 一次执行多个命名搜索：

```json
{
  "patterns": {
    "debug_calls": "Logger.debug(_)",
    "inspect_calls": "IO.inspect(_)"
  },
  "path": "lib"
}
```

## 语法结构替换

`elixir_ast_replace` 只修改匹配的语法节点，不会误改注释或字符串。Pattern 中的小写捕获变量可以在 replacement 中复用。

### 始终先 Dry Run

```text
使用 elixir_ast_replace，把 lib/ 下的 IO.inspect(expr) 替换为 Logger.debug(inspect(expr))，先 dry-run，不要写文件。
```

```json
{
  "pattern": "IO.inspect(expr)",
  "replacement": "Logger.debug(inspect(expr))",
  "path": "lib",
  "dryRun": true
}
```

检查 diff 正确后，再将 `dryRun` 改为 `false`。结构替换后仍应执行项目自己的 formatter、编译和测试。

### 限制修改数量

不确定 pattern 是否足够精确时，使用 `limit`：

```json
{
  "pattern": "dbg(expr)",
  "replacement": "expr",
  "path": "lib",
  "dryRun": true,
  "limit": 5
}
```

AST 工具只接受当前 Amp workspace 内已经存在的路径，并会解析符号链接后再次检查，防止路径逃出工作区。

## 推荐 AGENTS.md 规则

可以在 Elixir 项目的 `AGENTS.md` 中加入：

```markdown
## Elixir runtime and structural tools

- Use `elixir_eval` instead of shell commands when evaluating Elixir or inspecting project/runtime state.
- Default to the `project` target. Use `application` only when application startup is required.
- Use `elixir_ast_search` instead of regex when searching for an Elixir code shape.
- Use `elixir_ast_replace` for structural rewrites and always run it with `dryRun: true` first.
- Run the project's formatter, compile checks, and tests after AST replacements.
```

## 开发与验证

```bash
# 类型检查和单元测试
bun run check

# 使用指定 Mix 项目执行真实 Bridge smoke test
bun run smoke /path/to/my_app

# 构建
bun run build

# 构建、全局安装，然后重新加载 Amp 插件
bun run install:global

# 只安装到一个 Mix 项目
bun run install:project -- /path/to/my_app
```

Smoke test 会验证：

- Bridge protocol/capability handshake；
- `project` target Eval；
- ExAST 搜索。

## 配置

| 环境变量 | 说明 |
|---|---|
| `AMP_ELIXIR_BRIDGE_CWD` | 覆盖 Bridge 项目目录 |
| `AMP_ELIXIR_BRIDGE_MIX_ENV` | Bridge Mix 环境，默认 `dev` |
| `PI_ELIXIR_NODE` | `runtime` target 要连接的分布式节点 |
| `ERL_FLAGS` | 可用于传入匹配的 Erlang cookie 或其他 VM 参数 |

初始版本会关闭尚未适配 Amp 的 Pi LLM、OTP session、可执行 skills/plugins 和事件 mirror。

## 故障排查

### Amp 中看不到工具

1. 执行 `bun run install:global`；
2. 确认存在 `~/.config/amp/plugins/amp-elixir.js`；
3. 在 Amp 执行 `plugins: reload`；
4. 运行 `elixir: Diagnose Elixir bridge`。

### `No mix.exs found at workspace root`

从 Mix 项目根目录重新启动 Amp：

```bash
cd /path/to/my_app
amp
```

### `Bundled pi-elixir bridge not found`

Bridge 安装缺失或不完整时，重新执行：

```bash
cd /path/to/amp-elixir
bun install
bun run install:global
```

### Bridge 启动或依赖下载失败

确认当前 shell 中以下命令可用：

```bash
elixir --version
mix --version
```

然后运行 `elixir: Restart Elixir bridge`。如果仍失败，运行 `elixir: Diagnose Elixir bridge` 查看 Bridge 路径和最后一个启动错误。

### Eval 找不到 Repo 或 Supervisor

`project` target 不启动 Application。将调用改为：

```json
{
  "target": "application",
  "code": "MyApp.Repo.config()"
}
```

### Runtime 无法连接

检查：

- `PI_ELIXIR_NODE` 是否是完整节点名；
- 目标节点是否启用了 Erlang Distribution；
- 双方 cookie 是否一致；
- hostname/IP 是否可以解析和访问。

## 卸载

```bash
rm ~/.config/amp/plugins/amp-elixir.js
```

然后执行 `plugins: reload` 或重启 Amp。目标 Mix 项目没有安装任何 amp-elixir 依赖，因此无需修改项目文件。

## Upstream 与许可

独立 BEAM Bridge 来自 MIT License 的 [`pi-elixir`](https://github.com/elixir-vibe/pi-elixir)，当前固定版本为 `0.8.4`。amp-elixir 基于其公开 JSONL stdio protocol 实现 Amp Plugin API 宿主适配层。

Pi 专属的 LLM broker、widgets、sessions、可执行 skills 和 project plugins 尚未接入 Amp，也不会在当前版本自动启用。
