import { useEffect, useState } from "react";
import { errorText } from "@/api/client";

export type RowPage<Row> = { total: number; items: Row[] };
export type LoadRows<Group, Row> = (group: Group, page: number) => Promise<RowPage<Row>>;

// One page of an upload's preview rows, filtered by result group. `load` must keep its identity
// (useCallback) while the upload stays the same, or the rows load again on every render.
export function usePagedRows<Group, Row>(load: LoadRows<Group, Row>, firstGroup: Group) {
  const [group, setGroup] = useState<Group>(firstGroup);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RowPage<Row> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    load(group, page)
      .then((loaded) => {
        if (stale) {
          return;
        }
        setData(loaded);
        setError(null);
      })
      .catch((caught) => {
        if (!stale) {
          setError(errorText(caught, "Could not load rows."));
        }
      });
    return () => {
      stale = true;
    };
  }, [load, group, page]);

  const chooseGroup = (next: Group) => {
    setGroup(next);
    setPage(1);
  };
  return { group, page, setPage, data, error, chooseGroup };
}

// What a rows table needs from the hook, whatever its group type.
export type PagedRows<Row> = {
  data: RowPage<Row> | null;
  error: string | null;
  page: number;
  setPage: (page: number) => void;
};
