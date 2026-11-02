import { useEffect } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useUiStore } from "../store/uiStore";
import { supabase, isSyncConfigured } from "./supabase";
import { useAuthStore } from "./authStore";

/**
 * Wires the auth store to Supabase exactly once per app run. A module-level
 * guard (not a ref) makes the wiring idempotent even if `useAuth` is mounted in
 * more than one place or remounted: we only ever want one session restore and
 * one `onAuthStateChange` subscription for the life of the tab.
 */
let wired = false;

/**
 * Maps a Supabase session to signed-in auth state. `SIGNED_IN` and
 * `TOKEN_REFRESHED` both carry a live session, so both resolve to `signed_in`
 * through this single path (Req 3.2, 3.3).
 */
function signedIn(session: Session) {
  useAuthStore.getState().setAuth({
    status: "signed_in",
    userId: session.user.id,
    email: session.user.email ?? null,
  });
}

/** Resolves to the anonymous state, clearing any prior identity (Req 3.4). */
function signedOut() {
  useAuthStore.getState().setAuth({
    status: "signed_out",
    userId: null,
    email: null,
  });
}

/**
 * Starts auth resolution on first mount and exposes the reactive auth state.
 *
 * - Local_Only_Mode (`supabase === null`): immediately resolve to
 *   `signed_out` and never subscribe, so no network call can fire (Req 8.4).
 * - Otherwise restore a stored session with `getSession()` (Req 3.1), then
 *   subscribe to `onAuthStateChange` as the SINGLE WRITER of auth state after
 *   init. Session refresh (Req 3.2, 3.3) and sign-out (Req 3.4) all flow
 *   through that one handler, so there is no second place that sets
 *   `signed_in`/`signed_out`.
 */
export function useAuth(): {
  status: ReturnType<typeof useAuthStore.getState>["status"];
  userId: string | null;
  email: string | null;
} {
  useEffect(() => {
    if (wired) return;
    wired = true;

    if (!isSyncConfigured || supabase === null) {
      signedOut();
      return;
    }

    const client = supabase;

    // Subscribe first so no state transition between restore and subscribe is
    // lost; the subscription is the single writer after init.
    const { data: subscription } = client.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (
          (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
          session
        ) {
          signedIn(session);
          return;
        }
        if (event === "SIGNED_OUT") {
          signedOut();
          return;
        }
        // INITIAL_SESSION and others: resolve from whatever session is present.
        if (session) signedIn(session);
        else signedOut();
      }
    );

    // Restore a stored session on startup (Req 3.1). A failed restore (error or
    // no session) resolves to signed_out (Req 3.4, 3.5).
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error || !data.session) {
          signedOut();
          return;
        }
        signedIn(data.session);
      })
      .catch(() => signedOut());

    return () => {
      subscription.subscription.unsubscribe();
      wired = false;
    };
  }, []);

  const { status, userId, email } = useAuthStore();
  return { status, userId, email };
}

/**
 * Starts the Google OAuth redirect (Req 2.3). The only provider offered. On an
 * authorization error we stay signed out and surface the reason as a toast
 * (Req 2.9); a successful call navigates away, so there is no success branch to
 * handle here.
 */
export async function signInWithGoogle(): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) {
    useUiStore
      .getState()
      .pushToast({ message: `Sign-in failed: ${error.message}` });
  }
}

/**
 * Signs out via Supabase (Req 2.6). The resume store is never touched, so the
 * Local_Library survives sign-out intact (Req 2.7, 2.8); `onAuthStateChange`
 * publishes the resulting `SIGNED_OUT` transition as the single writer.
 */
export async function signOut(): Promise<void> {
  if (supabase === null) return;
  await supabase.auth.signOut();
}
