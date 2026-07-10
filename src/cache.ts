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

  // Remove a single entry from the cache
  delete(key: string): void {
    this.cache.delete(key);
  }

  // Clear the cache
  clear(): void {
    this.cache.clear();
  }
}

export default Cache;
