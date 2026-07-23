#!/usr/bin/env node
/**
 * Sync app version across package.json, src-tauri/tauri.conf.json, and Cargo.toml.
 * Usage: node scripts/sync-version.mjs 0.2.0
 *        node scripts/sync-version.mjs v0.2.0
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = (process.argv[2] || '').trim()
if (!raw) {
  console.error('Usage: node scripts/sync-version.mjs <version>')
  process.exit(1)
}

const version = raw.replace(/^v/i, '')
if (!/^\d+\.\d+\.\d+([.-][\w.-]+)?$/.test(version)) {
  console.error(`Invalid version: ${raw}`)
  process.exit(1)
}

function writeJson(path, mutator) {
  const full = join(root, path)
  const data = JSON.parse(readFileSync(full, 'utf8'))
  mutator(data)
  writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

writeJson('package.json', (pkg) => {
  pkg.version = version
})

writeJson('src-tauri/tauri.conf.json', (cfg) => {
  cfg.version = version
})

const cargoPath = join(root, 'src-tauri/Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8')
if (!/^version\s*=\s*"[^"]+"/m.test(cargo)) {
  console.error('Failed to find version in Cargo.toml')
  process.exit(1)
}
const nextCargo = cargo.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
)
writeFileSync(cargoPath, nextCargo, 'utf8')

console.log(`Synced version → ${version}`)
