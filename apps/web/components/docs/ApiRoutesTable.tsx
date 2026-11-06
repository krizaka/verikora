"use client";

import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { Ticks } from "@krizaka/ui/page";

import type { ApiOperation } from "@/lib/docs-api";

export interface ApiRoutesLabels {
  caption: string;
  route: string;
  scope: string;
  noScope: string;
  answers: string;
  parameters: string;
}

function RouteCell({ op, parametersLabel }: Readonly<{ op: ApiOperation; parametersLabel: string }>) {
  return (
    <span id={op.id} className="scroll-mt-(--kz-anchor-offset,6rem)" data-testid="api-operation">
      <code className="break-words">
        {op.method} {op.path}
      </code>
      <span className="mt-1 block text-fg-secondary">
        {op.summary} {op.description ? <Ticks>{op.description}</Ticks> : null}
      </span>
      {op.parameters.length ? (
        <span className="mt-1 block text-fg-muted">
          {parametersLabel}: <code>{op.parameters.join(", ")}</code>
        </span>
      ) : null}
    </span>
  );
}

function AnswersCell({ op, shared }: Readonly<{ op: ApiOperation; shared: readonly string[] }>) {
  return (
    <span className="flex flex-col gap-1">
      {op.answers.map((answer) => (
        <span key={answer.status}>
          <code>{answer.status}</code>
          {shared.includes(`${answer.status} ${answer.description}`) ? null : (
            <>
              {" "}
              <Ticks>{answer.description}</Ticks>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

const routeColumns = (labels: ApiRoutesLabels, shared: readonly string[]): DataTableColumn<ApiOperation>[] => [
  {
    id: "route",
    header: labels.route,
    type: "title",
    card: "title",
    value: (op) => `${op.method} ${op.path}`,
    cell: (op) => <RouteCell op={op} parametersLabel={labels.parameters} />,
  },
  {
    id: "scope",
    header: labels.scope,
    priority: 2,
    minWidth: 150,
    value: (op) => op.scope ?? labels.noScope,
    cell: (op) => <code>{op.scope ?? labels.noScope}</code>,
  },
  {
    id: "answers",
    header: labels.answers,
    priority: 2,
    minWidth: 260,
    value: (op) => op.answers.map((a) => a.status).join(" "),
    cell: (op) => <AnswersCell op={op} shared={shared} />,
  },
];

/** The API's routes as one table (verikora#457: one 5 100 px page of repeated sections); an answer several routes share is said once, by the page, under the table. */
export function ApiRoutesTable({
  operations,
  shared,
  labels,
}: Readonly<{ operations: readonly ApiOperation[]; shared: readonly string[]; labels: ApiRoutesLabels }>) {
  return (
    <DataTable
      caption={labels.caption}
      rows={[...operations]}
      columns={routeColumns(labels, shared)}
      getRowId={(op) => op.id}
      rowLabel={(op) => `${op.method} ${op.path}`}
    />
  );
}
