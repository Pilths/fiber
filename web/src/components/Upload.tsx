import { useRef, useState } from "react";
import { ReservationUpload } from "@/components/ReservationUpload";
import { SiteMasterUpload } from "@/components/SiteMasterUpload";
import { SegmentListUpload } from "@/components/SegmentListUpload";
import { KmzUpload } from "@/components/KmzUpload";

const TABS = [["site-master", "Site master workbook"], ["segment-list", "Segment list"], ["kmz", "KMZ route lines"],
  ["reservations", "Reservation workbook"]] as const;
type Tab = (typeof TABS)[number][0];

// Admin Upload page: four separate files, each Upload -> Preview -> Apply/Confirm. All panels stay mounted so a
// preview survives switching tabs.
function UploadPanel({ tab }: { tab: Tab }) {
  if (tab === "site-master") {
    return <SiteMasterUpload />;
  }
  if (tab === "segment-list") {
    return <SegmentListUpload />;
  }
  if (tab === "kmz") {
    return <KmzUpload />;
  }
  return <ReservationUpload />;
}

export function Upload() {
  const [tab, setTab] = useState<Tab>("site-master");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(TABS.findIndex(([t]) => t === tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    setTab(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Upload kind" className="flex gap-1 border-b" onKeyDown={onKey}>
        {TABS.map(([t, label]) => (
          <button key={t} ref={(el) => { refs.current[t] = el; }} type="button" role="tab" id={`up-tab-${t}`} aria-controls={`up-panel-${t}`}
            aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}
            className="-mb-px h-10 border-b-2 border-transparent px-4 font-medium text-muted-foreground hover:text-foreground aria-selected:border-foreground aria-selected:font-semibold aria-selected:text-foreground">
            {label}
          </button>
        ))}
      </div>
      {TABS.map(([t]) => (
        <div key={t} role="tabpanel" id={`up-panel-${t}`} aria-labelledby={`up-tab-${t}`} hidden={tab !== t}>
          <UploadPanel tab={t} />
        </div>
      ))}
    </div>
  );
}
