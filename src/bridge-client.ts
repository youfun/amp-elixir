import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const START_EXPRESSION = "Pi.Transport.Stdio.start()"
const PROTOCOL_VERSION = 2
const REQUIRED_CAPABILITIES = [
  "stdio_jsonl",
  "bridge_requests",
  "project_eval_worker",
  "application_eval_worker",
  "attached_runtime_eval",
  "structured_diagnostics",
  "project_context",
] as const
const START_TIMEOUT_MS = 180_000
const CALL_TIMEOUT_MS = 120_000

export interface BridgeInfo {
  project?: string
  version?: string
  build?: string
  protocol?: number
  transport?: string
  capabilities?: string[]
}

interface ToolResult {
  text: string
  isError: boolean
}

interface PendingCall {
  resolve(result: ToolResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

type BridgeState = "idle" | "installing" | "starting" | "ready" | "failed" | "stopped"

function packageRoot(): string {
  return dirname(import.meta.dir)
}

export function defaultBridgeDirectory(): string {
  if (process.env.AMP_ELIXIR_BRIDGE_CWD) return process.env.AMP_ELIXIR_BRIDGE_CWD

  const candidates = [
    join(packageRoot(), "amp-elixir", "bridge"),
    join(homedir(), ".local", "share", "amp-elixir", "bridge"),
    join(packageRoot(), "node_modules", "pi-elixir", "packages", "bridge"),
  ]
  return candidates.find((directory) => existsSync(join(directory, "mix.exs"))) ?? candidates[0]
}

export function handshakeProblem(info: BridgeInfo): string | null {
  if (info.protocol !== PROTOCOL_VERSION) {
    return `Bridge protocol mismatch: received ${info.protocol ?? "unknown"}, expected ${PROTOCOL_VERSION}.`
  }

  const capabilities = new Set(info.capabilities ?? [])
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.has(capability))
  return missing.length > 0 ? `Bridge is missing capabilities: ${missing.join(", ")}.` : null
}

export function truncateResult(text: string, maxLines = 200, maxBytes = 65_536): string {
  const lines = text.split("\n")
  let output = lines.slice(0, maxLines).join("\n")
  let truncated = lines.length > maxLines

  if (Buffer.byteLength(output) > maxBytes) {
    output = Buffer.from(output).subarray(0, maxBytes).toString("utf8")
    truncated = true
  }

  return truncated ? `${output}\n\n[amp-elixir: output truncated]` : output
}

export class BridgeClient {
  readonly projectRoot: string
  readonly bridgeDirectory: string
  state: BridgeState = "idle"
  info: BridgeInfo | null = null
  lastError: string | null = null

  #process: Bun.PipedSubprocess | null = null
  #startPromise: Promise<void> | null = null
  #stdoutBuffer = ""
  #stderr = ""
  #nextId = 0
  #pending = new Map<number, PendingCall>()

  constructor(projectRoot: string, bridgeDirectory = defaultBridgeDirectory()) {
    this.projectRoot = projectRoot
    this.bridgeDirectory = bridgeDirectory
  }

  async start(): Promise<void> {
    if (this.state === "ready") return
    if (this.#startPromise) return this.#startPromise

    this.#startPromise = this.#doStart().finally(() => {
      this.#startPromise = null
    })
    return this.#startPromise
  }

  async #doStart(): Promise<void> {
    this.lastError = null
    this.#stderr = ""

    if (!existsSync(join(this.projectRoot, "mix.exs"))) {
      throw this.#fail(`No mix.exs found at workspace root: ${this.projectRoot}`)
    }
    if (!existsSync(join(this.bridgeDirectory, "mix.exs"))) {
      throw this.#fail(
        `Bundled pi-elixir bridge not found at ${this.bridgeDirectory}. Run bun install in amp-elixir.`,
      )
    }

    this.state = "installing"
    try {
      await execFileAsync("mix", ["deps.get"], {
        cwd: this.bridgeDirectory,
        env: this.#childEnvironment(),
        timeout: START_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      throw this.#fail(`Could not prepare the BEAM bridge: ${errorMessage(error)}`)
    }

    this.state = "starting"
    const child = Bun.spawn(["mix", "run", "-e", START_EXPRESSION], {
      cwd: this.bridgeDirectory,
      env: this.#childEnvironment(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    this.#process = child

    const ready = new Promise<void>((resolve, reject) => {
      let settled = false
      const rejectStartup = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
      const timeout = setTimeout(() => {
        this.stop()
        rejectStartup(this.#fail(`BEAM bridge did not become ready within ${START_TIMEOUT_MS}ms.`))
      }, START_TIMEOUT_MS)

      void this.#readStdout(child.stdout, (message) => {
        if (message.type === "ready") {
          const info = (message.info ?? {}) as BridgeInfo
          const problem = handshakeProblem(info)
          if (problem) {
            this.stop()
            rejectStartup(this.#fail(problem))
            return
          }
          this.info = info
          this.state = "ready"
          settled = true
          clearTimeout(timeout)
          resolve()
          return
        }
        this.#handleMessage(message)
      })

      void this.#readStderr(child.stderr)
      void child.exited.then((code) => {
        if (this.state === "ready" || this.state === "starting") {
          const error = this.#fail(
            `BEAM bridge exited with code ${code}.${this.#stderr ? `\n${this.#stderr}` : ""}`,
          )
          rejectStartup(error)
        }
        this.#process = null
        this.#rejectPending(new Error(this.lastError ?? "BEAM bridge exited."))
      })
    })

    await ready
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    await this.start()
    const child = this.#process
    if (!child || !child.stdin) throw new Error("BEAM bridge is not ready.")

    const id = ++this.#nextId
    const result = await new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`BEAM tool ${name} timed out after ${CALL_TIMEOUT_MS}ms.`))
      }, CALL_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ type: "call", id, name, arguments: args })}\n`)
      child.stdin.flush()
    })

    if (result.isError) throw new Error(result.text)
    return truncateResult(result.text)
  }

  stop(): void {
    const child = this.#process
    this.#process = null
    this.info = null
    this.state = "stopped"
    this.#rejectPending(new Error("BEAM bridge stopped."))
    try {
      child?.stdin?.end()
      child?.kill()
    } catch {
      // The process may already have exited.
    }
  }

  async restart(): Promise<void> {
    this.stop()
    this.state = "idle"
    await this.start()
  }

  status(): string {
    const details = [
      `state: ${this.state}`,
      `project: ${this.projectRoot}`,
      `bridge: ${this.bridgeDirectory}`,
    ]
    if (this.info?.build) details.push(`build: ${this.info.build}`)
    if (this.info?.project) details.push(`target: ${this.info.project}`)
    if (this.lastError) details.push(`error: ${this.lastError}`)
    return details.join("\n")
  }

  #childEnvironment(): Record<string, string | undefined> {
    const mixHome = join(homedir(), ".mix")
    return {
      ...process.env,
      MIX_ENV: process.env.AMP_ELIXIR_BRIDGE_MIX_ENV ?? "dev",
      MIX_HOME: mixHome,
      MIX_ARCHIVES: join(mixHome, "archives"),
      PI_ELIXIR_PROJECT_CWD: this.projectRoot,
      PI_ELIXIR_LLM: "0",
      PI_ELIXIR_SESSIONS: "0",
      PI_ELIXIR_PLUGINS: "0",
      PI_ELIXIR_SKILLS: "0",
      PI_ELIXIR_MIRROR: "0",
    }
  }

  async #readStdout(
    stream: ReadableStream<Uint8Array>,
    onMessage: (message: Record<string, unknown>) => void,
  ): Promise<void> {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      this.#stdoutBuffer += decoder.decode(chunk, { stream: true })
      while (true) {
        const newline = this.#stdoutBuffer.indexOf("\n")
        if (newline < 0) break
        const line = this.#stdoutBuffer.slice(0, newline).trim()
        this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1)
        if (!line) continue
        try {
          onMessage(JSON.parse(line) as Record<string, unknown>)
        } catch {
          // Mix compilation output can share stdout before the JSONL bridge is ready.
        }
      }
    }
  }

  async #readStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      if (this.#stderr.length < 8_000) this.#stderr += decoder.decode(chunk).slice(0, 2_000)
    }
  }

  #handleMessage(message: Record<string, unknown>): void {
    if (message.type === "result" && typeof message.id === "number") {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#pending.delete(message.id)
      pending.resolve({
        text: typeof message.text === "string" ? message.text : "",
        isError: message.isError === true,
      })
      return
    }

    if (message.type === "request" && typeof message.id === "string") {
      const child = this.#process
      child?.stdin?.write(
        `${JSON.stringify({
          type: "response",
          id: message.id,
          ok: false,
          error: "BEAM-to-host LLM requests are not enabled in amp-elixir.",
        })}\n`,
      )
      child?.stdin?.flush()
    }
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #fail(message: string): Error {
    this.state = "failed"
    this.lastError = message
    return new Error(message)
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const candidate = error as { stderr?: string | Buffer; stdout?: string | Buffer }
    const output = [candidate.stderr, candidate.stdout]
      .map((value) => value?.toString().trim())
      .filter(Boolean)
      .join("\n")
    if (output) return output
  }
  return String(error)
}
