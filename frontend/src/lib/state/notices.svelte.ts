// Short messages announced politely to screen readers and shown briefly on screen, and the
// one-time link notice. App.svelte renders both with Notice.svelte in an aria-live region.

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

/**
 * The "part of the link could not be restored" notice (US7-3). It is raised at most once per
 * page load, however many parts of the link turn out to be invalid, and stays until dismissed.
 */
export const linkNotice = $state({ visible: false });

let linkNoticeRaised = false;

export function raiseLinkNotice(): void {
  if (linkNoticeRaised) return;
  linkNoticeRaised = true;
  linkNotice.visible = true;
}

export function dismissLinkNotice(): void {
  linkNotice.visible = false;
}
