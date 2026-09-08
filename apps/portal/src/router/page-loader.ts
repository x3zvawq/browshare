export class PageResourceLoadError extends Error {
  constructor() {
    super('PAGE_RESOURCE_LOAD_FAILED')
    this.name = 'PageResourceLoadError'
  }
}

// Classify failures at the import boundary without exposing resource URLs or
// confusing them with authentication and business-request failures.
export function loadPage<T>(loader: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await loader()
    } catch {
      throw new PageResourceLoadError()
    }
  }
}
