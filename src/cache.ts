import { window } from "vscode";

import { GemVersionsOutput } from "./ruby_gems_code_lens_provider";

class Cache {
  private cache: Map<string, GemVersionsOutput>;

  constructor() {
    this.cache = new Map();
  }

  // Set a value in the cache
  set(key: string, value: GemVersionsOutput): void {
    this.cache.set(key, value);
  }

  // Get a value from the cache
  get(key: string): GemVersionsOutput | undefined {
    return this.cache.get(key);
  }

  getCurrent(): GemVersionsOutput | undefined {
    const currentDocument = window.activeTextEditor?.document;
    if (currentDocument) {
      return this.cache.get(currentDocument.uri.fsPath);
    }
    return undefined;
  }

  // Check if a key exists in the cache
  has(key: string): boolean {
    return this.cache.has(key);
  }

  // Clear the cache
  clear(): void {
    this.cache.clear();
  }
}

export default Cache;
