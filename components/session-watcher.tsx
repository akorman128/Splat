"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mounting this is what instantiates the browser client on a protected page.
// Without it nothing exists to run the auto-refresh ticker until the user
// happens to click something, so an idle tab's token quietly expires.
//
// SIGNED_OUT covers an expired refresh token as well as an explicit sign-out.
// Refreshing rather than pushing keeps the server layout in charge of where an
// unauthenticated visitor lands. The other events need no reaction: the cookie
// writes that matter already happened inside the client.
export function SessionWatcher() {
  const router = useRouter();

  useEffect(() => {
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
