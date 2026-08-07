import { CodeFile, Database, Document, Image, Lock, MusicNote, Package, Setting, Shield, Video, Zip } from 'reicon-react'
import type { ComponentType } from 'react'

type IconProps = {
  size?: number
  color?: string
  className?: string
  weight?: 'Outline' | 'Filled'
  'aria-hidden'?: boolean
}

type IconDef = {
  Icon: ComponentType<IconProps>
  color: string
}

/* ── Extension → icon + brand color ── */
const EXT_MAP: Record<string, IconDef> = {
  // JavaScript
  js: { Icon: CodeFile, color: '#f7df1e' },
  jsx: { Icon: CodeFile, color: '#f7df1e' },
  mjs: { Icon: CodeFile, color: '#f7df1e' },
  cjs: { Icon: CodeFile, color: '#f7df1e' },
  // TypeScript
  ts: { Icon: CodeFile, color: '#3178c6' },
  tsx: { Icon: CodeFile, color: '#3178c6' },
  // JSON
  json: { Icon: CodeFile, color: '#cbcb41' },
  jsonc: { Icon: CodeFile, color: '#cbcb41' },
  // HTML
  html: { Icon: CodeFile, color: '#e44d26' },
  htm: { Icon: CodeFile, color: '#e44d26' },
  // CSS / preprocessors
  css: { Icon: CodeFile, color: '#1572b6' },
  scss: { Icon: CodeFile, color: '#cc6699' },
  sass: { Icon: CodeFile, color: '#cc6699' },
  less: { Icon: CodeFile, color: '#2d4d73' },
  // Frameworks
  vue: { Icon: CodeFile, color: '#42b883' },
  svelte: { Icon: CodeFile, color: '#ff3e00' },
  astro: { Icon: CodeFile, color: '#ff5d01' },
  // Markdown
  md: { Icon: Document, color: '#519aba' },
  markdown: { Icon: Document, color: '#519aba' },
  mdx: { Icon: Document, color: '#519aba' },
  // Backend languages
  py: { Icon: CodeFile, color: '#3776ab' },
  rs: { Icon: CodeFile, color: '#ce422b' },
  go: { Icon: CodeFile, color: '#00add8' },
  java: { Icon: CodeFile, color: '#ed8b00' },
  kt: { Icon: CodeFile, color: '#7f52ff' },
  kts: { Icon: CodeFile, color: '#7f52ff' },
  swift: { Icon: CodeFile, color: '#f05138' },
  c: { Icon: CodeFile, color: '#a8b9cc' },
  h: { Icon: CodeFile, color: '#a8b9cc' },
  cpp: { Icon: CodeFile, color: '#00599c' },
  cc: { Icon: CodeFile, color: '#00599c' },
  cxx: { Icon: CodeFile, color: '#00599c' },
  hpp: { Icon: CodeFile, color: '#00599c' },
  cs: { Icon: CodeFile, color: '#178600' },
  rb: { Icon: CodeFile, color: '#cc342d' },
  php: { Icon: CodeFile, color: '#777bb4' },
  // Shell
  sh: { Icon: CodeFile, color: '#89e051' },
  bash: { Icon: CodeFile, color: '#89e051' },
  zsh: { Icon: CodeFile, color: '#89e051' },
  fish: { Icon: CodeFile, color: '#89e051' },
  ps1: { Icon: CodeFile, color: '#012456' },
  psm1: { Icon: CodeFile, color: '#012456' },
  bat: { Icon: CodeFile, color: '#c0c0c0' },
  cmd: { Icon: CodeFile, color: '#c0c0c0' },
  // Data / query
  sql: { Icon: Database, color: '#e38c00' },
  db: { Icon: Database, color: '#e38c00' },
  sqlite: { Icon: Database, color: '#e38c00' },
  graphql: { Icon: CodeFile, color: '#e535ab' },
  gql: { Icon: CodeFile, color: '#e535ab' },
  proto: { Icon: CodeFile, color: '#4285f4' },
  // Config
  yaml: { Icon: Setting, color: '#cb171e' },
  yml: { Icon: Setting, color: '#cb171e' },
  toml: { Icon: Setting, color: '#9c4221' },
  ini: { Icon: Setting, color: '#6e7c91' },
  cfg: { Icon: Setting, color: '#6e7c91' },
  conf: { Icon: Setting, color: '#6e7c91' },
  env: { Icon: Lock, color: '#ecd53f' },
  // XML / SVG
  xml: { Icon: CodeFile, color: '#e37933' },
  svg: { Icon: Image, color: '#ffb13b' },
  // Images
  png: { Icon: Image, color: '#a074c4' },
  jpg: { Icon: Image, color: '#a074c4' },
  jpeg: { Icon: Image, color: '#a074c4' },
  gif: { Icon: Image, color: '#a074c4' },
  webp: { Icon: Image, color: '#a074c4' },
  bmp: { Icon: Image, color: '#a074c4' },
  ico: { Icon: Image, color: '#a074c4' },
  tiff: { Icon: Image, color: '#a074c4' },
  tif: { Icon: Image, color: '#a074c4' },
  // Fonts
  woff: { Icon: Document, color: '#d4a017' },
  woff2: { Icon: Document, color: '#d4a017' },
  ttf: { Icon: Document, color: '#d4a017' },
  otf: { Icon: Document, color: '#d4a017' },
  eot: { Icon: Document, color: '#d4a017' },
  // Audio
  mp3: { Icon: MusicNote, color: '#a074c4' },
  wav: { Icon: MusicNote, color: '#a074c4' },
  flac: { Icon: MusicNote, color: '#a074c4' },
  ogg: { Icon: MusicNote, color: '#a074c4' },
  m4a: { Icon: MusicNote, color: '#a074c4' },
  aac: { Icon: MusicNote, color: '#a074c4' },
  // Video
  mp4: { Icon: Video, color: '#a074c4' },
  avi: { Icon: Video, color: '#a074c4' },
  mov: { Icon: Video, color: '#a074c4' },
  mkv: { Icon: Video, color: '#a074c4' },
  webm: { Icon: Video, color: '#a074c4' },
  // Archives
  zip: { Icon: Zip, color: '#f7ca5e' },
  rar: { Icon: Zip, color: '#c2911a' },
  '7z': { Icon: Zip, color: '#f7ca5e' },
  tar: { Icon: Zip, color: '#f7ca5e' },
  gz: { Icon: Zip, color: '#f7ca5e' },
  bz2: { Icon: Zip, color: '#f7ca5e' },
  xz: { Icon: Zip, color: '#f7ca5e' },
  // Lock
  lock: { Icon: Lock, color: '#8b8b8b' },
  lockb: { Icon: Lock, color: '#8b8b8b' },
  // PDF
  pdf: { Icon: Document, color: '#e53935' },
}

/* ── Exact filename overrides ── */
const NAME_MAP: Record<string, IconDef> = {
  'package.json': { Icon: Package, color: '#cb3837' },
  'package-lock.json': { Icon: Lock, color: '#8b8b8b' },
  'pnpm-lock.yaml': { Icon: Lock, color: '#8b8b8b' },
  'yarn.lock': { Icon: Lock, color: '#8b8b8b' },
  'bun.lockb': { Icon: Lock, color: '#8b8b8b' },
  'tsconfig.json': { Icon: Setting, color: '#3178c6' },
  'jsconfig.json': { Icon: Setting, color: '#f7df1e' },
  '.gitignore': { Icon: Document, color: '#f1502f' },
  '.gitattributes': { Icon: Document, color: '#f1502f' },
  '.gitkeep': { Icon: Document, color: '#f1502f' },
  'dockerfile': { Icon: Package, color: '#2496ed' },
  'makefile': { Icon: Setting, color: '#5b6b5b' },
  'gnumakefile': { Icon: Setting, color: '#5b6b5b' },
  'cmakelists.txt': { Icon: Setting, color: '#064f8a' },
  'license': { Icon: Shield, color: '#9e9e9e' },
  'license.md': { Icon: Shield, color: '#9e9e9e' },
  'license.txt': { Icon: Shield, color: '#9e9e9e' },
  'readme.md': { Icon: Document, color: '#519aba' },
  'readme.txt': { Icon: Document, color: '#519aba' },
  '.npmrc': { Icon: Package, color: '#cb3837' },
  '.nvmrc': { Icon: Package, color: '#cb3837' },
  '.editorconfig': { Icon: Setting, color: '#6e7c91' },
  '.prettierrc': { Icon: Setting, color: '#c8a4d4' },
  '.eslintrc': { Icon: Setting, color: '#4b32c3' },
  '.eslintrc.json': { Icon: Setting, color: '#4b32c3' },
  '.eslintrc.js': { Icon: Setting, color: '#4b32c3' },
  '.eslintrc.cjs': { Icon: Setting, color: '#4b32c3' },
  '.prettierrc.json': { Icon: Setting, color: '#c8a4d4' },
  '.prettierrc.js': { Icon: Setting, color: '#c8a4d4' },
  '.prettierrc.cjs': { Icon: Setting, color: '#c8a4d4' },
  '.babelrc': { Icon: Setting, color: '#f5da55' },
  'babel.config.json': { Icon: Setting, color: '#f5da55' },
  'babel.config.js': { Icon: Setting, color: '#f5da55' },
  'postcss.config.js': { Icon: Setting, color: '#dc3a0e' },
  'postcss.config.cjs': { Icon: Setting, color: '#dc3a0e' },
  'tailwind.config.js': { Icon: Setting, color: '#06b6d4' },
  'tailwind.config.ts': { Icon: Setting, color: '#06b6d4' },
  'tailwind.config.cjs': { Icon: Setting, color: '#06b6d4' },
  'vite.config.js': { Icon: Setting, color: '#646cff' },
  'vite.config.ts': { Icon: Setting, color: '#646cff' },
  'vite.config.mts': { Icon: Setting, color: '#646cff' },
  'webpack.config.js': { Icon: Setting, color: '#1c78c0' },
  'webpack.config.cjs': { Icon: Setting, color: '#1c78c0' },
  'rollup.config.js': { Icon: Setting, color: '#c33a30' },
  'rollup.config.mjs': { Icon: Setting, color: '#c33a30' },
  'next.config.js': { Icon: Setting, color: '#000000' },
  'next.config.mjs': { Icon: Setting, color: '#000000' },
  'nuxt.config.ts': { Icon: Setting, color: '#00dc82' },
  'nuxt.config.js': { Icon: Setting, color: '#00dc82' },
  'svelte.config.js': { Icon: Setting, color: '#ff3e00' },
  'astro.config.mjs': { Icon: Setting, color: '#ff5d01' },
  '.env': { Icon: Lock, color: '#ecd53f' },
  '.env.local': { Icon: Lock, color: '#ecd53f' },
  '.env.example': { Icon: Lock, color: '#ecd53f' },
  '.env.development': { Icon: Lock, color: '#ecd53f' },
  '.env.production': { Icon: Lock, color: '#ecd53f' },
}

/* ── Pattern-based overrides (checked after exact match) ── */
const NAME_PATTERNS: { test: RegExp; def: IconDef }[] = [
  { test: /^dockerfile/i, def: { Icon: Package, color: '#2496ed' } },
  { test: /^docker-compose/, def: { Icon: Package, color: '#2496ed' } },
  { test: /^\.env\./i, def: { Icon: Lock, color: '#ecd53f' } },
  { test: /^\.eslintignore/i, def: { Icon: Document, color: '#4b32c3' } },
  { test: /^\.prettierignore/i, def: { Icon: Document, color: '#c8a4d4' } },
  { test: /^\.npmignore/i, def: { Icon: Document, color: '#cb3837' } },
  { test: /\.config\.(js|ts|mjs|cjs|mts)$/i, def: { Icon: Setting, color: '#6e7c91' } },
  { test: /\.rc$/i, def: { Icon: Setting, color: '#6e7c91' } },
  { test: /^README/i, def: { Icon: Document, color: '#519aba' } },
  { test: /^LICENSE/i, def: { Icon: Shield, color: '#9e9e9e' } },
  { test: /^CHANGELOG/i, def: { Icon: Document, color: '#519aba' } },
]

function lookupIcon(filename: string): IconDef | null {
  const name = filename.split(/[/\\]/).pop() ?? filename
  const lower = name.toLowerCase()

  // 1) Exact filename match
  const exact = NAME_MAP[lower]
  if (exact) return exact

  // 2) Pattern match
  for (const { test, def } of NAME_PATTERNS) {
    if (test.test(name)) return def
  }

  // 3) Extension match
  const dot = lower.lastIndexOf('.')
  if (dot >= 0) {
    const ext = lower.slice(dot + 1)
    const byExt = EXT_MAP[ext]
    if (byExt) return byExt
  }

  // 4) Dotfiles without extension (e.g. .eslintrc, .gitignore already matched above)
  if (lower.startsWith('.') && lower.length > 1) {
    const byName = EXT_MAP[lower.slice(1)]
    if (byName) return byName
  }

  return null
}

export function FileIcon({ filename, size = 14 }: { filename: string; size?: number }) {
  const def = lookupIcon(filename)
  if (!def) {
    return <Document size={size} color="currentColor" aria-hidden />
  }
  const { Icon, color } = def
  return <Icon size={size} color={color} aria-hidden />
}
