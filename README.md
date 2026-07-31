# amp-elixir

**English** | [简体中文](README.zh-CN.md)

An Amp-native Elixir/BEAM development plugin with persistent evaluation, isolated project runtimes, and syntax-aware structural search and replacement powered by ExAST.

The plugin starts an independent BEAM control plane automatically. It does not add dependencies to the target project's `mix.exs`, and it exposes only three high-value tools to the model:

| Tool | Purpose |
|---|---|
| `elixir_eval` | Evaluate Elixir in a `project`, `application`, attached `runtime`, or isolated `bridge` VM |
| `elixir_ast_search` | Search Elixir code by AST structure instead of regular expressions |
| `elixir_ast_replace` | Safely rewrite Elixir code by AST structure |

The included `developing-elixir` Agent Skill teaches Amp when to choose these tools, how to select an eval target, when to prefer Tidewave or ordinary shell/LSP tools, and how to use structural replacement safely. Installers deploy the plugin and skill together.

## Requirements

- Amp with Plugin API support
- Bun
- Elixir 1.16 or newer
- Amp started from a Mix project root containing `mix.exs`

The current version requires `mix.exs` at the Amp workspace root. It does not yet select nested Mix projects in umbrella projects or monorepos automatically.

## Installation

Run the following commands in the plugin repository:

```bash
git clone https://github.com/youfun/amp-elixir.git
cd amp-elixir
bun install
bun run check
bun run install:global
```

`install:global` performs these steps:

1. Builds `dist/amp-elixir.js`.
2. Copies the plugin to `~/.config/amp/plugins/amp-elixir.js`.
3. Copies the Bridge to `~/.local/share/amp-elixir/bridge`.
4. Copies the skill to `~/.config/agents/skills/developing-elixir/SKILL.md`.

Amp does not load plugins through symbolic links. Run the installer again after changing or moving the source:

```bash
bun run install:global
```

Then run `plugins: reload` from Amp's command palette, or restart Amp.

### Install in one project only

To test the plugin in a single Mix project without enabling it in every Amp workspace:

```bash
cd /path/to/amp-elixir
bun install
bun run install:project -- /path/to/my_app
```

This writes the built plugin to:

```text
/path/to/my_app/.amp/plugins/amp-elixir.ts
```

It also installs the project skill at:

```text
/path/to/my_app/.agents/skills/developing-elixir/SKILL.md
```

The Bridge is copied to `.amp/amp-elixir/bridge`. Installed plugin files contain no source-machine absolute paths or usernames.

Do not keep both the global and project copies enabled: they register the same tool names. Rename or remove `~/.config/amp/plugins/amp-elixir.js` before reloading Amp when testing the project installation.

### Verify the installation

The following commands should appear in Amp's command palette:

- `elixir: Elixir bridge status`
- `elixir: Diagnose Elixir bridge`
- `elixir: Restart Elixir bridge`

Verify skill discovery from the Mix project root:

```bash
amp skill list | grep developing-elixir
```

The first Elixir tool call or Doctor command downloads and compiles the Bridge's Mix dependencies. Later startups reuse the Mix build cache.

## Everyday usage

You normally do not need to write tool arguments manually. Tell Amp which tool and runtime target to use in natural language.

### Inspect project code without starting the application

```text
Use elixir_eval with the project target to inspect the functions exported by MyApp.Content.Article. Do not start the application.
```

`project` is the default target. Use it for:

- calling pure functions;
- inspecting modules and dependencies;
- inspecting compiled macros and DSLs;
- investigating code while the database, Oban, or external services are unavailable;
- avoiding application-startup side effects.

Equivalent arguments:

```json
{
  "target": "project",
  "code": "MyApp.Content.Article.__info__(:functions)"
}
```

### Start the complete application

Use the `application` target when you need a Repo, supervisors, or the complete OTP application:

```text
Use elixir_eval with the application target to inspect the MyApp.Repo configuration and list the application supervisor's children.
```

```json
{
  "target": "application",
  "code": "Application.get_env(:my_app, MyApp.Repo)"
}
```

The `application` target may connect to databases, start background jobs, or contact external services. Prefer `project` unless application startup is necessary.

### Reuse variables across calls

Trusted eval preserves variables, aliases, imports, and requires for each Amp thread.

First call:

```elixir
articles = Enum.to_list(1..100)
```

A later call in the same Amp thread can use the variable directly:

```elixir
Enum.sum(articles)
```

Different Amp threads use separate eval sessions. The current persistence is in memory: `plugins: reload`, restarting Amp, or restarting the Bridge clears the state.

Use sandbox mode for untrusted code:

```json
{
  "mode": "sandbox",
  "code": "Enum.sum([1, 2, 3])"
}
```

Sandbox eval does not retain thread state and uses stricter isolation and timeouts.

## Runtime targets

| Target | Behavior | Recommended use |
|---|---|---|
| `project` | Loads target project code and dependencies without starting the application | Default exploration, pure functions, modules, and DSLs |
| `application` | Starts the target application in a managed VM | Repos, supervisors, and complete application behavior |
| `runtime` | Attaches to the distributed node configured by `PI_ELIXIR_NODE` | Real Phoenix/Oban/worker processes, ETS, and message queues |
| `bridge` | Evaluates inside the isolated control plane | `AST`, `CodeMap`, `Pi.Docs`, and other Bridge helpers |

### Attach to an existing BEAM node

Start the target application as a distributed node, for example:

```bash
elixir --name my_app@127.0.0.1 --cookie local_dev_cookie -S mix phx.server
```

Start Amp with the target node and matching cookie:

```bash
export PI_ELIXIR_NODE=my_app@127.0.0.1
export ERL_FLAGS="--cookie local_dev_cookie"
amp
```

Then ask Amp:

```text
Use elixir_eval with the runtime target to list supervisors and find the processes with the longest message queues.
```

The node name, cookie, and network must match. Tidewave MCP is usually simpler for an ordinary local Phoenix application that already includes Tidewave. The `runtime` target is most useful for workers, releases, and other BEAM nodes without Tidewave.

## Structural search

`elixir_ast_search` uses ExAST patterns. Patterns must be valid Elixir—not ast-grep syntax.

Pattern rules:

- A lowercase variable such as `reason` captures one AST node.
- `_` matches one node without capturing it.
- `...` matches zero or more nodes.
- Do not use `$NAME` or `$$$ARGS`.

### Find function calls

```text
Use elixir_ast_search to find every Repo.transaction(fn -> ... end) call under lib/.
```

```json
{
  "pattern": "Repo.transaction(fn -> ... end)",
  "path": "lib"
}
```

### Find and capture error reasons

```json
{
  "pattern": "{:error, reason}",
  "path": "lib",
  "limit": 50
}
```

### Restrict the surrounding syntax

```json
{
  "pattern": "Logger.debug(_)",
  "inside": "def handle_call(_, _, _) do ... end",
  "path": "lib"
}
```

Use `patterns` to run multiple named patterns in one pass:

```json
{
  "patterns": {
    "debug_calls": "Logger.debug(_)",
    "inspect_calls": "IO.inspect(_)"
  },
  "path": "lib"
}
```

## Structural replacement

`elixir_ast_replace` updates only matching syntax nodes, avoiding accidental edits to comments and strings. Lowercase captures from the pattern can be reused in the replacement.

### Always start with a dry run

```text
Use elixir_ast_replace to replace IO.inspect(expr) with Logger.debug(inspect(expr)) under lib/. Dry-run it first and do not write files yet.
```

```json
{
  "pattern": "IO.inspect(expr)",
  "replacement": "Logger.debug(inspect(expr))",
  "path": "lib",
  "dryRun": true
}
```

After reviewing the diff, set `dryRun` to `false`. Always run the target project's formatter, compilation checks, and tests after a structural rewrite.

### Limit the number of changes

Use `limit` when you are not yet certain that a pattern is precise enough:

```json
{
  "pattern": "dbg(expr)",
  "replacement": "expr",
  "path": "lib",
  "dryRun": true,
  "limit": 5
}
```

AST tools accept only existing paths inside the active Amp workspace. Symlinks are resolved and checked again to prevent path escapes.

## Recommended AGENTS.md rules

Add the following rules to an Elixir project's `AGENTS.md` if you want Amp to use the tools consistently:

```markdown
## Elixir runtime and structural tools

- Use `elixir_eval` instead of shell commands when evaluating Elixir or inspecting project/runtime state.
- Default to the `project` target. Use `application` only when application startup is required.
- Use `elixir_ast_search` instead of regex when searching for an Elixir code shape.
- Use `elixir_ast_replace` for structural rewrites and always run it with `dryRun: true` first.
- Run the project's formatter, compile checks, and tests after AST replacements.
```

## Development and validation

```bash
# Type checking and unit tests
bun run check

# Real Bridge smoke test against a Mix project
bun run smoke /path/to/my_app

# Build
bun run build

# Build and install globally, then reload Amp plugins
bun run install:global

# Install into one Mix project only
bun run install:project -- /path/to/my_app
```

The smoke test verifies:

- Bridge protocol and capability negotiation;
- evaluation with the `project` target;
- ExAST structural search.

## Configuration

| Environment variable | Purpose |
|---|---|
| `AMP_ELIXIR_BRIDGE_CWD` | Override the BEAM Bridge project directory |
| `AMP_ELIXIR_BRIDGE_MIX_ENV` | Bridge Mix environment; defaults to `dev` |
| `PI_ELIXIR_NODE` | Distributed node used by the `runtime` target |
| `ERL_FLAGS` | Pass a matching Erlang cookie or other VM options |

The initial version disables Pi-specific LLM integration, OTP sessions, executable skills/plugins, and event mirroring because they have not yet been adapted to Amp.

## Troubleshooting

### The tools do not appear in Amp

1. Run `bun run install:global`.
2. Confirm that `~/.config/amp/plugins/amp-elixir.js` exists.
3. Run `plugins: reload` in Amp.
4. Run `elixir: Diagnose Elixir bridge`.

### `No mix.exs found at workspace root`

Start Amp from the Mix project root:

```bash
cd /path/to/my_app
amp
```

### `Bundled pi-elixir bridge not found`

The Bridge installation is missing or incomplete. Reinstall it:

```bash
cd /path/to/amp-elixir
bun install
bun run install:global
```

### The Bridge fails to start or download dependencies

Confirm that Elixir and Mix are available in the shell that starts Amp:

```bash
elixir --version
mix --version
```

Then run `elixir: Restart Elixir bridge`. If it still fails, run `elixir: Diagnose Elixir bridge` to inspect the Bridge path and last startup error.

### Eval cannot find a Repo or supervisor

The `project` target does not start the application. Switch to `application`:

```json
{
  "target": "application",
  "code": "MyApp.Repo.config()"
}
```

### Runtime attachment fails

Check that:

- `PI_ELIXIR_NODE` contains the complete node name;
- the target node has Erlang Distribution enabled;
- both sides use the same cookie;
- the hostname or IP address is resolvable and reachable.

## Uninstall

```bash
rm ~/.config/amp/plugins/amp-elixir.js
```

Then run `plugins: reload` or restart Amp. The target Mix project has no amp-elixir dependency, so no project files need to be changed.

## Upstream and license

The isolated BEAM Bridge comes from the MIT-licensed [`pi-elixir`](https://github.com/elixir-vibe/pi-elixir), currently pinned to version `0.8.4`. amp-elixir implements an Amp Plugin API host adapter around its public JSONL stdio protocol.

Pi-specific LLM brokers, widgets, sessions, executable skills, and project plugins have not yet been ported to Amp and are not enabled automatically.
