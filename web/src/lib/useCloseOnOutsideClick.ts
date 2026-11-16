import { useEffect } from "react";

// Closes a popup when the user presses the mouse anywhere outside it.
export function useCloseOnOutsideClick(
  box: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [box, enabled, close]);
}
