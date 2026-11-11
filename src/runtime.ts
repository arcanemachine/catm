// Side panel = extension origin, no ?ctx=tab. Popout tab uses ?ctx=tab.
export const IS_SIDE_PANEL: boolean =
  typeof window !== "undefined" &&
  window.location.protocol === "chrome-extension:" &&
  new URLSearchParams(window.location.search).get("ctx") !== "tab";

export const POPOUT_PAGE = "src/sidepanel/index.html?ctx=tab";

/** Background → side panel: pop out if you are the panel in `windowId`. */
export const POPOUT_MESSAGE = "catm:popout";
export interface PopoutMessage {
  type: typeof POPOUT_MESSAGE;
  windowId?: number;
}
