/** Map a file path to a Monaco language id. */
export function languageFromPath(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() ?? filePath
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''

  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  if (lower === 'cmakelists.txt') return 'cmake'

  switch (ext) {
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'javascript'
    case 'jsx':
      return 'javascript'
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'typescript'
    case 'css':
      return 'css'
    case 'scss':
      return 'scss'
    case 'less':
      return 'less'
    case 'html':
    case 'htm':
    case 'xhtml':
      return 'html'
    case 'json':
    case 'jsonc':
      return 'json'
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'markdown'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'toml':
      return 'ini'
    case 'ini':
    case 'cfg':
    case 'conf':
      return 'ini'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'ps1':
    case 'psm1':
      return 'powershell'
    case 'py':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    case 'java':
      return 'java'
    case 'kt':
      return 'kotlin'
    case 'sql':
      return 'sql'
    case 'graphql':
    case 'gql':
      return 'graphql'
    case 'vue':
      return 'html'
    case 'svelte':
      return 'html'
    case 'env':
      return 'ini'
    default:
      if (lower.startsWith('.env')) return 'ini'
      return 'plaintext'
  }
}
