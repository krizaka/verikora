/**
 * The window of a feature card (verikora#478): the app's own component, drawn with demo data at 70 % in a fixed box (no layout
 * shift), inert and hidden from assistive technology — the card's sentence and `summary` are its text alternative. A page-local
 * wrapper until krizaka-ui ships a block for it (see krizaka-ui "ScreenCard" request).
 */
export function LiveScreen({ children, testId }: Readonly<{ children: React.ReactNode; testId: string }>) {
  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none relative h-72 select-none overflow-hidden rounded-lg border border-border-default bg-surface-0"
      data-testid={testId}
    >
      <div className="w-[143%] origin-top-left scale-[0.7]">{children}</div>
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-0 to-transparent" />
    </div>
  );
}
