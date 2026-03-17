import type { ThreadMode } from "./core";
import type { MessageEventDeliveryRecord, MessageEventRecord } from "./messaging";

export interface CodexPlanStep {
  step: string;
  status: string;
}

export interface ThreadStreamRealtimeEvent {
  type: string;
  text?: string;
  phase?: string | null;
  explanation?: string | null;
  plan?: CodexPlanStep[];
}

export interface ThreadLiveStreamSnapshot {
  reasoningText: string;
  assistantText: string;
  planText: string;
}

export type RealtimeEvent =
  | {
      type: "connected";
    }
  | {
      type: "workspace-updated";
      projectId?: number | null;
      threadId?: number | null;
    }
  | {
      type: "thread-messages-updated";
      threadId: number;
    }
  | {
      type: "thread-turn-state";
      threadId: number;
      running: boolean;
      queueDepth: number;
      mode: ThreadMode;
    }
  | {
      type: "thread-stream-event";
      threadId: number;
      event: ThreadStreamRealtimeEvent;
    }
  | {
      type: "message-event-created";
      threadId: number;
      event: MessageEventRecord;
    }
  | {
      type: "message-event-updated";
      threadId: number;
      event: MessageEventRecord;
    }
  | {
      type: "delivery-state-changed";
      threadId: number;
      delivery: MessageEventDeliveryRecord;
    };
