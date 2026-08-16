import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from './editorFs'
import { normalizePath } from './workspacePath'

export type PathAlias = {
  /** Import prefix, e.g. `@/` or `@components` */
  find: string
  /** Absolute filesystem prefix */
  replacement: string
}

const CONFIG_CANDIDATES = [
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.web.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vue.config.js',
  'vue.config.ts',
  'vue.config.mjs',
  'webpack.config.js',
  'webpack.config.ts',
  'webpack.config.mjs',
]

function joinRoot(root: string, rel: string): string {
  const r = normalizePath(root)
  const p = rel.replace(/\\/g, '/').replace(/^\.?\//, '')
  return normalizePath(`${r}/${p}`)
}

/** Strip line and block comments for JSONC (tsconfig). */
function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  let inStr = false
  let quote = ''
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (inStr) {
      out += c
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 2
        continue
      }
      if (c === quote) inStr = false
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && n === '/') {
      i += 2
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  // trailing commas
  return out.replace(/,\s*([\]}])/g, '$1')
}

function aliasesFromTsconfig(
  projectRoot: string,
  jsonText: string,
): PathAlias[] {
  try {
    const data = JSON.parse(stripJsonc(jsonText)) as {
      compilerOptions?: {
        baseUrl?: string
        paths?: Record<string, string[]>
      }
    }
    const opts = data.compilerOptions
    if (!opts?.paths) return []
    const baseUrl = opts.baseUrl ?? '.'
    const baseAbs = joinRoot(projectRoot, baseUrl)
    const out: PathAlias[] = []
    for (const [key, targets] of Object.entries(opts.paths)) {
      const target = targets?.[0]
      if (!target) continue
      // "@/*" → find "@/", replacement ".../src/"
      const find = key.replace(/\*$/, '')
      const replRel = target.replace(/\*$/, '')
      const replacement = joinRoot(baseAbs, replRel)
      if (find) out.push({ find, replacement })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Read the value of an alias entry starting at `from` (the character right
 * after the `:`). Scans with quote/paren/bracket depth so values such as
 * `path.resolve(__dirname, 'src')` are captured whole — a naive `[^,}\n]+`
 * cut them at the first comma, producing the garbage alias
 * `<root>/path.resolve(__dirname` (audit P1-6).
 */
function extractObjectValue(
  text: string,
  from: number,
): { value: string; end: number } | null {
  let i = from
  while (i < text.length && /\s/.test(text[i])) i++
  const start = i
  let depth = 0
  let quote: string | null = null
  while (i < text.length) {
    const c = text[i]
    if (quote) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
      i++
      continue
    }
    if (depth === 0 && (c === ',' || c === '\n')) break
    i++
  }
  if (start >= i) return null
  return { value: text.slice(start, i).trim(), end: i }
}

/**
 * Heuristic parse of vite / webpack / vue alias blocks.
 * Handles common `path.resolve(__dirname, 'src')` and `new URL('./src', …)` forms.
 */
function aliasesFromBundlerConfig(
  projectRoot: string,
  text: string,
): PathAlias[] {
  const out: PathAlias[] = []
  const root = normalizePath(projectRoot)

  const push = (findRaw: string, replRaw: string) => {
    let find = findRaw.trim()
    if (!find) return
    // Normalize `@` → prefer `@/` if replacement looks like a folder
    let replacement = replRaw.trim().replace(/\\/g, '/')

    // path.resolve(__dirname, 'src') / join(__dirname, 'src') / resolve(__dirname, './src')
    const resolveMatch = replacement.match(
      /(?:path\.)?(?:resolve|join)\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/,
    )
    if (resolveMatch) {
      replacement = joinRoot(root, resolveMatch[1])
    } else {
      const urlMatch = replacement.match(
        /(?:fileURLToPath\s*\(\s*)?new\s+URL\(\s*['"]([^'"]+)['"]/,
      )
      if (urlMatch) {
        replacement = joinRoot(root, urlMatch[1])
      } else if (
        (replacement.startsWith("'") && replacement.endsWith("'")) ||
        (replacement.startsWith('"') && replacement.endsWith('"'))
      ) {
        const inner = replacement.slice(1, -1)
        replacement = inner.startsWith('.') || !inner.match(/^[a-zA-Z]:/)
          ? joinRoot(root, inner)
          : normalizePath(inner)
      } else if (replacement.startsWith('./') || replacement.startsWith('../')) {
        replacement = joinRoot(root, replacement)
      } else if (!replacement.includes('/') && !replacement.includes('\\')) {
        // bare 'src'
        replacement = joinRoot(root, replacement)
      } else if (!/^[a-zA-Z]:/.test(replacement) && !replacement.startsWith('/')) {
        replacement = joinRoot(root, replacement)
      }
    }

    // Regex find: /^@\// → @/
    const regexFind = find.match(/^\/\^(.+?)(?:\$)?\//)
    if (regexFind) {
      find = regexFind[1].replace(/\\(.)/g, '$1')
    }

    out.push({ find, replacement: normalizePath(replacement) })
  }

  // Object form: '@': path.resolve(...), "@/": ...
  const objRe = /['"](@[\w/-]*|~[\w/-]*)['"]\s*:\s*/g
  let m: RegExpExecArray | null
  while ((m = objRe.exec(text))) {
    const val = extractObjectValue(text, objRe.lastIndex)
    if (val) push(m[1], val.value)
    objRe.lastIndex = val ? val.end : objRe.lastIndex + 1
  }

  // Array form: { find: '@', replacement: '...' }
  const arrRe =
    /find\s*:\s*(?:\/\^([^/]+)\/[a-z]*|['"]([^'"]+)['"])\s*,\s*replacement\s*:\s*/g
  while ((m = arrRe.exec(text))) {
    const val = extractObjectValue(text, arrRe.lastIndex)
    if (val) push(m[1] || m[2], val.value)
    arrRe.lastIndex = val ? val.end : arrRe.lastIndex + 1
  }

  return out
}

function mergeAliases(list: PathAlias[]): PathAlias[] {
  const map = new Map<string, PathAlias>()
  for (const a of list) {
    const key = a.find
    // Later entries (vite) can override earlier (tsconfig) of same find
    map.set(key, a)
  }
  // Longer prefixes first for matching
  return [...map.values()].sort((a, b) => b.find.length - a.find.length)
}

async function tryRead(projectRoot: string, name: string): Promise<string | null> {
  try {
    const path = joinRoot(projectRoot, name)
    const res = await readTextFile(path, projectRoot)
    return res.content
  } catch {
    return null
  }
}

/** Load path aliases from tsconfig / vite / webpack / vue configs. */
export async function loadProjectAliases(
  projectRoot: string,
): Promise<PathAlias[]> {
  const collected: PathAlias[] = []

  for (const name of CONFIG_CANDIDATES) {
    const text = await tryRead(projectRoot, name)
    if (!text) continue
    if (name.endsWith('.json')) {
      collected.push(...aliasesFromTsconfig(projectRoot, text))
    } else {
      collected.push(...aliasesFromBundlerConfig(projectRoot, text))
    }
  }

  // Common Vite default when nothing found: @ → src
  if (collected.length === 0) {
    const src = joinRoot(projectRoot, 'src')
    collected.push({ find: '@/', replacement: `${src}/` })
    collected.push({ find: '@', replacement: src })
  }

  return mergeAliases(collected)
}

const RESOLVE_EXTS = [
  '.d.ts',
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.json',
  '.css',
  '.scss',
]

async function fileExists(path: string, root: string): Promise<boolean> {
  try {
    await readTextFile(path, root)
    return true
  } catch {
    return false
  }
}

async function expandLocalCandidate(base: string, root: string): Promise<string | null> {
  const normalized = normalizePath(base)
  if (await fileExists(normalized, root)) return normalized
  const lower = normalized.toLowerCase()
  const hasExt = RESOLVE_EXTS.some((e) => lower.endsWith(e))
  if (!hasExt) {
    for (const ext of RESOLVE_EXTS) {
      const p = `${normalized}${ext}`
      if (await fileExists(p, root)) return p
    }
    for (const name of [
      'index.d.ts',
      'index.tsx',
      'index.ts',
      'index.jsx',
      'index.js',
      'index.vue',
    ]) {
      const p = `${normalized}/${name}`
      if (await fileExists(p, root)) return p
    }
  }
  return null
}

function joinRelativeLocal(fromFile: string, spec: string): string {
  const parts = normalizePath(fromFile).split('/')
  parts.pop()
  for (const part of spec.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/** Local fallback when the Tauri command is unavailable or returns null.
 *  `readRoot` (containing workspace) is the containment gate for disk reads —
 *  import targets may legitimately sit outside the project (monorepos). */
async function resolveImportLocally(
  projectRoot: string,
  fromFile: string,
  specifier: string,
  aliases: PathAlias[],
  readRoot: string,
): Promise<string | null> {
  const spec = specifier.trim()
  if (!spec || /^(data:|https?:|node:)/.test(spec)) return null

  if (spec.startsWith('./') || spec.startsWith('../')) {
    return expandLocalCandidate(joinRelativeLocal(fromFile, spec), readRoot)
  }

  const sorted = [...aliases].sort((a, b) => b.find.length - a.find.length)
  for (const a of sorted) {
    const find = a.find
    if (
      spec === find.replace(/\/$/, '') ||
      spec.startsWith(find) ||
      (!find.endsWith('/') && spec.startsWith(`${find}/`))
    ) {
      let rest = ''
      if (spec === find.replace(/\/$/, '')) rest = ''
      else if (find.endsWith('/') && spec.startsWith(find)) {
        rest = spec.slice(find.length)
      } else if (spec.startsWith(`${find}/`)) {
        rest = spec.slice(find.length + 1)
      } else if (spec.startsWith(find)) {
        rest = spec.slice(find.length)
      }
      const repl = normalizePath(a.replacement)
      const joined = rest
        ? `${repl.replace(/\/$/, '')}/${rest}`
        : repl
      const hit = await expandLocalCandidate(joined, readRoot)
      if (hit) return hit
    }
  }

  const inRoot = await expandLocalCandidate(
    `${normalizePath(projectRoot)}/${spec}`,
    readRoot,
  )
  if (inRoot) return inRoot

  // Bare package: prefer @types / package typings (mirrors Rust resolve_node_module).
  return resolveNodeModuleLocally(projectRoot, spec, readRoot)
}

/** Resolve only typings (.d.ts / .ts / .tsx) — never fall through to index.js. */
async function expandTypesCandidate(
  base: string,
  root: string,
): Promise<string | null> {
  const normalized = normalizePath(base)
  const lower = normalized.toLowerCase()
  if (
    (lower.endsWith('.d.ts') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx')) &&
    (await fileExists(normalized, root))
  ) {
    return normalized
  }
  for (const ext of ['.d.ts', '.ts', '.tsx']) {
    if (lower.endsWith(ext)) continue
    const p = `${normalized}${ext}`
    if (await fileExists(p, root)) return p
  }
  for (const name of ['index.d.ts', 'index.ts', 'index.tsx']) {
    const p = `${normalized}/${name}`
    if (await fileExists(p, root)) return p
  }
  return null
}

async function resolveNodeModuleLocally(
  projectRoot: string,
  spec: string,
  readRoot: string,
): Promise<string | null> {
  const root = normalizePath(projectRoot)
  let pkgName: string
  let subpath: string | null = null
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    if (parts.length < 2) return null
    pkgName = `${parts[0]}/${parts[1]}`
    subpath = parts.length > 2 ? parts.slice(2).join('/') : null
  } else {
    const i = spec.indexOf('/')
    if (i >= 0) {
      pkgName = spec.slice(0, i)
      subpath = spec.slice(i + 1)
    } else {
      pkgName = spec
    }
  }

  const nm = `${root}/node_modules/${pkgName}`
  const typeName = pkgName.startsWith('@')
    ? `@types/${pkgName.slice(1).replace('/', '__')}`
    : `@types/${pkgName}`
  const at = `${root}/node_modules/${typeName}`

  const tryPkgTypes = async (dir: string): Promise<string | null> => {
    if (subpath) {
      const hit = await expandTypesCandidate(`${dir}/${subpath}`, readRoot)
      if (hit) return hit
    }
    try {
      const pkgText = (await readTextFile(`${dir}/package.json`, readRoot))
        .content
      const pkg = JSON.parse(pkgText) as {
        types?: string
        typings?: string
        exports?: {
          '.'?: string | { types?: string; import?: { types?: string } }
        }
      }
      const entry =
        pkg.types ||
        pkg.typings ||
        (typeof pkg.exports?.['.'] === 'string'
          ? undefined
          : pkg.exports?.['.']?.types || pkg.exports?.['.']?.import?.types)
      if (entry) {
        const hit = await expandTypesCandidate(`${dir}/${entry}`, readRoot)
        if (hit) return hit
      }
    } catch {
      /* ignore */
    }
    return expandTypesCandidate(dir, readRoot)
  }

  // Prefer DefinitelyTyped (@types/*) over package index.js (e.g. react).
  const fromAt = await tryPkgTypes(at)
  if (fromAt) return fromAt
  const fromNm = await tryPkgTypes(nm)
  if (fromNm) return fromNm

  // Last resort: JS entry (navigation only; Monaco may still lack types).
  if (subpath) {
    const hit = await expandLocalCandidate(`${nm}/${subpath}`, readRoot)
    if (hit) return hit
  }
  return expandLocalCandidate(nm, readRoot)
}

export async function resolveImportPath(
  projectRoot: string,
  fromFile: string,
  specifier: string,
  aliases: PathAlias[],
  readRoot?: string,
): Promise<string | null> {
  try {
    const hit = await invoke<string | null>('resolve_import', {
      projectRoot,
      fromFile,
      specifier,
      aliases,
    })
    if (hit) return hit
  } catch {
    /* fall through to local */
  }
  return resolveImportLocally(
    projectRoot,
    fromFile,
    specifier,
    aliases,
    readRoot ?? projectRoot,
  )
}
