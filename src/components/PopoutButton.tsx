// Rendered only inside the side panel (IS_SIDE_PANEL). Opens the same
// bundled app in a tab via `chrome.tabs.create`, then closes the panel
// so we never have two views fighting over the same OPFS / IDB.

import { useEffect } from "react";
import { POPOUT_MESSAGE, POPOUT_PAGE, type PopoutMessage } from "../runtime";

async function popOut(): Promise<void> {
  if (typeof chrome === "undefined") return;
  const url = chrome.runtime.getURL(POPOUT_PAGE);
  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    console.error("[catm] popout failed:", err);
    return;
  }
  // One view at a time. Closing the panel disposes the document and frees
  // the worker — segments already in OPFS persist for the tab to read.
  window.close();
}

export function PopoutButton(): React.JSX.Element {
  // The keyboard command reaches every extension page; only the panel in the
  // command's window answers.
  useEffect(() => {
    if (typeof chrome === "undefined") return;
    let windowId: number | undefined;
    chrome.windows
      .getCurrent()
      .then((w) => {
        windowId = w.id;
      })
      .catch((err) => console.error("[catm] windows.getCurrent:", err));
    const onMessage = (
      msg: PopoutMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (handled: boolean) => void,
    ): void => {
      if (msg?.type !== POPOUT_MESSAGE) return;
      if (msg.windowId != null && msg.windowId !== windowId) return;
      sendResponse(true);
      void popOut();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  return (
    <button
      type="button"
      className="popout-btn"
      onClick={() => void popOut()}
      title="Open in tab"
      aria-label="Open in tab"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 3h4v4" />
        <path d="M13 3l-6 6" />
        <path d="M11 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" />
      </svg>
    </button>
  );
}
