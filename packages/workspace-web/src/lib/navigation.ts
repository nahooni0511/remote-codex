import type { MouseEvent } from "react";
import type { NavigateFunction, NavigateOptions, To } from "react-router-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function viewTransitionsDisabled(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.dataset.workspaceViewTransitions === "off";
}

export function runWithViewTransition(update: () => void): void {
  const doc = document as ViewTransitionDocument;
  if (prefersReducedMotion() || viewTransitionsDisabled() || typeof doc.startViewTransition !== "function") {
    update();
    return;
  }

  doc.startViewTransition(() => {
    update();
  });
}

export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To,
  options?: NavigateOptions,
): void {
  runWithViewTransition(() => {
    navigate(to, options);
  });
}

export function isPlainLeftClick(event: MouseEvent<HTMLElement>): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  );
}
