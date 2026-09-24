import { createContext } from "preact";
import type { BrowserClient } from "../browser/client";
import type {
  VisibilityObserverHandle,
  VisibilityTargetOptions,
} from "../browser/visibility-observer";

export type TrackingVisibility = {
  observe(target: Element, options: VisibilityTargetOptions): VisibilityObserverHandle;
  confirmImpression(subjectKey: string): void;
  cancelImpression(subjectKey: string): void;
};

export type TrackingContextValue = {
  readonly client: BrowserClient;
  readonly visibility: TrackingVisibility;
};

export const TrackingContext = createContext<TrackingContextValue | undefined>(undefined);
