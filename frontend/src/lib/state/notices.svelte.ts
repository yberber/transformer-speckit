// Short messages announced politely to screen readers and shown briefly on screen, e.g. "part of
// the link could not be restored". Rendered by App.svelte in an aria-live region.

export interface Notice {
  id: number;
  message: string;
}

export const notices: Notice[] = $state([]);

let nextId = 0;

/** Show `message` (already translated) for `ms` milliseconds. */
export function notify(message: string, ms = 6000): void {
  const id = ++nextId;
  notices.push({ id, message });
  setTimeout(() => {
    const i = notices.findIndex((n) => n.id === id);
    if (i >= 0) notices.splice(i, 1);
  }, ms);
}
