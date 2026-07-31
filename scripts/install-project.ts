import { existsSync } from "node:fs"
import { copyFile, cp, mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

const projectRoot = resolve(process.argv[2] ?? process.cwd())
if (!existsSync(join(projectRoot, "mix.exs"))) {
  throw new Error(`No mix.exs found at project root: ${projectRoot}`)
}

const source = resolve(import.meta.dir, "../dist/amp-elixir.js")
const bridgeSource = resolve(import.meta.dir, "../node_modules/pi-elixir/packages/bridge")
const skillSource = resolve(import.meta.dir, "../skills/developing-elixir/SKILL.md")
const pluginDirectory = join(projectRoot, ".amp", "plugins")
const destination = join(pluginDirectory, "amp-elixir.ts")
const bridgeDestination = join(projectRoot, ".amp", "amp-elixir", "bridge")
const skillDirectory = join(projectRoot, ".agents", "skills", "developing-elixir")
const skillDestination = join(skillDirectory, "SKILL.md")

await mkdir(pluginDirectory, { recursive: true })
await copyFile(source, destination)
console.log(`Installed amp-elixir project plugin: ${destination}`)

await installBridge(bridgeSource, bridgeDestination)
console.log(`Installed amp-elixir project bridge: ${bridgeDestination}`)

await mkdir(skillDirectory, { recursive: true })
await copyFile(skillSource, skillDestination)
console.log(`Installed amp-elixir project skill: ${skillDestination}`)

async function installBridge(sourceDirectory: string, destinationDirectory: string): Promise<void> {
  await rm(destinationDirectory, { recursive: true, force: true })
  await mkdir(destinationDirectory, { recursive: true })
  for (const entry of ["mix.exs", "mix.lock", "README.md", "lib", "priv", "docs"]) {
    await cp(join(sourceDirectory, entry), join(destinationDirectory, entry), { recursive: true })
  }
}
