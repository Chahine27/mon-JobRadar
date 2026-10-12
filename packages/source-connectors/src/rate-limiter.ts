/**
 * Espace les appels d'une source : au plus 1 appel tous les `minDelayMs`.
 * Les valeurs viennent des règles documentées de chaque source (README §25).
 */
export class RateLimiter {
  private next = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly minDelayMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.next - this.now();
      if (wait > 0) await this.sleep(wait);
      this.next = this.now() + this.minDelayMs;
    });
    this.chain = run.catch(() => {});
    return run.then(fn);
  }
}
