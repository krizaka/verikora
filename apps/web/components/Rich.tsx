import { Rich as SharedRich, type RichProps } from "@krizaka/i18n/rich";

const bold = (children: React.ReactNode) => <strong className="font-semibold text-fg">{children}</strong>;

/** A message with `<b>…</b>` emphasis — the one implementation is @krizaka/i18n's; Verikora only gives it its classes. */
export function Rich(props: RichProps) {
  return <SharedRich renderBold={bold} {...props} />;
}
