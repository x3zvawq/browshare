export function formatStorageBytes(bytes: number, locale: string): string {
  const index = Math.min(4, Math.max(0, Math.floor(Math.log2(Math.max(1, bytes)) / 10)))
  const unit = ['B', 'KiB', 'MiB', 'GiB', 'TiB'][index]
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / 1024 ** index)} ${unit}`
}
