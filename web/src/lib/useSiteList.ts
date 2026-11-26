import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { LIST_PAGE_SIZE } from "@/components/ListPager";

export type SiteRow = components["schemas"]["SiteListRow"];

export const SITE_KINDS = [["site", "Site"], ["building", "Building"], ["data_center", "DC"], ["toc", "TOC"]] as const;
export const KIND_LABEL: Record<string, string> = { site: "Site", building: "Building", data_center: "DC", toc: "TOC" };

// All sites once, filtered and paged here (a few hundred rows at most).
export function useSiteList() {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearchText] = useState("");
  const [kind, setKindFilter] = useState("");
  const [page, setPage] = useState(0);

  const reload = useCallback(() => {
    api.get("/api/admin/sites/list")
      .then((loaded) => {
        setRows(loaded);
        setError(null);
      })
      .catch((err) => setError(errorText(err, "Could not load the sites.")));
  }, []);
  useEffect(reload, [reload]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => row.name.toLowerCase().includes(query) && (!kind || row.kind === kind));
  }, [rows, search, kind]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const shown = filtered.slice(current * LIST_PAGE_SIZE, (current + 1) * LIST_PAGE_SIZE);

  const setSearch = (text: string) => {
    setSearchText(text);
    setPage(0);
  };
  const setKind = (value: string) => {
    setKindFilter(value);
    setPage(0);
  };
  return { rows, shown, total: filtered.length, error, search, setSearch, kind, setKind, page: current, setPage, reload };
}
