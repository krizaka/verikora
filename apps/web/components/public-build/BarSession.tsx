import type { ReactNode } from "react";

/**
 * The public export's `components/BarSession` (aliased by next.config.public.mjs): the site has no accounts there, so the bar has
 * no session island — no « Sign in », no call to the API, no query client. The same two names the pages import.
 */
export const BarQueryRoot = ({ children }: Readonly<{ children: ReactNode }>) => <>{children}</>;

export const BarActions = (): null => null;
