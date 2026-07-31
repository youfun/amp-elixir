---
name: developing-elixir
description: Uses persistent Elixir/BEAM evaluation and ExAST structural tools for Elixir, Phoenix, Ecto, Ash, and OTP development. Use when inspecting runtime behavior, debugging processes or data, searching for Elixir code shapes, or performing syntax-aware refactors.
license: MIT
compatibility: Requires the amp-elixir plugin, Elixir 1.16+, and a Mix project at the Amp workspace root.
---

# Developing Elixir with amp-elixir

Use amp-elixir for runtime truth and syntax-aware code operations. Do not force it into tasks better handled by an exact text search, a normal file edit, LSP, or a project test command.

## Choose the right tool

| Need | Tool |
|---|---|
| Evaluate Elixir, inspect modules/dependencies, reproduce behavior, inspect processes or typed data | `elixir_eval` |
| Find code by Elixir syntax shape across files | `elixir_ast_search` |
| Rewrite matching Elixir syntax nodes | `elixir_ast_replace` |
| Find an exact string or known symbol | `rg`, file read, or LSP |
| Run formatter, compiler, tests, migrations, or external CLIs | shell/Mix tools |
| Query Phoenix logs, SQL, Ecto schemas, or Ash resources when Tidewave tools are available | Prefer the dedicated Tidewave tool |

## Select an eval target deliberately

1. Default to `target: "project"`. It loads project code and dependencies without starting the application.
2. Use `target: "application"` only when a Repo, supervisor, application configuration, or started dependency is required. Application startup may connect to services or start jobs.
3. Use `target: "runtime"` only to inspect an existing distributed node configured by `PI_ELIXIR_NODE` and a matching cookie.
4. Use `target: "bridge"` for helpers such as `AST`, `CodeMap`, and `Pi.Docs`.
5. Use `mode: "sandbox"` for untrusted snippets. Sandbox calls do not retain state.

Trusted eval keeps variables, aliases, imports, and requires for the current Amp thread. Build investigations incrementally instead of repeating large expressions. Remember that reloading the plugin, restarting Amp, or restarting the Bridge clears in-memory state.

## Structural search workflow

Use ExAST syntax, which must be valid Elixir:

- lowercase variables capture nodes: `{:error, reason}`;
- `_` matches one node without capturing it;
- `...` matches zero or more nodes;
- never use ast-grep metavariables such as `$NAME` or `$$$ARGS`.

Start with a narrow path and a reasonable `limit`. Use `inside` or `notInside` when the same call shape has different meanings in different contexts. Read surrounding source before deciding on an edit.

Examples:

```text
pattern: Repo.transaction(fn -> ... end)
path: lib
```

```text
pattern: Logger.debug(_)
inside: def handle_call(_, _, _) do ... end
path: lib
```

## Structural replacement workflow

1. Search first and inspect representative matches.
2. Call `elixir_ast_replace` with `dryRun: true`.
3. Review every proposed diff for capture mistakes and formatting changes.
4. Apply the replacement only when the dry run is correct.
5. Run the project's formatter, focused compile check, and relevant tests.

Use `limit` for a new or broad pattern. Never turn off dry-run merely to see whether a pattern works.

## Runtime investigation workflow

1. Ask the smallest expression that can establish runtime truth.
2. Keep returned collections bounded with `Enum.take/2`, targeted filters, or aggregates.
3. Reuse bindings across calls instead of returning large data repeatedly.
4. Prefer standard Elixir/OTP introspection (`Process.info/2`, `Supervisor.which_children/1`, `Application.get_env/3`) over custom wrappers.
5. If `project` cannot see a started process or Repo, reassess whether `application`, attached `runtime`, or a dedicated Tidewave tool is the correct boundary.

## Failure handling

- If an amp-elixir tool reports that the Bridge is unavailable, use the `elixir: Diagnose Elixir bridge` command and report its actionable error.
- If `mix.exs` is missing at the workspace root, do not guess a nested project. Ask the user to open Amp from the intended Mix root.
- If runtime attachment fails, verify the full node name, Erlang Distribution, cookie, and network reachability.
- Do not replace a failing runtime check with assumptions from source code; state clearly what remains unverified.
