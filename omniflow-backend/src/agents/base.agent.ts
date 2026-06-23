import type { AgentState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Base Agent — every concrete agent extends this class and implements process().
//
// Design decisions:
//   • Abstract so it cannot be instantiated directly.
//   • Services are injected via the constructor to keep agents decoupled from
//     any global singletons (testability, flexibility).
//   • process() returns a new AgentState so callers can compose agents in a
//     pipeline without mutating the original.
// ─────────────────────────────────────────────────────────────────────────────

export abstract class Agent {
  /** Human-readable agent name — used in log output */
  protected readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Execute this agent's logic against the current pipeline state.
   *
   * @param state  - Immutable snapshot of the current pipeline context.
   * @returns      A (possibly enriched) copy of the state.
   */
  abstract process(state: AgentState): Promise<AgentState>;

  // ── Logging helpers ──────────────────────────────────────────────────────

  protected log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }

  protected warn(message: string): void {
    console.warn(`[${this.name}] ${message}`);
  }

  protected error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : String(err ?? '');
    console.error(`[${this.name}] ${message}${detail ? ': ' + detail : ''}`);
  }
}
