import type * as monaco from 'monaco-editor'
import { invoke } from '@tauri-apps/api/core'
import { languageFromPath } from './editorLanguage'
import { readTextFile } from './editorFs'
import {
  loadProjectAliases,
  resolveImportPath,
  type PathAlias,
} from './pathAliases'
import { normalizePath } from './workspacePath'

type OpenFileHandler = (absPath: string) => void

type NavContext = {
  projectRoot: string
  /**
   * Containment root for import-target disk reads. Import resolution may
   * legitimately land OUTSIDE the project root (monorepo sibling packages,
   * pnpm-hoisted node_modules) — the read gate must use the containing
   * workspace instead of the project (C1/C2 gate without breaking monorepos).
   */
  readRoot: string
  aliases: PathAlias[]
  onOpenFile: OpenFileHandler
}

type DirEntry = { name: string; path: string; isDir: boolean }

let ctx: NavContext | null = null
let providersReady = false
let openerReady = false
let aliasCacheKey: string | null = null
let aliasCache: PathAlias[] = []
let aliasLoading: Promise<PathAlias[]> | null = null

const loadedModels = new Set<string>()
const loadedExtraLibs = new Set<string>()
const extraLibDisposables = new Map<string, { dispose: () => void }>()

/**
 * Explicit Monaco `paths` for bare packages (react, lodash, …).
 *
 * IMPORTANT: values use virtual `file:///fpm-types/...` URIs, NOT Windows
 * `D:/...` + relative `node_modules/...`. Monaco's TS worker looks up scripts
 * by URI/fileName; disk path mapping silently fails → persistent 2307.
 */
let bareModulePaths: Record<string, string[]> = {}
let barePathsProjectKey: string | null = null

/** Virtual URI root — avoids Windows drive-letter normalization of `/...` paths. */
const FPM_TYPES_ROOT = 'file:///fpm-types'

function resetBareModulePaths(projectRoot: string) {
  const key = normalizePath(projectRoot).toLowerCase()
  if (barePathsProjectKey !== key) {
    barePathsProjectKey = key
    bareModulePaths = {}
  }
}

function isBareSpecifier(spec: string): boolean {
  return (
    Boolean(spec) &&
    !spec.startsWith('.') &&
    !spec.startsWith('/') &&
    !/^(data:|https?:|node:)/.test(spec)
  )
}

function virtualPackageDir(moduleName: string): string {
  return `${FPM_TYPES_ROOT}/${moduleName}`
}

function publishExtraLib(
  monacoApi: typeof monaco,
  content: string,
  fileName: string,
) {
  const prev = extraLibDisposables.get(fileName)
  prev?.dispose()
  const d1 = monacoApi.languages.typescript.typescriptDefaults.addExtraLib(
    content,
    fileName,
  )
  const d2 = monacoApi.languages.typescript.javascriptDefaults.addExtraLib(
    content,
    fileName,
  )
  extraLibDisposables.set(fileName, {
    dispose: () => {
      d1.dispose()
      d2.dispose()
    },
  })
  loadedExtraLibs.add(fileName)
}

/**
 * Publish package typings under `/fpm-types/<pkg>/…` and map the bare specifier
 * there via compiler `paths`. This is the reliable Monaco fix for 2307.
 */
async function registerBarePackageInMonaco(
  monacoApi: typeof monaco,
  projectRoot: string,
  moduleName: string,
  absFile: string,
  readRoot?: string,
): Promise<string | null> {
  resetBareModulePaths(projectRoot)
  const readFrom = readRoot ?? projectRoot

  let typesAbs = normalizePath(absFile)
  // If resolver returned JS (react/index.js), force @types when present.
  if (!/\.d\.ts$/i.test(typesAbs) && !/\.tsx?$/i.test(typesAbs)) {
    const root = normalizePath(projectRoot)
    const typePkg = moduleName.startsWith('@')
      ? `@types/${moduleName.slice(1).replace('/', '__')}`
      : `@types/${moduleName}`
    for (const candidate of [
      `${root}/node_modules/${typePkg}/index.d.ts`,
      `${root}/node_modules/${moduleName}/index.d.ts`,
    ]) {
      try {
        await readTextFile(candidate, readFrom)
        typesAbs = candidate
        break
      } catch {
        /* try next */
      }
    }
  }

  const model = await ensureFileModel(monacoApi, typesAbs, readFrom)
  if (!model) return null

  const content = model.getValue()
  const vdir = virtualPackageDir(moduleName)
  const entryFile = typesAbs.split('/').pop() || 'index.d.ts'
  const virtualEntry = `${vdir}/${entryFile}`

  publishExtraLib(monacoApi, content, virtualEntry)
  if (entryFile !== 'index.d.ts' && /\.d\.ts$/i.test(entryFile)) {
    publishExtraLib(monacoApi, content, `${vdir}/index.d.ts`)
  }

  // Virtual file:// URI matches extraLib fileName exactly (baseUrl ignored).
  bareModulePaths[moduleName] = [virtualEntry]
  bareModulePaths[`${moduleName}/*`] = [`${vdir}/*`]

  await loadSiblingDtsIntoVirtual(monacoApi, typesAbs, vdir, readFrom)

  const dir = typesAbs.replace(/\/[^/]+$/, '')
  try {
    const pkg = await readTextFile(`${dir}/package.json`, readFrom)
    publishExtraLib(
      monacoApi,
      normalizeEol(pkg.content),
      `${vdir}/package.json`,
    )
  } catch {
    /* optional */
  }
  return typesAbs
}

export async function ensureProjectAliases(
  projectRoot: string,
): Promise<PathAlias[]> {
  resetBareModulePaths(projectRoot)
  if (aliasCacheKey === projectRoot && aliasCache.length) return aliasCache
  if (aliasLoading && aliasCacheKey === projectRoot) return aliasLoading
  aliasCacheKey = projectRoot
  aliasLoading = loadProjectAliases(projectRoot).then((a) => {
    aliasCache = a
    aliasLoading = null
    return a
  })
  return aliasLoading
}

export function setMonacoNavContext(
  projectRoot: string,
  aliases: PathAlias[],
  onOpenFile: OpenFileHandler,
  readRoot?: string,
) {
  ctx = { projectRoot, readRoot: readRoot ?? projectRoot, aliases, onOpenFile }
}

export function clearMonacoNavContext() {
  ctx = null
}

/** Absolute path of a Monaco file model. */
export function modelAbsPath(model: monaco.editor.ITextModel): string {
  if (model.uri.scheme === 'file' && model.uri.fsPath) {
    return model.uri.fsPath
  }
  let p = model.uri.path
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1)
  // Malformed percent-encoding throws URIError — degrade to the raw path
  // instead of crashing the link provider (audit QO-6).
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

function normalizeEol(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Collect import/export/require module specifiers from source text. */
export function extractImportSpecifiers(source: string): string[] {
  const specs = new Set<string>()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/gm,
    /\/\/\/\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]\s*\/>/g,
    /\/\/\/\s*<reference\s+types\s*=\s*['"]([^'"]+)['"]\s*\/>/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(source))) {
      if (m[1]) specs.add(m[1])
    }
  }
  return [...specs]
}

/** Extract import specifier string under a cursor position, if any. */
export function importSpecifierAt(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): { specifier: string; range: monaco.IRange } | null {
  const line = model.getLineContent(position.lineNumber)
  const re = /['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const spec = m[1]
    const startCol = m.index + 2
    const endCol = startCol + spec.length
    if (position.column >= startCol && position.column <= endCol + 1) {
      const before = line.slice(0, m.index)
      if (
        /\b(from|import|require|export)\b/.test(before) ||
        /^\s*(import|export)\b/.test(line)
      ) {
        return {
          specifier: spec,
          range: {
            startLineNumber: position.lineNumber,
            startColumn: startCol,
            endLineNumber: position.lineNumber,
            endColumn: endCol,
          },
        }
      }
    }
  }
  return null
}

function collectImportLinks(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
): monaco.languages.ILink[] {
  const links: monaco.languages.ILink[] = []
  const lineCount = model.getLineCount()
  const from = modelAbsPath(model)
  for (let lineNo = 1; lineNo <= lineCount; lineNo++) {
    const line = model.getLineContent(lineNo)
    const localRe =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = localRe.exec(line))) {
      const spec = m[1]
      if (!spec || /^(data:|https?:|node:)/.test(spec)) continue
      const full = m[0]
      const q = full.includes("'") ? "'" : '"'
      const quoted = `${q}${spec}${q}`
      const qi = full.lastIndexOf(quoted)
      if (qi < 0) continue
      const startCol = m.index + qi + 2
      const endCol = startCol + spec.length
      links.push({
        range: new monacoApi.Range(lineNo, startCol, lineNo, endCol),
        url: `fpm-open:${encodeURIComponent(from)}::${encodeURIComponent(spec)}`,
        tooltip: `Open ${spec}`,
      })
    }
  }
  return links
}

/**
 * Map absolute alias replacements → tsconfig-style paths relative to project root.
 * Monaco's TS worker resolves modules via baseUrl + paths, then looks up models by URI.
 */
export function aliasesToCompilerPaths(
  projectRoot: string,
  aliases: PathAlias[],
): Record<string, string[]> {
  const root = normalizePath(projectRoot)
  const rootLower = root.toLowerCase()
  const paths: Record<string, string[]> = {}

  for (const a of aliases) {
    const repl = normalizePath(a.replacement)
    const replLower = repl.toLowerCase()
    let rel: string
    if (replLower === rootLower) rel = '.'
    else if (replLower.startsWith(`${rootLower}/`)) {
      rel = repl.slice(root.length + 1)
    } else {
      // Outside project — keep absolute (forward slashes)
      rel = repl
    }
    rel = rel.replace(/\/$/, '') || '.'

    const find = a.find
    if (find.endsWith('/')) {
      paths[`${find}*`] = [`${rel}/*`]
    } else if (find.endsWith('*')) {
      paths[find] = [`${rel}/*`]
    } else {
      paths[find] = [rel]
      paths[`${find}/*`] = [`${rel}/*`]
    }
  }
  return paths
}

/** Ensure a disk file is registered as a Monaco model so TS can resolve it. */
export async function ensureFileModel(
  monacoApi: typeof monaco,
  absPath: string,
  root: string,
): Promise<monaco.editor.ITextModel | null> {
  const key = normalizePath(absPath).toLowerCase()
  const uri = monacoApi.Uri.file(absPath)

  const existing = monacoApi.editor.getModel(uri)
  if (existing) {
    loadedModels.add(key)
    return existing
  }
  try {
    const res = await readTextFile(absPath, root)
    const content = normalizeEol(res.content)
    const lang = languageFromPath(absPath)
    const modelLang =
      lang === 'typescript' ||
      /\.tsx?$/i.test(absPath) ||
      /\.d\.ts$/i.test(absPath)
        ? 'typescript'
        : lang
    const model = monacoApi.editor.createModel(content, modelLang, uri)
    loadedModels.add(key)
    return model
  } catch {
    return null
  }
}

/**
 * Resolve imports in `source` (aliases / relative / packages) and load each
 * target into Monaco so the TS language service stops reporting 2307.
 * `readRoot` (containing workspace) widens the disk-read containment gate for
 * import targets that legitimately live outside the project (monorepos).
 */
export async function preloadImportsForFile(
  monacoApi: typeof monaco,
  projectRoot: string,
  fromFile: string,
  source: string,
  aliases: PathAlias[],
  depth = 0,
  seen: Set<string> = new Set(),
  readRoot?: string,
): Promise<void> {
  resetBareModulePaths(projectRoot)
  const readFrom = readRoot ?? projectRoot
  const specs = extractImportSpecifiers(source)
  const inNodeModules = /[/\\]node_modules[/\\]/.test(fromFile)
  const maxDepth = inNodeModules ? 2 : 1

  const tasks = specs.map(async (spec) => {
    if (/^(data:|https?:|node:)/.test(spec)) return

    // `/// <reference path="global.d.ts" />` → treat as relative
    const lookup =
      !spec.startsWith('.') &&
      !spec.startsWith('/') &&
      !spec.startsWith('@') &&
      /\.(d\.)?[cm]?[tj]sx?$/i.test(spec)
        ? `./${spec}`
        : spec

    const abs = await resolveImportPath(
      projectRoot,
      fromFile,
      lookup,
      aliases,
      readFrom,
    )
    if (!abs) return
    const key = normalizePath(abs).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    // Bare packages (react, …): virtual `/fpm-types` + paths mapping.
    let loadAbs = abs
    if (isBareSpecifier(lookup)) {
      const typesAbs = await registerBarePackageInMonaco(
        monacoApi,
        projectRoot,
        lookup,
        abs,
        readFrom,
      )
      if (typesAbs) loadAbs = typesAbs
    }

    const model = await ensureFileModel(monacoApi, loadAbs, readFrom)
    if (!model) return

    if (depth < maxDepth) {
      await preloadImportsForFile(
        monacoApi,
        projectRoot,
        loadAbs,
        model.getValue(),
        aliases,
        depth + 1,
        seen,
        readFrom,
      )
    }
  })
  await Promise.all(tasks)

  // Re-apply compiler options so the TS worker re-resolves with new paths/models.
  if (depth === 0) {
    applyAliasCompilerPaths(monacoApi, projectRoot, aliases)
  }
}

/** Copy sibling .d.ts (+ package.json) into the virtual package folder. */
async function loadSiblingDtsIntoVirtual(
  monacoApi: typeof monaco,
  absFile: string,
  virtualDir: string,
  readRoot: string,
): Promise<void> {
  const norm = normalizePath(absFile)
  const dir = norm.replace(/\/[^/]+$/, '')
  try {
    const entries = await invoke<DirEntry[]>('list_directory_entries', {
      path: dir,
    })
    await Promise.all(
      entries
        .filter((e) => !e.isDir && /\.d\.ts$/i.test(e.name))
        .slice(0, 40)
        .map(async (e) => {
          const model = await ensureFileModel(monacoApi, e.path, readRoot)
          if (!model) return
          publishExtraLib(monacoApi, model.getValue(), `${virtualDir}/${e.name}`)
        }),
    )
  } catch {
    /* ignore */
  }
}

function compilerOptions(
  monacoApi: typeof monaco,
  projectRoot: string,
  paths: Record<string, string[]>,
) {
  const ts = monacoApi.languages.typescript
  const root = normalizePath(projectRoot)
  // Prefer NodeJs; some monaco builds expose Node10 as alias.
  const moduleResolution =
    ts.ModuleResolutionKind.NodeJs ??
    (ts.ModuleResolutionKind as unknown as { Node10?: number }).Node10 ??
    2
  return {
    target: ts.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution,
    module: ts.ModuleKind.ESNext,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    isolatedModules: false,
    allowUmdGlobalAccess: true,
    skipLibCheck: true,
    lib: ['esnext', 'dom'],
    // Aliases use project-relative paths against this baseUrl.
    // Bare packages use `file:///fpm-types/...` (absolute; baseUrl ignored).
    baseUrl: root,
    paths,
  }
}

/**
 * Wire Monaco navigation (Ctrl+click) and default compiler options.
 * Module resolution: setEagerModelSync so preloaded sibling files (e.g. ./AiTopBar.tsx)
 * are visible to the TS worker — otherwise 2307 persists even when the file exists.
 */
export function setupMonacoModuleNavigation(monacoApi: typeof monaco) {
  const ts = monacoApi.languages.typescript

  // Critical: without this, createModel() files that aren't open in an editor
  // are invisible to the TypeScript language service → false 2307 errors.
  ts.javascriptDefaults.setEagerModelSync(true)
  ts.typescriptDefaults.setEagerModelSync(true)

  ts.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [],
  })
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [],
  })

  const base = compilerOptions(monacoApi, '/', {})
  ts.javascriptDefaults.setCompilerOptions(base)
  ts.typescriptDefaults.setCompilerOptions(base)

  if (!openerReady) {
    openerReady = true
    monacoApi.editor.registerEditorOpener({
      openCodeEditor(_source, resource) {
        const c = ctx
        if (!c) return false
        let filePath =
          resource.scheme === 'file' ? resource.fsPath : resource.path
        if (!filePath) return false
        if (/^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1)
        c.onOpenFile(filePath)
        return true
      },
    })
  }

  if (providersReady) return
  providersReady = true

  const languages = ['typescript', 'javascript'] as const

  for (const lang of languages) {
    monacoApi.languages.registerDefinitionProvider(lang, {
      provideDefinition(model, position) {
        const hit = importSpecifierAt(model, position)
        if (!hit || !ctx) return null
        const c = ctx
        const from = modelAbsPath(model)
        return resolveImportPath(
          c.projectRoot,
          from,
          hit.specifier,
          c.aliases,
          c.readRoot,
        ).then(async (abs) => {
          if (!abs) return null
          await ensureFileModel(monacoApi, abs, c.readRoot)
          return {
            uri: monacoApi.Uri.file(abs),
            range: new monacoApi.Range(1, 1, 1, 1),
          }
        })
      },
    })

    monacoApi.languages.registerLinkProvider(lang, {
      provideLinks(model) {
        return { links: collectImportLinks(monacoApi, model) }
      },
      async resolveLink(link) {
        const c = ctx
        if (!c || !link.url) return link
        const url = String(link.url)
        if (!url.startsWith('fpm-open:')) return link
        const payload = url.slice('fpm-open:'.length)
        const [fromEnc, specEnc] = payload.split('::')
        if (!fromEnc || !specEnc) return link
        const from = decodeURIComponent(fromEnc)
        const spec = decodeURIComponent(specEnc)
        const abs = await resolveImportPath(
          c.projectRoot,
          from,
          spec,
          c.aliases,
          c.readRoot,
        )
        if (abs) {
          await ensureFileModel(monacoApi, abs, c.readRoot)
          c.onOpenFile(abs)
        }
        return link
      },
    })
  }
}

/** Ctrl/Cmd+click on an import string → resolve & open. */
export function attachImportClickHandler(
  monacoApi: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
) {
  return editor.onMouseDown((e) => {
    if (!e.event.ctrlKey && !e.event.metaKey) return
    if (!e.target.position || !ctx) return
    const model = editor.getModel()
    if (!model) return
    const hit = importSpecifierAt(model, e.target.position)
    if (!hit) return
    e.event.preventDefault()
    e.event.stopPropagation()
    const from = modelAbsPath(model)
    void resolveImportPath(
      ctx.projectRoot,
      from,
      hit.specifier,
      ctx.aliases,
      ctx.readRoot,
    ).then(async (abs) => {
      if (!abs || !ctx) return
      await ensureFileModel(monacoApi, abs, ctx.readRoot)
      ctx.onOpenFile(abs)
    })
  })
}

/** Apply project path aliases + discovered bare package typings to Monaco. */
export function applyAliasCompilerPaths(
  monacoApi: typeof monaco,
  projectRoot: string,
  aliases: PathAlias[],
) {
  resetBareModulePaths(projectRoot)
  const paths = {
    ...aliasesToCompilerPaths(projectRoot, aliases),
    ...bareModulePaths,
  }
  const opts = compilerOptions(monacoApi, projectRoot, paths)
  monacoApi.languages.typescript.javascriptDefaults.setCompilerOptions(opts)
  monacoApi.languages.typescript.typescriptDefaults.setCompilerOptions(opts)
}
