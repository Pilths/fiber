import { useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Dialog } from "@/components/upload-parts";

type Core = components["schemas"]["CoreDetail"];
type FieldErrors = { loss?: string; testedOn?: string };

const LABEL = "lbl mb-1 block text-body! text-foreground!";
const MAX_LOSS_DB = 100;

// Dates are compared as YYYY-MM-DD strings in the Kuala Lumpur day, the same day the API checks against.
function todayInKualaLumpur(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

function checkFields(lossText: string, testedOn: string, today: string): FieldErrors {
  const errors: FieldErrors = {};
  const lossDb = Number(lossText);
  if (lossText.trim() === "") {
    errors.loss = "Enter the measured loss.";
  } else if (!Number.isFinite(lossDb) || lossDb <= 0 || lossDb > MAX_LOSS_DB) {
    errors.loss = `Enter a value above 0 and up to ${MAX_LOSS_DB} dB.`;
  }
  if (testedOn === "") {
    errors.testedOn = "Enter the test date.";
  } else if (testedOn > today) {
    errors.testedOn = "The test date cannot be after today.";
  }
  return errors;
}

function useMeasurementForm(core: Core, onSaved: () => void, onClose: () => void) {
  const today = todayInKualaLumpur();
  const [lossText, setLossText] = useState("");
  const [testedOn, setTestedOn] = useState(today);
  const [testMethod, setTestMethod] = useState("");
  const [fieldTeam, setFieldTeam] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = checkFields(lossText, testedOn, today);
    setFieldErrors(errors);
    if (errors.loss || errors.testedOn) {
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      loss_db: Number(lossText),
      tested_on: testedOn,
      test_method: testMethod.trim() || null,
      field_team: fieldTeam.trim() || null,
    };
    try {
      await api.post("/api/admin/cores/{core_id}/measurements", { path: { core_id: core.id }, body });
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorText(caught, "Could not save. Check the values and try again."));
      setBusy(false);
    }
  };

  return {
    today, lossText, setLossText, testedOn, setTestedOn, testMethod, setTestMethod,
    fieldTeam, setFieldTeam, fieldErrors, error, busy, submit,
  };
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) {
    return null;
  }
  return <p id={id} className="mt-1 text-body font-semibold text-red">{text}</p>;
}

// A Measured loss test typed by hand from the field team's report. No reason field (owner decision).
export function MeasurementDialog({ core, onClose, onSaved }: { core: Core; onClose: () => void; onSaved: () => void }) {
  const form = useMeasurementForm(core, onSaved, onClose);
  const title = `Measured loss test for core ${core.number}`;
  return (
    <Dialog title={title} onClose={onClose}>
      {form.error && (
        <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">
          {form.error}
        </p>
      )}
      <form onSubmit={form.submit} noValidate aria-label={title} className="mt-4 space-y-3">
        <label className="block">
          <span className={LABEL}>Measured loss (dB)</span>
          <input className="field" type="number" step="0.01" min="0" max={MAX_LOSS_DB} required autoFocus
            value={form.lossText} onChange={(event) => form.setLossText(event.target.value)}
            aria-invalid={Boolean(form.fieldErrors.loss)} aria-describedby="measurement-loss-error" />
          <FieldError id="measurement-loss-error" text={form.fieldErrors.loss} />
        </label>
        <label className="block">
          <span className={LABEL}>Test date</span>
          <input className="field" type="date" max={form.today} required
            value={form.testedOn} onChange={(event) => form.setTestedOn(event.target.value)}
            aria-invalid={Boolean(form.fieldErrors.testedOn)} aria-describedby="measurement-date-error" />
          <FieldError id="measurement-date-error" text={form.fieldErrors.testedOn} />
        </label>
        <label className="block">
          <span className={LABEL}>Test type</span>
          <input className="field" placeholder="e.g. OTDR"
            value={form.testMethod} onChange={(event) => form.setTestMethod(event.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>Field team</span>
          <input className="field" value={form.fieldTeam} onChange={(event) => form.setFieldTeam(event.target.value)} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={form.busy}>{form.busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
