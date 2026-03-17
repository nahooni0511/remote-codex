import type { ReactNode } from "react";
import { createContext, useContext } from "react";

const WorkspaceRailSlotContext = createContext<ReactNode>(null);

export function WorkspaceChromeProvider({
  railSlot,
  children,
}: {
  railSlot?: ReactNode;
  children: ReactNode;
}) {
  return <WorkspaceRailSlotContext.Provider value={railSlot || null}>{children}</WorkspaceRailSlotContext.Provider>;
}

export function useWorkspaceRailSlot(): ReactNode {
  return useContext(WorkspaceRailSlotContext);
}
