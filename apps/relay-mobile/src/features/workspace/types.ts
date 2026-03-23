import type { IMessage } from "react-native-gifted-chat";

import type { WorkspaceThreadMessage } from "../../types";

export type WorkspaceRoutePhase = "connecting" | "ready" | "blocked" | "error";

export type ComposerSheet = "model" | "effort" | "access" | null;

export type GiftedRelayMessage =
  | (IMessage & {
      kind: "history";
      record: WorkspaceThreadMessage;
    })
  | (IMessage & {
      kind: "live-plan" | "live-reasoning" | "live-assistant";
      liveText: string;
    });
