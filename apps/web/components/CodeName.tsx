"use client";

import { createContext, type ReactNode, useContext } from "react";

const CodeNameContext = createContext<string | null>(null);

/**
 * The dev-only code name line (« code name: yomizaka », lib/code-name.ts), decided once by the root layout (a server component: the
 * environment is a server setting) and read by the bar's lockup. `null` in production. One provider, never an `if` per page.
 */
export function CodeNameProvider({ line, children }: Readonly<{ line: string | null; children: ReactNode }>) {
  return <CodeNameContext.Provider value={line}>{children}</CodeNameContext.Provider>;
}

export const useCodeName = (): string | null => useContext(CodeNameContext);
