"use client";

import { Badge } from "@krizaka/ui/badge";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import type { AdminUser } from "@verikora/core";
import Link from "next/link";
import { useMemo } from "react";

import { useSay } from "@/lib/i18n-client";

import { formatDate } from "../console/format";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

function userColumns(say: Say, locale: Lang): DataTableColumn<AdminUser>[] {
  return [
    {
      id: "email",
      header: say("admin.columns.email"),
      sortable: true,
      card: "title",
      value: (u) => u.email,
      cell: (u) => (
        <Link className="font-semibold text-fg hover:text-fg-accent hover:underline" href={`/${locale}/users/${u.id}`}>
          {u.email}
        </Link>
      ),
    },
    {
      id: "role",
      header: say("admin.columns.role"),
      value: (u) => u.role,
      cell: (u) => <Badge tone={u.role === "ADMIN" ? "accent" : "neutral"}>{say(`admin.roles.${u.role}`)}</Badge>,
    },
    {
      id: "status",
      header: say("admin.columns.status"),
      value: (u) => u.status,
      cell: (u) => <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{say(`admin.states.${u.status}`)}</Badge>,
    },
    {
      id: "documents",
      header: say("admin.columns.documents"),
      sortable: true,
      align: "end",
      value: (u) => u.documents,
    },
    {
      id: "lastSeen",
      header: say("admin.columns.lastSeen"),
      sortable: true,
      align: "end",
      value: (u) => u.lastSeenAt ?? "",
      cell: (u) => (u.lastSeenAt ? formatDate(u.lastSeenAt, locale, true) : say("admin.never")),
    },
  ];
}

/** The accounts, read only: who, which role, active or not, how many documents, last seen. */
export function UsersTable({ users }: Readonly<{ users: AdminUser[] }>) {
  const { say, locale } = useSay();
  const columns = useMemo(() => userColumns(say, locale), [say, locale]);
  return (
    <DataTable
      caption={say("admin.caption")}
      rows={users}
      columns={columns}
      getRowId={(u) => u.id}
      rowLabel={(u) => u.email}
      defaultSort={{ column: "lastSeen", direction: "descending" }}
    />
  );
}
