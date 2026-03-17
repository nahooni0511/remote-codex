import type { ThreadComposerSettings, ThreadComposerSettingsResponse, ThreadListItem } from "@remote-codex/contracts";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../../lib/api/client";

export type ComposerSettingsPatch = {
  defaultMode?: "default" | "plan";
  modelOverride?: string | null;
  reasoningEffortOverride?: string | null;
  permissionMode?: "default" | "danger-full-access";
};

function applyComposerSettingsPatch(
  current: ThreadComposerSettings,
  patch: ComposerSettingsPatch,
): ThreadComposerSettings {
  return {
    defaultMode: patch.defaultMode ?? current.defaultMode,
    modelOverride: patch.modelOverride === undefined ? current.modelOverride : patch.modelOverride,
    reasoningEffortOverride:
      patch.reasoningEffortOverride === undefined ? current.reasoningEffortOverride : patch.reasoningEffortOverride,
    permissionMode: patch.permissionMode ?? current.permissionMode,
  };
}

export function useChatComposerSettings(refreshBootstrap: () => Promise<unknown>) {
  const [composerSettingsDrafts, setComposerSettingsDrafts] = useState<Record<number, ThreadComposerSettings>>({});
  const composerSettingsDraftsRef = useRef(composerSettingsDrafts);
  const composerSettingsSyncRef = useRef<Record<number, Promise<void>>>({});

  useEffect(() => {
    composerSettingsDraftsRef.current = composerSettingsDrafts;
  }, [composerSettingsDrafts]);

  const updateComposerSettings = async (thread: ThreadListItem, patch: ComposerSettingsPatch) => {
    const currentSettings = composerSettingsDraftsRef.current[thread.id] || thread.composerSettings;
    const nextSettings = applyComposerSettingsPatch(currentSettings, patch);

    setComposerSettingsDrafts((current) => ({
      ...current,
      [thread.id]: nextSettings,
    }));

    const previousTask = composerSettingsSyncRef.current[thread.id] || Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(async () => {
        await apiFetch<ThreadComposerSettingsResponse>(`/api/threads/${thread.id}/composer-settings`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        await refreshBootstrap();
        setComposerSettingsDrafts((current) => {
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
      })
      .catch((error) => {
        setComposerSettingsDrafts((current) => {
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
        throw error;
      })
      .finally(() => {
        if (composerSettingsSyncRef.current[thread.id] === nextTask) {
          delete composerSettingsSyncRef.current[thread.id];
        }
      });

    composerSettingsSyncRef.current[thread.id] = nextTask;
    await nextTask;
  };

  return {
    composerSettingsDrafts,
    composerSettingsSyncRef,
    updateComposerSettings,
  };
}
