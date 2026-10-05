export function supportsPageEditorHistoryGuard(target: Window): boolean {
  return typeof (target as Window & { navigation?: EventTarget }).navigation?.addEventListener === "function";
}

/** Page-editor lifetime only; no routing policy or persisted content is changed. */
export function installPageEditorNavigationGuard(
  target: Window,
  hasUnsavedChanges: () => boolean,
  confirmLeave: () => boolean,
  isSaving: () => boolean = () => false,
): () => void {
  const history = target.history;
  const navigation = supportsPageEditorHistoryGuard(target) ? (target as Window & { navigation?: EventTarget }).navigation : undefined;
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  let currentUrl = target.location.href;
  let currentState = history.state;
  let approvedClick = false;

  const changesPage = (url?: string | URL | null) => {
    if (url == null) return false;
    const next = new URL(String(url), target.location.href);
    const current = new URL(currentUrl);
    return next.origin !== current.origin || next.pathname !== current.pathname || next.search !== current.search;
  };
  const canLeave = () => !isSaving() && (!hasUnsavedChanges() || approvedClick || confirmLeave());
  const wrap = (original: History["pushState"]): History["pushState"] => function (state, title, url) {
    if (changesPage(url) && !canLeave()) return;
    original.call(history, state, title, url);
    currentUrl = target.location.href;
    currentState = history.state;
  };
  const guardedPush = wrap(pushState);
  const guardedReplace = wrap(replaceState);
  history.pushState = guardedPush;
  history.replaceState = guardedReplace;

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if ((!hasUnsavedChanges() && !isSaving()) || (approvedClick && !isSaving())) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target as Element | null;
    const anchor = element?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const url = new URL(anchor.href, target.location.href);
    // Cross-document links use the browser's native beforeunload confirmation.
    if (url.origin !== target.location.origin || !changesPage(url)) return;
    if (!canLeave()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else {
      approvedClick = true;
      target.setTimeout(() => { approvedClick = false; }, 0);
    }
  };
  const popState = (event: PopStateEvent) => {
    if (changesPage(target.location.href) && !canLeave()) {
      // Best effort only on older browsers: an earlier router listener may have
      // unmounted the editor before this callback runs. Editors show that limit.
      // If still mounted, cancellation starts a new branch of browser history.
      event.stopImmediatePropagation();
      pushState.call(history, currentState, "", currentUrl);
      return false;
    }
    currentUrl = target.location.href;
    currentState = history.state;
    return true;
  };
  const navigate = (event: Event) => {
    const traversal = event as Event & { navigationType?: string; destination?: { sameDocument?: boolean } };
    if (traversal.navigationType !== "traverse" || !traversal.destination?.sameDocument || !event.cancelable) return;
    // This fires before URL/history state changes or any router subscription,
    // including when the editor itself was lazy-loaded after the router.
    if (!canLeave()) event.preventDefault();
  };
  target.addEventListener("beforeunload", beforeUnload);
  target.addEventListener("click", click, true);
  if (navigation) navigation.addEventListener("navigate", navigate);
  else target.addEventListener("popstate", popState, true);
  return () => {
    target.removeEventListener("beforeunload", beforeUnload);
    target.removeEventListener("click", click, true);
    if (navigation) navigation.removeEventListener("navigate", navigate);
    else target.removeEventListener("popstate", popState, true);
    if (history.pushState === guardedPush) history.pushState = pushState;
    if (history.replaceState === guardedReplace) history.replaceState = replaceState;
  };
}
