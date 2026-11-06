import { Badge } from "@krizaka/ui/badge";
import { Card } from "@krizaka/ui/card";
import type { ClosingNote as Note } from "@verikora/core";

/** The plain-language closing note, as the server wrote it: the web, the phone and the signed report say the same. */
export function ClosingNote({ note }: Readonly<{ note: Note }>) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{note.title}</h2>
      <Section heading={note.result.heading} text={note.result.text} />
      <Card.Root className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold">{note.next.heading}</h3>
        {note.next.none ? <p>{note.next.none}</p> : null}
        {note.next.items.map((item) => (
          <div key={`${item.problem}-${item.advice}`} className="flex flex-col gap-1">
            {item.important ? (
              <Badge tone="warning">{item.problem}</Badge>
            ) : (
              <p className="font-medium">{item.problem}</p>
            )}
            <p className="text-fg-secondary">{item.advice}</p>
          </div>
        ))}
      </Card.Root>
      <Section heading={note.what.heading} text={note.what.text} />
      <Card.Root className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-semibold">{note.how.heading}</h3>
        {note.how.sentences.map((sentence) => (
          <p key={sentence} className="text-fg-secondary">
            {sentence}
          </p>
        ))}
      </Card.Root>
      <Card.Root className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-semibold">{note.notChecked.heading}</h3>
        <ul className="list-disc pl-5 text-fg-secondary">
          {note.notChecked.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card.Root>
      <Section heading={note.decides.heading} text={note.decides.text} />
      {note.reviewPending ? <p className="text-sm text-warning">{note.reviewPending}</p> : null}
      <p className="text-xs text-fg-muted">{note.disclaimer}</p>
    </div>
  );
}

function Section({ heading, text }: Readonly<{ heading: string; text: string }>) {
  return (
    <Card.Root className="flex flex-col gap-2 p-4">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <p>{text}</p>
    </Card.Root>
  );
}
