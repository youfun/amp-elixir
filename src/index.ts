import { existsSync, realpathSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import type { PluginAPI } from "@ampcode/plugin"
import { BridgeClient } from "./bridge-client.ts"

const stringProperty = (description: string) => ({ type: "string", description })
const integerProperty = (description: string) => ({ type: "integer", description })
const booleanProperty = (description: string) => ({ type: "boolean", description })

export default function ampElixir(amp: PluginAPI): void {
  const workspaceURI = amp.system.workspaceRoot
  const workspaceRoot = workspaceURI ? amp.helpers.filePathFromURI(workspaceURI) : null
  let bridge: BridgeClient | null = null

  const client = (): BridgeClient => {
    if (!workspaceRoot) throw new Error("amp-elixir requires an open workspace.")
    bridge ??= new BridgeClient(workspaceRoot)
    return bridge
  }

  amp.registerTool({
    name: "elixir_eval",
    description: `Evaluate Elixir in a persistent target VM managed by Amp.

Use target "project" (default) to load project code without application startup, "application" to start the managed application, "runtime" to attach to PI_ELIXIR_NODE, or "bridge" for AST/CodeMap/Pi helpers. Variables, aliases, imports, and requires persist per Amp thread. Use sandbox mode for untrusted snippets. Prefer this over shell commands for Elixir runtime inspection.`,
    inputSchema: {
      type: "object",
      properties: {
        code: stringProperty("Elixir code to evaluate"),
        mode: {
          type: "string",
          enum: ["trusted", "sandbox"],
          description: "Trusted persistent eval (default) or isolated sandbox eval",
        },
        target: {
          type: "string",
          enum: ["project", "application", "runtime", "bridge"],
          description: "Evaluation target; defaults to project",
        },
        timeout: integerProperty("Evaluation timeout in milliseconds"),
      },
      required: ["code"],
    },
    async execute(input, ctx) {
      const args = { ...input }
      if (args.mode !== "sandbox") args.sessionId = `amp:${ctx.thread.id}`
      return client().call("project_eval_structured", args)
    },
  })

  amp.registerTool({
    name: "elixir_ast_search",
    description: `Search Elixir source structurally with ExAST patterns. Patterns are valid Elixir, not ast-grep syntax: lowercase variables capture nodes, _ is a wildcard, and ... matches zero or more nodes. Use this instead of regex when searching for a code shape.`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: stringProperty("Valid Elixir ExAST pattern"),
        patterns: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Optional named patterns for a one-pass multi-pattern search",
        },
        path: stringProperty("Workspace-relative path to search; defaults to lib/"),
        inside: stringProperty("Only match inside this ExAST pattern"),
        notInside: stringProperty("Skip matches inside this ExAST pattern"),
        allowBroad: booleanProperty("Allow broad patterns such as _"),
        limit: integerProperty("Maximum number of matches"),
      },
      anyOf: [{ required: ["pattern"] }, { required: ["patterns"] }],
    },
    async execute(input) {
      return client().call("ex_ast_search", normalizePath(input, workspaceRoot))
    },
  })

  amp.registerTool({
    name: "elixir_ast_replace",
    description: `Rewrite Elixir source structurally with ExAST. Patterns and replacements must be valid Elixir; lowercase captures from the pattern can be used in the replacement. Use dryRun=true before broad or risky rewrites.`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: stringProperty("Valid Elixir ExAST pattern"),
        replacement: stringProperty("Valid Elixir replacement using captures from the pattern"),
        path: stringProperty("Workspace-relative path to update; defaults to lib/"),
        inside: stringProperty("Only replace inside this ExAST pattern"),
        notInside: stringProperty("Skip replacements inside this ExAST pattern"),
        allowBroad: booleanProperty("Allow broad patterns such as _"),
        limit: integerProperty("Maximum number of replacements"),
        dryRun: booleanProperty("Preview without writing files"),
      },
      required: ["pattern", "replacement"],
    },
    async execute(input) {
      return client().call("ex_ast_replace", normalizePath(input, workspaceRoot))
    },
  })

  amp.registerCommand(
    "elixir-status",
    {
      title: "Elixir bridge status",
      category: "elixir",
      description: "Show the amp-elixir BEAM bridge state",
    },
    async (ctx) => ctx.ui.notify(bridge?.status() ?? statusWithoutBridge(workspaceRoot)),
  )

  amp.registerCommand(
    "elixir-doctor",
    {
      title: "Diagnose Elixir bridge",
      category: "elixir",
      description: "Start the bridge and report actionable setup errors",
    },
    async (ctx) => {
      try {
        await client().start()
        await ctx.ui.notify(`amp-elixir is ready.\n${client().status()}`)
      } catch (error) {
        await ctx.ui.notify(`amp-elixir is unavailable.\n${errorText(error)}\n${client().status()}`)
      }
    },
  )

  amp.registerCommand(
    "elixir-restart",
    {
      title: "Restart Elixir bridge",
      category: "elixir",
      description: "Restart the embedded amp-elixir BEAM bridge",
    },
    async (ctx) => {
      try {
        await client().restart()
        await ctx.ui.notify("amp-elixir bridge restarted.")
      } catch (error) {
        await ctx.ui.notify(`amp-elixir restart failed: ${errorText(error)}`)
      }
    },
  )

  amp.onDispose(() => bridge?.stop())
  amp.logger.log(`amp-elixir loaded for ${workspaceRoot ?? "no workspace"}`)
}

function normalizePath(
  input: Record<string, unknown>,
  workspaceRoot: string | null,
): Record<string, unknown> {
  const rawPath = input.path
  if (!workspaceRoot || typeof rawPath !== "string" || rawPath.length === 0) return input

  const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(workspaceRoot, rawPath)
  if (!existsSync(absolutePath)) throw new Error(`AST tool path does not exist: ${rawPath}`)
  const realWorkspaceRoot = realpathSync(workspaceRoot)
  const realAbsolutePath = realpathSync(absolutePath)
  const realRelativePath = relative(realWorkspaceRoot, realAbsolutePath)
  if (realRelativePath.startsWith("..") || isAbsolute(realRelativePath)) {
    throw new Error("AST tool paths must stay inside the Amp workspace.")
  }
  const relativePath = relative(workspaceRoot, absolutePath)
  return { ...input, path: relativePath || "." }
}

function statusWithoutBridge(workspaceRoot: string | null): string {
  if (!workspaceRoot) return "state: unavailable\nerror: no Amp workspace is open"
  return `state: idle\nproject: ${workspaceRoot}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
