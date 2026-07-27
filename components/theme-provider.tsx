"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Mounts next-themes so the dark palette in globals.css can actually apply.
 *
 * `attribute="class"` is what makes the stylesheet work: `.dark { ... }` holds
 * the whole dark token set and `@custom-variant dark (&:is(.dark *))` drives
 * every `dark:` utility, so both are dead until something puts that class on
 * <html>. Nothing did, which meant a user on a dark-mode OS got the light UI
 * and `useTheme()` in components/ui/sonner.tsx read from no provider at all.
 *
 * Defaults to following the OS (`enableSystem`, "system"); the account menu's
 * ThemeMenu overrides that with an explicit Light/Dark choice. The tldraw
 * canvas is not styled by these tokens, so Canvas.tsx mirrors `resolvedTheme`
 * into the editor's own colorScheme separately.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
