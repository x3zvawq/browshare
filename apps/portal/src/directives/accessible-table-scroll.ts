import type { ObjectDirective } from 'vue'

// Naive UI owns the scroll container; focus must reach it to enable native keyboard scrolling.
function configure(root: HTMLElement, label: string): void {
  const region = root.querySelector<HTMLElement>('.n-scrollbar-container')
  if (!region) return
  region.setAttribute('role', 'region')
  region.tabIndex = 0
  region.setAttribute('aria-label', label)
}

export const vAccessibleTableScroll: ObjectDirective<HTMLElement, string> = {
  mounted: (root, binding) => configure(root, binding.value),
  updated: (root, binding) => configure(root, binding.value),
}
