import { useId } from "react";
import type { CustomerPicker } from "@/lib/useCustomerPicker";

const LIST_CLASS =
  "absolute bottom-[42px] left-0 right-0 z-10 max-h-56 overflow-auto " +
  "rounded-xl border border-line bg-white py-1.5";
const MATCH_CLASS = "block min-h-9 w-full px-3 text-left hover:bg-blue-bg focus-visible:-outline-offset-3";
const ADD_CLASS =
  "block min-h-9 w-full border-t px-3 text-left font-semibold text-blue " +
  "hover:bg-blue-bg focus-visible:-outline-offset-3";
const CHOSEN_CLASS =
  "flex h-9 items-center justify-between gap-2 rounded-md border border-line bg-white pl-3 pr-1";

function ChosenCustomer({ picker, inputId }: { picker: CustomerPicker; inputId: string }) {
  const customer = picker.customer!;
  return (
    <p className={CHOSEN_CLASS}>
      <span className="truncate font-semibold">{customer.name}{customer.isNew && " (new customer)"}</span>
      <button type="button" id={inputId} className="btn h-7 px-2.5 text-body" onClick={picker.change}>
        Change
      </button>
    </p>
  );
}

type InputProps = { picker: CustomerPicker; inputId: string; listId: string };

function SearchInput({ picker, inputId, listId }: InputProps) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    // Escape closes the list first; the next Escape reaches the Reserve box
    if (event.key === "Escape" && picker.listOpen) {
      event.preventDefault();
      event.stopPropagation();
      picker.setListOpen(false);
    }
  };
  return (
    <input id={inputId} aria-label="Search customers" role="combobox" aria-expanded={picker.listOpen}
      aria-controls={listId} aria-autocomplete="list"
      className="field" placeholder="Type a customer name" value={picker.query} autoComplete="off"
      onChange={(event) => picker.type(event.target.value)}
      onFocus={() => picker.setListOpen(true)}
      onKeyDown={onKeyDown} />
  );
}

function MatchList({ picker, listId }: { picker: CustomerPicker; listId: string }) {
  return (
    <div id={listId} className={LIST_CLASS}>
      <ul aria-label="Matching customers">
        {picker.matches.map((match) => (
          <li key={match.id}>
            <button type="button" className={MATCH_CLASS} onClick={() => picker.choose(match)}>
              {match.name}
            </button>
          </li>
        ))}
      </ul>
      {picker.canAdd && (
        <button type="button" className={ADD_CLASS} onClick={() => picker.addNew(false)}>
          Add "{picker.query.trim()}" as a new customer
        </button>
      )}
    </div>
  );
}

export function CustomerField({ picker }: { picker: CustomerPicker }) {
  const id = useId();
  const inputId = `${id}-c`;
  const listId = `${id}-l`;
  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      picker.setListOpen(false);
    }
  };
  return (
    <div className="relative grid min-w-[240px] flex-[1_1_320px] gap-1" onBlur={onBlur}>
      <label htmlFor={inputId} className="lbl">Customer (required)</label>
      {picker.customer ? (
        <ChosenCustomer picker={picker} inputId={inputId} />
      ) : (
        <SearchInput picker={picker} inputId={inputId} listId={listId} />
      )}
      {picker.showList && <MatchList picker={picker} listId={listId} />}
    </div>
  );
}

export function SimilarWarning({ picker }: { picker: CustomerPicker }) {
  const similar = picker.similar;
  if (!similar || similar.length === 0) {
    return null;
  }
  return (
    <div role="alert" className="mt-3 note p-3 text-body">
      <strong className="text-amber">Similar customers already exist:</strong>{" "}
      {similar.map((customer) => customer.name).join(", ")}
      <div className="mt-2 flex flex-wrap gap-2">
        {similar.map((customer) => (
          <button key={customer.id} type="button" className="btn btn-sm"
            onClick={() => picker.choose(customer)}>
            Use {customer.name}
          </button>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => picker.addNew(true)}>
          Create new anyway
        </button>
      </div>
    </div>
  );
}
