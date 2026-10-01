/** Serialize mutations even after a rejected operation; keep readers coherent. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(operation)
    this.tail = next
    return next
  }
}
