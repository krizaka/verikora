import "./styles.css";
// After the tokens: the plain product faces (the sans for headings, a system mono) come from blocks.css under
// data-surface="product", at the same specificity as the tokens' :root, so the later sheet wins (verikora#316).
import "@krizaka/ui/blocks.css";

import { KrizakaQueryProvider, useQueryClient } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";
import { type ReactNode, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { session } from "./lib/config";

/** One account's data never shows to the next: a session that starts or ends (sign-out, sign-in, a 401) empties the cache. */
function SessionBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      session.onChange(() => {
        void queryClient.cancelQueries();
        queryClient.clear();
      }),
    [queryClient],
  );
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultMode="system">
      <KrizakaQueryProvider throwOnError={false}>
        <SessionBoundary>
          <App />
        </SessionBoundary>
      </KrizakaQueryProvider>
    </ThemeProvider>
  </StrictMode>,
);
