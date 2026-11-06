import { Badge, Card, Txt } from "@krizaka/ui/native";
import type { ClosingNote as Note } from "@verikora/core";
import * as React from "react";
import { View } from "react-native";

/** The plain-language closing note, as the server wrote it (the web and the signed report say the same): sections, one under the other. */
export function ClosingNote({ note }: Readonly<{ note: Note }>) {
  return (
    <View style={{ gap: 12 }}>
      <Txt variant="title">{note.title}</Txt>
      <Section heading={note.result.heading} text={note.result.text} />
      <Card.Root>
        <Card.Body>
          <Txt variant="label">{note.next.heading}</Txt>
          {note.next.none ? <Txt>{note.next.none}</Txt> : null}
          {note.next.items.map((item) => (
            <View key={`${item.problem}-${item.advice}`} style={{ gap: 4 }}>
              {item.important ? (
                <Badge tone="warning">{item.problem}</Badge>
              ) : (
                <Txt variant="label">{item.problem}</Txt>
              )}
              <Txt tone="secondary">{item.advice}</Txt>
            </View>
          ))}
        </Card.Body>
      </Card.Root>
      <Section heading={note.what.heading} text={note.what.text} />
      <Card.Root>
        <Card.Body>
          <Txt variant="label">{note.how.heading}</Txt>
          {note.how.sentences.map((sentence) => (
            <Txt key={sentence} tone="secondary">
              {sentence}
            </Txt>
          ))}
        </Card.Body>
      </Card.Root>
      <Card.Root>
        <Card.Body>
          <Txt variant="label">{note.notChecked.heading}</Txt>
          {note.notChecked.items.map((item) => (
            <Txt key={item} tone="secondary">{`• ${item}`}</Txt>
          ))}
        </Card.Body>
      </Card.Root>
      <Section heading={note.decides.heading} text={note.decides.text} />
      {note.reviewPending ? <Txt tone="warning">{note.reviewPending}</Txt> : null}
      <Txt tone="muted" variant="caption">
        {note.disclaimer}
      </Txt>
    </View>
  );
}

function Section({ heading, text }: Readonly<{ heading: string; text: string }>) {
  return (
    <Card.Root>
      <Card.Body>
        <Txt variant="label">{heading}</Txt>
        <Txt>{text}</Txt>
      </Card.Body>
    </Card.Root>
  );
}
