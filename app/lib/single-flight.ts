export class SingleFlight<T> {
  private current: Promise<T> | null = null;

  run(task: () => Promise<T>): Promise<T> {
    if (this.current) return this.current;

    const next = task().finally(() => {
      if (this.current === next) this.current = null;
    });
    this.current = next;
    return next;
  }
}
