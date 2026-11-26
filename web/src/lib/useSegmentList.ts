import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { LIST_PAGE_SIZE } from "@/components/ListPager";

export type SegmentRow = components["schemas"]["SegmentListRow"];

type Filters = { search: string; siteId: number | null; route: string; noRoute: boolean; notRegistered: boolean };
const NO_FILTERS: Filters = { search: "", siteId: null, route: "", noRoute: false, notRegistered: false };

function matches(row: SegmentRow, filters: Filters) {
  const query = filters.search.trim().toLowerCase();
  if (query) {
    const text = `${row.site_a}-${row.site_b} ${row.site_b}-${row.site_a} ${row.route ?? ""}`.toLowerCase();
    if (!text.includes(query)) {
      return false;
    }
  }
  if (filters.siteId != null && row.site_a_id !== filters.siteId && row.site_b_id !== filters.siteId) {
    return false;
  }
  if (filters.route && row.route !== filters.route) {
    return false;
  }
  if (filters.noRoute && row.kmz_route_count > 0) {
    return false;
  }
  return !filters.notRegistered || row.survey_cores == null;
}

// All segments once, filtered and paged here.
export function useSegmentList() {
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);

  const reload = useCallback(() => {
    api.get("/api/admin/segments/list")
      .then((loaded) => {
        setRows(loaded);
        setError(null);
      })
      .catch((err) => setError(errorText(err, "Could not load the segments.")));
  }, []);
  useEffect(reload, [reload]);

  const filtered = useMemo(() => rows.filter((row) => matches(row, filters)), [rows, filters]);
  const routes = useMemo(() => [...new Set(rows.map((row) => row.route).filter((route): route is string => !!route))].sort(), [rows]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const shown = filtered.slice(current * LIST_PAGE_SIZE, (current + 1) * LIST_PAGE_SIZE);

  const change = (patch: Partial<Filters>) => {
    setFilters((old) => ({ ...old, ...patch }));
    setPage(0);
  };
  return { shown, total: filtered.length, routes, error, filters, change, page: current, setPage, reload };
}
