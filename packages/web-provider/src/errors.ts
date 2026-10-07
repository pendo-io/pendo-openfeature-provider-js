export type PendoErrorSource = "segmentflag" | "track" | "telemetry" | "sdk-ready";

/**
 * A runtime/environmental failure (network error, HTTP error, timeout).
 * Delivered to the `onError` handler, or written with console.error when no
 * handler is set.
 */
export class PendoRuntimeError extends Error {
  readonly name = "PendoRuntimeError";
  /** Which Pendo interaction failed. */
  readonly source: PendoErrorSource;
  /** HTTP status; undefined for network failure or timeout. */
  readonly status?: number;
  /** True for 5xx, 429, network failure, timeout. False for other 4xx. */
  readonly transient: boolean;
  /** The underlying error, if any. */
  readonly cause?: unknown;

  constructor(init: {
    message: string;
    source: PendoErrorSource;
    status?: number;
    transient: boolean;
    cause?: unknown;
  }) {
    super(init.message);
    Object.setPrototypeOf(this, PendoRuntimeError.prototype);
    this.source = init.source;
    this.status = init.status;
    this.transient = init.transient;
    this.cause = init.cause;
  }
}

export type PendoErrorHandler = (error: PendoRuntimeError) => void | Promise<void>;

/**
 * Deliver a runtime failure to `handler`, or `log` it when no handler is set.
 * Never throws or rejects: a handler that throws or rejects is console.error'd
 * along with the original error.
 */
export function reportRuntimeError(
  error: PendoRuntimeError,
  handler: PendoErrorHandler | undefined,
  prefix: string,
  log: (...args: unknown[]) => void = console.error
): void {
  if (!handler) {
    log(`${prefix} ${error.message}`, error.cause ?? "");
    return;
  }
  const handlerFailed = (handlerError: unknown) => {
    console.error(`${prefix} onError handler threw or rejected; fix the handler.`, handlerError);
    console.error(`${prefix} Original error: ${error.message}`, error.cause ?? "");
  };
  try {
    const result: unknown = handler(error);
    if (result && typeof (result as PromiseLike<void>).then === "function") {
      (result as PromiseLike<void>).then(undefined, handlerFailed);
    }
  } catch (handlerError) {
    handlerFailed(handlerError);
  }
}

/** Shared transient rule: 5xx, 429, or no status (network/timeout). */
export function isTransientStatus(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429;
}
