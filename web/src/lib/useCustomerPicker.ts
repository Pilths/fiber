import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";

export type Customer = components["schemas"]["Customer"];
export type PickedCustomer = Customer & { isNew?: boolean };

const LOOKUP_DELAY_MS = 150;

// Customer lookup for the Reserve box: typeahead over /api/customers, "Add as new", and the similar-name
// warning (confirm_new).
export function useCustomerPicker(onError: (text: string) => void) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [similar, setSimilar] = useState<Customer[] | null>(null);

  useEffect(() => {
    if (customer || !listOpen) {
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const found = await api.get("/api/customers", { query: { q: query.trim() || undefined } });
        if (!stale) {
          setMatches(found);
        }
      } catch {
        // the list just stays as it was; typing again retries
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, customer, listOpen]);

  const choose = (picked: PickedCustomer) => {
    setCustomer(picked);
    setSimilar(null);
    setListOpen(false);
  };

  const addNew = async (confirmNew: boolean) => {
    try {
      const body = { name: query.trim(), confirm_new: confirmNew };
      const answer = await api.post("/api/customers", { body });
      if (answer.customer) {
        choose({ ...answer.customer, isNew: answer.created });
        return;
      }
      // similar names exist: warn, the planner confirms
      setSimilar(answer.similar);
      setListOpen(false);
    } catch {
      onError("Could not check the customer name. Try again.");
    }
  };

  const type = (text: string) => {
    setQuery(text);
    setSimilar(null);
    setListOpen(true);
  };

  const change = () => {
    setCustomer(null);
    setListOpen(true);
  };

  const trimmed = query.trim();
  const exact = matches.some((match) => match.name.toLowerCase() === trimmed.toLowerCase());
  const showList = !customer && listOpen && (trimmed !== "" || matches.length > 0);
  const canAdd = trimmed !== "" && !exact;
  return {
    query,
    matches,
    listOpen,
    setListOpen,
    customer,
    similar,
    showList,
    canAdd,
    choose,
    addNew,
    type,
    change,
  };
}

export type CustomerPicker = ReturnType<typeof useCustomerPicker>;
