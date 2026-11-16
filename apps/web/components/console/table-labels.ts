import type { DataTableLabels } from "@krizaka/ui/data-table";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** The words of every table of the console (search, filters, pagination), read once from the messages. */
export const tableLabels = (say: Say): Partial<DataTableLabels> => ({
  empty: say("library.table.empty"),
  details: say("library.table.details"),
  expandRow: (name) => say("library.table.expandRow", { name }),
  results: (count) => say("library.table.results", { count }),
  filters: say("library.table.filters"),
  clearFilters: say("library.table.clear"),
  removeFilter: (label) => say("library.table.remove", { label }),
  activeFilter: (header, value) => `${header} : ${value}`,
  search: (header) => say("library.table.search", { header }),
  pagination: {
    nav: say("library.table.pagination"),
    previous: say("library.table.previous"),
    next: say("library.table.next"),
    page: (n) => say("library.table.page", { page: n }),
    compact: (n, count) => say("library.table.compact", { page: n, count }),
    pageSize: say("library.table.pageSize"),
  },
});
