export class TimeoutError extends Error {}

/** fetch with a hard timeout, so a slow network never hangs a request. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 25_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new TimeoutError(`No response from ${new URL(url).host} after ${ms / 1000}s`);
    }
    const cause = err.cause ? ` (${err.cause.code ?? err.cause.message})` : "";
    throw new Error(`${err.message}${cause}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
