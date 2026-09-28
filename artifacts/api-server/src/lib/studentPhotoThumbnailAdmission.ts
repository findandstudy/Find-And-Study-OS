export class ThumbnailAdmissionError extends Error {
  constructor(readonly reason: "queue_full" | "queue_timeout" | "byte_budget") {
    super(`Thumbnail admission: ${reason}`);
    this.name = "ThumbnailAdmissionError";
  }
}

/** Thumbnail-only admission; queued jobs have not downloaded/decoded their source. */
export function createThumbnailAdmission(limits: {
  maxActive: number;
  maxQueued: number;
  maxReservedBytes: number;
  queueTimeoutMs: number;
}) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (name === "maxQueued" ? 0 : 1)) {
      throw new Error(`Invalid thumbnail admission limit: ${name}`);
    }
  }
  let active = 0;
  let reservedBytes = 0;
  type Waiter = { bytes: number; resolve: (release: () => void) => void; timer: ReturnType<typeof setTimeout> };
  const waiters: Waiter[] = [];
  const canStart = (bytes: number) => active < limits.maxActive && bytes <= limits.maxReservedBytes - reservedBytes;

  function reserve(bytes: number): () => void {
    active++;
    reservedBytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      reservedBytes -= bytes;
      drain();
    };
  }

  function drain(): void {
    while (waiters[0] && canStart(waiters[0].bytes)) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      // Reserve synchronously, before resolving, so new arrivals cannot steal a slot.
      waiter.resolve(reserve(waiter.bytes));
    }
  }

  async function acquire(bytes: number): Promise<() => void> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limits.maxReservedBytes) {
      throw new ThumbnailAdmissionError("byte_budget");
    }
    if (!waiters.length && canStart(bytes)) return reserve(bytes);
    if (waiters.length >= limits.maxQueued) throw new ThumbnailAdmissionError("queue_full");
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        bytes, resolve,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index < 0) return;
          waiters.splice(index, 1);
          reject(new ThumbnailAdmissionError("queue_timeout"));
          drain();
        }, limits.queueTimeoutMs),
      };
      waiters.push(waiter);
    });
  }

  return {
    async run<T>(bytes: number, operation: () => Promise<T>): Promise<T> {
      const release = await acquire(bytes);
      try {
        return await operation();
      } finally {
        // Do not race an uncancelled operation against a timeout and release early.
        release();
      }
    },
    snapshot: () => ({ active, queued: waiters.length, reservedBytes }),
  };
}
