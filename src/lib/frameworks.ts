export const FRAMEWORK_META: Record<
  string,
  { label: string; color: string }
> = {
  react: { label: 'React', color: '#61dafb' },
  vue: { label: 'Vue', color: '#42b883' },
  next: { label: 'Next', color: '#e0f7fa' },
  nuxt: { label: 'Nuxt', color: '#00dc82' },
  angular: { label: 'Angular', color: '#dd0031' },
  svelte: { label: 'Svelte', color: '#ff3e00' },
  solid: { label: 'Solid', color: '#2c4f7c' },
}

export function frameworkLabel(id: string): string {
  return FRAMEWORK_META[id]?.label ?? id
}

export function frameworkColor(id: string): string | undefined {
  return FRAMEWORK_META[id]?.color
}
