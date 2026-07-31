import { copyFile, cp, mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const source = resolve(import.meta.dir, "../dist/amp-elixir.js")
const bridgeSource = resolve(import.meta.dir, "../node_modules/pi-elixir/packages/bridge")
const skillSource = resolve(import.meta.dir, "../skills/developing-elixir/SKILL.md")
const pluginDirectory = join(homedir(), ".config", "amp", "plugins")
const destination = join(pluginDirectory, "amp-elixir.js")
const bridgeDestination = join(homedir(), ".local", "share", "amp-elixir", "bridge")
const skillDirectory = join(homedir(), ".config", "agents", "skills", "developing-elixir")
const skillDestination = join(skillDirectory, "SKILL.md")

await mkdir(pluginDirectory, { recursive: true })
await rm(destination, { force: true })
await copyFile(source, destination)
console.log(`Installed amp-elixir plugin: ${destination}`)

await installBridge(bridgeSource, bridgeDestination)
console.log(`Installed amp-elixir bridge: ${bridgeDestination}`)

await mkdir(skillDirectory, { recursive: true })
await copyFile(skillSource, skillDestination)
console.log(`Installed amp-elixir skill: ${skillDestination}`)

async function installBridge(sourceDirectory: string, destinationDirectory: string): Promise<void> {
  await rm(destinationDirectory, { recursive: true, force: true })
  await mkdir(destinationDirectory, { recursive: true })
  for (const entry of ["mix.exs", "mix.lock", "README.md", "lib", "priv", "docs"]) {
    await cp(join(sourceDirectory, entry), join(destinationDirectory, entry), { recursive: true })
  }
}
