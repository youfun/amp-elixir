import { describe, expect, test } from "bun:test"
import { handshakeProblem, truncateResult } from "../src/bridge-client.ts"

describe("handshakeProblem", () => {
  test("accepts the required protocol and capabilities", () => {
    expect(
      handshakeProblem({
        protocol: 2,
        capabilities: [
          "stdio_jsonl",
          "bridge_requests",
          "project_eval_worker",
          "application_eval_worker",
          "attached_runtime_eval",
          "structured_diagnostics",
          "project_context",
        ],
      }),
    ).toBeNull()
  })

  test("rejects a protocol mismatch", () => {
    expect(handshakeProblem({ protocol: 1, capabilities: [] })).toContain("protocol mismatch")
  })
})

test("truncateResult bounds line output", () => {
  expect(truncateResult("one\ntwo\nthree", 2, 1024)).toBe(
    "one\ntwo\n\n[amp-elixir: output truncated]",
  )
})
