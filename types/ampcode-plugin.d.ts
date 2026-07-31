declare module "@ampcode/plugin" {
  export interface PluginUI {
    notify(message: string): Promise<void>
  }

  export interface PluginThread {
    id: string
  }

  export interface PluginToolContext {
    ui: PluginUI
    thread: PluginThread
  }

  export interface PluginCommandContext {
    ui: PluginUI
  }

  export interface PluginToolDefinition {
    name: string
    description: string
    inputSchema: {
      type: "object"
      properties?: Record<string, object>
      required?: string[]
      anyOf?: object[]
      [key: string]: unknown
    }
    execute(
      input: Record<string, unknown>,
      ctx: PluginToolContext,
    ): Promise<string | void>
  }

  export interface PluginAPI {
    logger: { log(...args: unknown[]): void }
    system: { workspaceRoot: unknown | null }
    helpers: { filePathFromURI(uri: unknown): string }
    registerTool(definition: PluginToolDefinition): unknown
    registerCommand(
      id: string,
      options: { title: string; category: string; description: string },
      handler: (ctx: PluginCommandContext) => void | Promise<void>,
    ): unknown
    onDispose(handler: () => void | Promise<void>): unknown
  }
}
