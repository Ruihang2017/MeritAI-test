import { randomUUID } from "node:crypto";
import type { Confirm, ConfirmRequest } from "../engine/types";

/**
 * Confirmations waiting for the user's answer. A tool (or the app) awaits the UI's
 * answer; a UI must be able to withdraw the question when the user stops the reply,
 * closes the app or disconnects, and to re-show open questions after reconnecting.
 * A withdrawn question resolves to false (declined), whether or not the UI answers.
 */
export class PendingConfirms {
  private readonly open = new Map<string, { req: ConfirmRequest; abort: AbortController }>();

  /** Asks through the UI's confirm, tracked until it is answered or cancelled. */
  async ask(ui: Confirm, req: ConfirmRequest): Promise<boolean> {
    const id = randomUUID();
    const abort = new AbortController();
    this.open.set(id, { req, abort });
    const withdrawn = new Promise<boolean>((resolve) => abort.signal.addEventListener("abort", () => resolve(false), { once: true }));
    try {
      return await Promise.race([ui(req, { id, signal: abort.signal }), withdrawn]);
    } finally {
      this.open.delete(id);
    }
  }

  list(): { id: string; req: ConfirmRequest }[] {
    return [...this.open].map(([id, { req }]) => ({ id, req }));
  }

  /** Withdraws every open question (each resolves to false). Returns how many there were. */
  cancelAll(): number {
    const n = this.open.size;
    for (const { abort } of this.open.values()) abort.abort();
    this.open.clear();
    return n;
  }
}
