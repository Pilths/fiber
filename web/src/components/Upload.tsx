import { useRef, useState } from "react";
import { ReservationUpload } from "@/components/ReservationUpload";
import { SiteMasterUpload } from "@/components/SiteMasterUpload";
import { SegmentListUpload } from "@/components/SegmentListUpload";
import { KmzUpload } from "@/components/KmzUpload";
import { Clusters } from "@/components/Clusters";

const TABS = [["site-master", "Sites (Excel)"], ["segment-list", "Segments (Excel)"], ["kmz", "KMZ"],
  ["reservations", "Reservations (Excel)"], ["clusters", "Clusters"]] as const;
type Tab = (typeof TABS)[number][0];
const TAB_CLASS = "-mb-px h-10 border-b-2 border-transparent px-4 font-medium text-muted-foreground "
  + "hover:text-foreground aria-selected:border-foreground aria-selected:font-semibold aria-selected:text-foreground";

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
  if (tab === "clusters") {
    return <Clusters />;
  }
  return <ReservationUpload />;
}

export function Upload() {
  const [tab, setTab] = useState<Tab>("site-master");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    const step = event.key === "ArrowRight" ? 1 : TABS.length - 1;
    const current = TABS.findIndex(([name]) => name === tab);
    const next = TABS[(current + step) % TABS.length][0];
    setTab(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Upload kind" className="flex gap-1 border-b" onKeyDown={onKey}>
        {TABS.map(([name, label]) => (
          <button key={name} ref={(element) => { refs.current[name] = element; }} type="button" role="tab"
            id={`up-tab-${name}`} aria-controls={`up-panel-${name}`}
            aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
            className={TAB_CLASS}>
            {label}
          </button>
        ))}
      </div>
      {TABS.map(([name]) => (
        <div key={name} role="tabpanel" id={`up-panel-${name}`} aria-labelledby={`up-tab-${name}`} hidden={tab !== name}>
          <UploadPanel tab={name} />
        </div>
      ))}
    </div>
  );
}
