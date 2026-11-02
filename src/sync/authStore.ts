import { create } from "zustand";

/**
 * Reactive auth state for the sync layer. No persist middleware: Supabase owns
 * the session (via `persistSession`/`autoRefreshToken` in `supabase.ts`), so
 * duplicating it in `localStorage` here would only invite drift.
 *
 * `status` starts at `"resolving"` so the UI can render local content while the
 * stored session is being restored and never blocks the first paint
 * (Req 3.6, 1.6). After init, `onAuthStateChange` in `useAuth` is the single
 * writer of this state (Req 3.2–3.4).
 */
export type AuthStatus = "resolving" | "signed_out" | "signed_in";

export type AuthState = {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  /**
   * The single mutation the auth subscription uses to publish a resolved state.
   * Signing out clears `userId`/`email`; signing in sets them from the session.
   */
  setAuth: (next: {
    status: AuthStatus;
    userId: string | null;
    email: string | null;
  }) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "resolving",
  userId: null,
  email: null,
  setAuth: (next) => set(next),
}));
