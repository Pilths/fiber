export function Chevron({ open }: { open: boolean }) {
  let turn = "";
  if (open) {
    turn = "rotate-90";
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`ic transition-transform ${turn}`}>
      <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
