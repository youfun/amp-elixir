import { resolve } from "node:path"
import { BridgeClient } from "../src/bridge-client.ts"

const projectRoot = resolve(process.argv[2] ?? process.env.AMP_ELIXIR_SMOKE_PROJECT ?? process.cwd())
const bridge = new BridgeClient(projectRoot)

try {
  await bridge.start()
  const evalResult = await bridge.call("project_eval_structured", {
    code: "Enum.sum([1, 2, 3])",
    target: "project",
    sessionId: "amp-elixir-smoke",
  })
  if (!evalResult.includes("6")) throw new Error(`Unexpected eval result: ${evalResult}`)

  const searchResult = await bridge.call("ex_ast_search", {
    pattern: "defmodule _ do ... end",
    path: "lib",
    limit: 1,
  })
  const payload = JSON.parse(searchResult) as { kind?: string }
  if (payload.kind !== "ast_search") throw new Error(`Unexpected AST result: ${searchResult}`)

  console.log(bridge.status())
  console.log("smoke: eval and AST search passed")
} finally {
  bridge.stop()
}
