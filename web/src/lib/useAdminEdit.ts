import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/api/client";
import type { components } from "@/api/schema";

type SegmentEdit = components["schemas"]["SegmentEdit"];
type SiteEdit = components["schemas"]["SiteEdit"];
export type Site = { id: number; name: string };

// "restore": opened from the Fiber cut banner, box unticked and focus on the remarks.
export type SegmentFocus = "survey" | "restore";

type InputEvent = React.ChangeEvent<HTMLInputElement | HTMLSelectElement>;

// Plain words for the admin edit errors; 409 survey-lower carries the blocking core numbers.
function editError(error: unknown) {
  const apiDetail = error instanceof ApiError ? error.detail : null;
  const detail = (apiDetail as { detail?: { blocking_core_numbers?: number[] } } | null)?.detail;
  const blocking = detail && typeof detail === "object" ? detail.blocking_core_numbers : undefined;
  if (blocking?.length) {
    return `Cores ${blocking.join(", ")} are allocated or have history and cannot be removed. `
      + "The verified core count stays as it is.";
  }
  if (error instanceof ApiError && error.status === 400) {
    return "Nothing changed.";
  }
  return errorText(error, "Could not save. Try again.");
}

const optionalText = (value: number | string | null | undefined) => (value == null ? "" : String(value));

function segmentForm(segment: SegmentEdit, focus?: SegmentFocus) {
  return {
    distance: segment.distance_km == null ? "" : String(Number(segment.distance_km)),
    region: segment.region ?? "",
    survey: optionalText(segment.survey_cores),
    cable: String(segment.cable_size),
    route: segment.route ?? "",
    section: segment.section ?? "",
    remarks: "",
    cut: focus !== "restore" && segment.fiber_cut,
  };
}

type SegmentForm = ReturnType<typeof segmentForm>;
const EMPTY_SEGMENT = { distance_km: null, region: null, survey_cores: null, cable_size: 0, fiber_cut: false } as SegmentEdit;

// Only changed fields are sent.
function segmentChanges(segment: SegmentEdit, form: SegmentForm, siteA: Site, siteB: Site) {
  const body: components["schemas"]["SegmentBody"] = { remarks: form.remarks.trim() };
  const distanceChanged = segment.distance_km == null || Number(form.distance) !== Number(segment.distance_km);
  if (form.distance !== "" && distanceChanged) {
    body.distance_km = form.distance;
  }
  if (form.region && form.region !== segment.region) {
    body.region = form.region;
  }
  if (form.route.trim() !== (segment.route ?? "")) {
    body.route = form.route.trim();
  }
  if (form.section.trim() !== (segment.section ?? "")) {
    body.section = form.section.trim();
  }
  if (siteA.id !== segment.site_a_id) {
    body.site_a_id = siteA.id;
  }
  if (siteB.id !== segment.site_b_id) {
    body.site_b_id = siteB.id;
  }
  if (form.survey !== "" && Number(form.survey) !== segment.survey_cores) {
    body.survey_cores = Number(form.survey);
  }
  if (form.cable !== "" && Number(form.cable) !== segment.cable_size) {
    body.cable_size = Number(form.cable);
  }
  if (form.cut !== segment.fiber_cut) {
    body.fiber_cut = form.cut;
  }
  return body;
}

// Shared save step of both dialogs: refuse an empty change, post, then close or show the error.
function useSave(onClose: () => void, onSaved: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (body: object, post: () => Promise<unknown>) => {
    if (Object.keys(body).length === 1) {
      setError("Nothing changed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post();
      onSaved();
      onClose();
    } catch (err) {
      setError(editError(err));
      setBusy(false);
    }
  };
  return { error, setError, busy, save };
}

export function useEditSegment(segmentId: number, focus: SegmentFocus | undefined, onClose: () => void,
  onSaved: () => void) {
  const [segment, setSegment] = useState<SegmentEdit | null>(null);
  const [form, setForm] = useState<SegmentForm>(segmentForm(EMPTY_SEGMENT));
  const [siteA, setSiteA] = useState<Site | null>(null);
  const [siteB, setSiteB] = useState<Site | null>(null);
  const [pasting, setPasting] = useState(false);
  const surveyInput = useRef<HTMLInputElement>(null);
  const { error, setError, busy, save } = useSave(onClose, onSaved);

  useEffect(() => {
    // A late second load (StrictMode runs effects twice) must not overwrite what the user typed.
    let stale = false;
    api.get("/api/admin/segments/{sid}", { path: { sid: segmentId } })
      .then((loaded) => {
        if (stale) {
          return;
        }
        setSegment(loaded);
        setForm(segmentForm(loaded, focus));
        setSiteA({ id: loaded.site_a_id, name: loaded.site_a });
        setSiteB({ id: loaded.site_b_id, name: loaded.site_b });
      })
      .catch((err) => {
        if (!stale) {
          setError(errorText(err, "Could not load the segment."));
        }
      });
    return () => {
      stale = true;
    };
  }, [segmentId, focus, setError]);

  useEffect(() => {
    if (segment && focus === "survey") {
      surveyInput.current?.focus();
    }
  }, [segment, focus]);

  const setField = (key: "distance" | "region" | "survey" | "cable" | "route" | "section") => (event: InputEvent) => {
    setForm((old) => ({ ...old, [key]: event.target.value }));
  };
  const setCut = (cut: boolean) => {
    setForm((old) => ({ ...old, cut }));
  };
  const setRemarks = (remarks: string) => {
    setForm((old) => ({ ...old, remarks }));
  };
  const copyTotalCores = () => {
    setForm((old) => ({ ...old, survey: old.cable }));
  };
  const portsApplied = () => {
    setPasting(false);
    onSaved();
    onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!segment || !siteA || !siteB) {
      return;
    }
    const body = segmentChanges(segment, form, siteA, siteB);
    await save(body, () => api.post("/api/admin/segments/{sid}", { path: { sid: segmentId }, body }));
  };

  return {
    segment, form, siteA, setSiteA, siteB, setSiteB, error, setError, busy, pasting, setPasting, surveyInput,
    setField, setCut, setRemarks, copyTotalCores, portsApplied, submit,
  };
}

function siteForm(site: SiteEdit) {
  return {
    name: site.name,
    lat: optionalText(site.lat),
    lon: optionalText(site.lon),
    region: site.region ?? "",
    kind: site.kind,
    active: site.active,
    remarks: "",
  };
}

type SiteForm = ReturnType<typeof siteForm>;

function siteChanges(site: SiteEdit, form: SiteForm) {
  const body: components["schemas"]["SiteBody"] = { remarks: form.remarks.trim() };
  if (form.name.trim() !== site.name) {
    body.name = form.name;
  }
  if (form.lat !== "" && Number(form.lat) !== site.lat) {
    body.lat = Number(form.lat);
  }
  if (form.lon !== "" && Number(form.lon) !== site.lon) {
    body.lon = Number(form.lon);
  }
  if (form.region && form.region !== site.region) {
    body.region = form.region;
  }
  if (form.kind !== site.kind) {
    body.kind = form.kind;
  }
  if (form.active !== site.active) {
    body.active = form.active;
  }
  return body;
}

export function useEditSite(siteId: number, onClose: () => void, onSaved: () => void) {
  const [site, setSite] = useState<SiteEdit | null>(null);
  const [form, setForm] = useState({ name: "", lat: "", lon: "", region: "", kind: "site", active: true, remarks: "" });
  const { error, setError, busy, save } = useSave(onClose, onSaved);

  useEffect(() => {
    let stale = false;
    api.get("/api/admin/sites/{sid}", { path: { sid: siteId } })
      .then((loaded) => {
        if (stale) {
          return;
        }
        setSite(loaded);
        setForm(siteForm(loaded));
      })
      .catch((err) => {
        if (!stale) {
          setError(errorText(err, "Could not load the site."));
        }
      });
    return () => {
      stale = true;
    };
  }, [siteId, setError]);

  const setField = (key: "name" | "lat" | "lon" | "region" | "kind") => (event: InputEvent) => {
    setForm((old) => ({ ...old, [key]: event.target.value }));
  };
  const setActive = (active: boolean) => {
    setForm((old) => ({ ...old, active }));
  };
  const setRemarks = (remarks: string) => {
    setForm((old) => ({ ...old, remarks }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!site) {
      return;
    }
    const body = siteChanges(site, form);
    await save(body, () => api.post("/api/admin/sites/{sid}", { path: { sid: siteId }, body }));
  };

  return { site, form, error, setError, busy, setField, setActive, setRemarks, submit };
}
