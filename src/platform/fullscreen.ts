export const PRESENTATION_ATTRIBUTE = "data-presentation";

export type FullscreenOutcome =
  | "native"
  | "fallback-unsupported"
  | "fallback-denied"
  | "fallback-failed";

export interface FullscreenSnapshot {
  presentationActive: boolean;
  nativeActive: boolean;
  nativeSupported: boolean;
}

export interface FullscreenRequestResult extends FullscreenSnapshot {
  outcome: FullscreenOutcome;
}

type WebkitDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const PRESENTATION_CHANGE_EVENT = "whiteboard:presentationchange";

function getNativeFullscreenElement(documentRef: Document): Element | null {
  const webkitDocument = documentRef as WebkitDocument;
  return documentRef.fullscreenElement ?? webkitDocument.webkitFullscreenElement ?? null;
}

function getRequestFullscreen(target: HTMLElement): (() => Promise<void> | void) | undefined {
  const webkitTarget = target as WebkitElement;
  const request = target.requestFullscreen ?? webkitTarget.webkitRequestFullscreen;
  return request?.bind(target);
}

function getExitFullscreen(documentRef: Document): (() => Promise<void> | void) | undefined {
  const webkitDocument = documentRef as WebkitDocument;
  const exit = documentRef.exitFullscreen ?? webkitDocument.webkitExitFullscreen;
  return exit?.bind(documentRef);
}

function setPresentationActive(documentRef: Document, active: boolean): void {
  if (active) {
    documentRef.documentElement.setAttribute(PRESENTATION_ATTRIBUTE, "true");
  } else {
    documentRef.documentElement.removeAttribute(PRESENTATION_ATTRIBUTE);
  }

  documentRef.dispatchEvent(new Event(PRESENTATION_CHANGE_EVENT));
}

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError");
}

export function getFullscreenSnapshot(
  documentRef: Document = document,
): FullscreenSnapshot {
  const target = documentRef.documentElement;

  return {
    presentationActive: target.getAttribute(PRESENTATION_ATTRIBUTE) === "true",
    nativeActive: getNativeFullscreenElement(documentRef) !== null,
    nativeSupported: getRequestFullscreen(target) !== undefined,
  };
}

/**
 * Enters the CSS presentation mode synchronously, then requests native fullscreen.
 * Keeping the first step synchronous is important: the native request must remain in
 * the same user gesture, while the application still gets a useful fallback if the
 * browser rejects or does not implement the Fullscreen API.
 */
export async function requestPresentationFullscreen(
  target?: HTMLElement,
): Promise<FullscreenRequestResult> {
  const resolvedTarget = target ?? document.documentElement;
  const documentRef = resolvedTarget.ownerDocument;
  const requestFullscreen = getRequestFullscreen(resolvedTarget);

  setPresentationActive(documentRef, true);

  if (!requestFullscreen) {
    return {
      ...getFullscreenSnapshot(documentRef),
      outcome: "fallback-unsupported",
    };
  }

  try {
    await requestFullscreen();
    return {
      ...getFullscreenSnapshot(documentRef),
      nativeActive: true,
      outcome: "native",
    };
  } catch (error) {
    return {
      ...getFullscreenSnapshot(documentRef),
      outcome: isPermissionError(error) ? "fallback-denied" : "fallback-failed",
    };
  }
}

/**
 * Leaves both native fullscreen (when active) and the CSS presentation fallback.
 * The CSS state is always cleared, even when the browser rejects exitFullscreen().
 */
export async function exitPresentationFullscreen(
  documentRef: Document = document,
): Promise<FullscreenSnapshot> {
  const exitFullscreen = getExitFullscreen(documentRef);

  setPresentationActive(documentRef, false);

  if (getNativeFullscreenElement(documentRef) && exitFullscreen) {
    try {
      await exitFullscreen();
    } catch {
      // Presentation mode is still exited. Native fullscreen can only be recovered
      // by the browser when an exit request itself fails.
    }
  }

  return getFullscreenSnapshot(documentRef);
}

export function subscribeFullscreen(
  listener: (snapshot: FullscreenSnapshot) => void,
  documentRef: Document = document,
): () => void {
  let nativeSessionActive = getNativeFullscreenElement(documentRef) !== null;
  const emitPresentation = () => listener(getFullscreenSnapshot(documentRef));
  const emitNative = () => {
    const snapshot = getFullscreenSnapshot(documentRef);

    if (nativeSessionActive && !snapshot.nativeActive && snapshot.presentationActive) {
      nativeSessionActive = false;
      setPresentationActive(documentRef, false);
      return;
    }

    nativeSessionActive = snapshot.nativeActive;
    listener(snapshot);
  };

  documentRef.addEventListener("fullscreenchange", emitNative);
  documentRef.addEventListener("webkitfullscreenchange", emitNative);
  documentRef.addEventListener(PRESENTATION_CHANGE_EVENT, emitPresentation);

  return () => {
    documentRef.removeEventListener("fullscreenchange", emitNative);
    documentRef.removeEventListener("webkitfullscreenchange", emitNative);
    documentRef.removeEventListener(PRESENTATION_CHANGE_EVENT, emitPresentation);
  };
}
