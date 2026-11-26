import { useRef, useState } from "react";
import { EditSegmentDialog, EditSiteDialog } from "@/components/AdminEdit";
import { AddSegmentBox } from "@/components/AddSegmentBox";
import { AddSiteBox } from "@/components/AddSiteBox";
import { KmzImportBox } from "@/components/KmzImport";
import { ReservationUpload } from "@/components/ReservationUpload";
import { SegmentListUpload } from "@/components/SegmentListUpload";
import { SegmentsTab } from "@/components/SegmentsTab";
import { SiteMasterUpload } from "@/components/SiteMasterUpload";
import { SitesTab } from "@/components/SitesTab";
import { Dialog, Note } from "@/components/upload-parts";
import { plural } from "@/lib/format";
import { useSegmentList } from "@/lib/useSegmentList";
import { useSiteList } from "@/lib/useSiteList";

const TABS = [["segments", "Segments"], ["sites", "Sites"], ["reservations", "Reservations"]] as const;
type Tab = (typeof TABS)[number][0];
type Box = "import-kmz" | "upload-segments" | "upload-sites" | "add-site" | "add-segment";
const TAB_CLASS = "-mb-px h-10 border-b-2 border-transparent px-4 font-medium text-muted-foreground "
  + "hover:text-foreground aria-selected:border-foreground aria-selected:font-semibold aria-selected:text-foreground";
const EXPORT_URL = "/api/admin/export/fiber-data.xlsx";
const WIDE_BOX = "m-auto w-[1000px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] overflow-auto";

// An existing upload flow (file, preview, apply) inside a box; the lists reload when it closes.
function UploadBox({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog title={title} onClose={onClose} cls={WIDE_BOX}>
      <div className="mt-4">{children}</div>
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

function Actions({ tab, onOpen }: { tab: Tab; onOpen: (box: Box) => void }) {
  if (tab === "reservations") {
    return null;
  }
  const download = <a className="btn btn-sm" href={EXPORT_URL} download="fiber-data.xlsx">Download</a>;
  if (tab === "segments") {
    return (
      <>
        <button type="button" className="btn btn-sm" onClick={() => onOpen("import-kmz")}>Import KMZ</button>
        {download}
        <button type="button" className="btn btn-sm btn-p" onClick={() => onOpen("upload-segments")}>Upload</button>
      </>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => onOpen("add-site")}>Add site</button>
      {download}
      <button type="button" className="btn btn-sm btn-p" onClick={() => onOpen("upload-sites")}>Upload</button>
    </>
  );
}

// Admin Upload page: Segments (master list), Sites and Reservations. Uploads open in boxes over the list.
export function Upload() {
  const [tab, setTab] = useState<Tab>("segments");
  const [box, setBox] = useState<Box | null>(null);
  const [editSegment, setEditSegment] = useState<number | null>(null);
  const [editSite, setEditSite] = useState<number | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const segments = useSegmentList();
  const sites = useSiteList();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const reload = () => {
    segments.reload();
    sites.reload();
  };
  const closeBox = () => {
    setBox(null);
    reload();
  };
  const kmzApplied = (saved: number) => {
    setImported(saved);
    closeBox();
  };
  const showSiteSegments = (siteId: number) => {
    segments.change({ siteId });
    setTab("segments");
  };
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
      <div className="flex items-end gap-4 border-b">
        <div role="tablist" aria-label="Upload kind" className="flex flex-1 gap-1" onKeyDown={onKey}>
          {TABS.map(([name, label]) => (
            <button key={name} ref={(element) => { refs.current[name] = element; }} type="button" role="tab"
              id={`up-tab-${name}`} aria-controls={`up-panel-${name}`}
              aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
              className={TAB_CLASS}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pb-1.5"><Actions tab={tab} onOpen={setBox} /></div>
      </div>
      <div aria-live="polite" data-testid="kmz-import-result">
        {imported != null && <Note tone="green" title={`${plural(imported, "route line")} drawn on the map`} />}
      </div>
      <div role="tabpanel" id="up-panel-segments" aria-labelledby="up-tab-segments" hidden={tab !== "segments"}>
        <SegmentsTab list={segments} sites={sites.rows} onAdd={() => setBox("add-segment")} onEdit={setEditSegment} />
      </div>
      <div role="tabpanel" id="up-panel-sites" aria-labelledby="up-tab-sites" hidden={tab !== "sites"}>
        <SitesTab list={sites} onEdit={setEditSite} onSegments={showSiteSegments} />
      </div>
      <div role="tabpanel" id="up-panel-reservations" aria-labelledby="up-tab-reservations" hidden={tab !== "reservations"}>
        <ReservationUpload />
      </div>
      {box === "import-kmz" && <KmzImportBox onClose={closeBox} onApplied={kmzApplied} />}
      {box === "upload-segments" && (
        <UploadBox title="Upload segments" onClose={closeBox}><SegmentListUpload /></UploadBox>
      )}
      {box === "upload-sites" && <UploadBox title="Upload sites" onClose={closeBox}><SiteMasterUpload /></UploadBox>}
      {box === "add-site" && <AddSiteBox onClose={() => setBox(null)} onSaved={reload} />}
      {box === "add-segment" && (
        <AddSegmentBox sites={sites.rows} siteAId={segments.filters.siteId} onClose={() => setBox(null)} onSaved={reload} />
      )}
      {editSegment != null && (
        <EditSegmentDialog segmentId={editSegment} onClose={() => setEditSegment(null)} onSaved={reload} />
      )}
      {editSite != null && <EditSiteDialog siteId={editSite} onClose={() => setEditSite(null)} onSaved={reload} />}
    </div>
  );
}
