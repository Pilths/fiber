// Status and health symbols copied from the map mock (docs/mockups/comparison/map). Always decorative:
// the word next to them carries the meaning.
const PATHS = {
  av: <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  ch: <path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  rq: <><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 2.8a5.2 5.2 0 0 1 0 10.4z" fill="currentColor" /></>,
  rs: <><rect x="3" y="7" width="10" height="7" fill="currentColor" /><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" /></>,
  iu: <rect x="3" y="3" width="10" height="10" fill="currentColor" />,
  fl: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  co: <rect x="2.8" y="2.8" width="10.4" height="10.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.6 1.8" />,
  lo: <><path d="M8 2.2l6.4 11.3H1.6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8 6.6v3M8 11.5v.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  ex: <><circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 4.8v3.6M8 11v.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
  ns: <path d="M3 8h10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "ic" }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-icon={name} className={className}>{PATHS[name]}</svg>;
}

// Outline nav icons from the mock's top bar.
export function NavIcon({ d }: { d: string }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" className="ni"><path d={d} /></svg>;
}
