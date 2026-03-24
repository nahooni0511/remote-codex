import { useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { WorkspaceFrame } from "../components/layout/WorkspaceFrame";
import { ProjectFilePicker } from "../components/ui/ProjectFilePicker";
import { EmptyState } from "../components/ui/EmptyState";
import { ChatSidebar } from "../features/chat/ChatSidebar";
import type { ChatNotice } from "../features/chat/notice";
import { cx } from "../lib/classNames";
import { buildProjectPath, getFallbackChatPath, getNewProjectPath } from "../lib/routes";
import { getWorkspaceUserName } from "../lib/workspace";
import { resolveChatSelection } from "./chat/chatSelection";
import { ProjectChatView } from "./chat/ProjectChatView";
import { ThreadChatView } from "./chat/ThreadChatView";
import { useChatComposerSettings } from "./chat/useChatComposerSettings";
import { useProjectGitState } from "./chat/useProjectGitState";
import { useProjectViewController } from "./chat/useProjectViewController";
import { useThreadViewController } from "./chat/useThreadViewController";
import styles from "./ChatPage.module.css";

export function ChatPage() {
  const location = useLocation();
  const params = useParams();
  const {
    bootstrap,
    loading,
    loadError,
    refreshBootstrap,
    loadThreadMessages,
    threadCache,
    threadRuntimeStates,
    liveStreams,
  } = useAppContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [threadNotice, setThreadNotice] = useState<ChatNotice>(null);
  const isNewProjectRoute = location.pathname === getNewProjectPath();
  const selection = bootstrap ? resolveChatSelection(bootstrap, params.projectId, params.threadId) : { project: null, thread: null };
  const projectController = useProjectViewController({
    bootstrap,
    project: selection.project,
    thread: selection.thread,
    projectIdParam: params.projectId,
    isNewProjectRoute,
    refreshBootstrap,
  });
  const { composerSettingsDrafts, composerSettingsSyncRef, updateComposerSettings } =
    useChatComposerSettings(refreshBootstrap);
  const renderedThread =
    selection.thread && composerSettingsDrafts[selection.thread.id]
      ? {
          ...selection.thread,
          composerSettings: composerSettingsDrafts[selection.thread.id],
        }
      : selection.thread;
  const authUserName = bootstrap ? getWorkspaceUserName(bootstrap) : "";
  const modelOptions = bootstrap?.configOptions.codexModels || [];
  const threadEntry = renderedThread ? threadCache[renderedThread.id] : undefined;
  const { gitState, refreshProjectGitState } = useProjectGitState({
    bootstrapReady: Boolean(bootstrap),
    project: selection.project,
    thread: renderedThread,
    onError: setThreadNotice,
  });
  const threadController = useThreadViewController({
    bootstrap,
    project: selection.project,
    renderedThread,
    messages: threadEntry?.messages || [],
    hasMoreBefore: Boolean(threadEntry?.hasMoreBefore),
    liveStream: renderedThread ? liveStreams[renderedThread.id] : undefined,
    authUserName,
    modelOptions,
    gitState,
    threadRuntimeState: renderedThread ? threadRuntimeStates[renderedThread.id] : undefined,
    threadNotice,
    setThreadNotice,
    refreshBootstrap,
    loadThreadMessages,
    updateComposerSettings,
    composerSettingsSyncRef,
    refreshProjectGitState,
    onProjectNotice: projectController.setProjectNotice,
  });

  useEffect(() => {
    if (!bootstrap || !selection.thread || threadCache[selection.thread.id]) {
      return;
    }

    void loadThreadMessages(selection.thread.id).catch((error: Error) => {
      setThreadNotice({ tone: "error", message: error.message });
    });
  }, [bootstrap, loadThreadMessages, selection.thread, threadCache]);

  if (loading) {
    return <EmptyState title="Loading workspace" description="Bootstrap and project state are loading." />;
  }

  if (loadError) {
    return <EmptyState title="Loading failed" description={loadError} />;
  }

  if (!bootstrap) {
    return <EmptyState title="Workspace unavailable" description="Bootstrap payload is missing." />;
  }

  if (!isNewProjectRoute && params.projectId === undefined && params.threadId === undefined) {
    return <Navigate to={getFallbackChatPath(bootstrap)} replace />;
  }

  const { project, thread } = selection;

  if (params.projectId !== "new" && params.projectId && !project) {
    return <Navigate to={getFallbackChatPath(bootstrap)} replace />;
  }

  if (params.threadId && !thread) {
    return <Navigate to={project ? buildProjectPath(project.id) : getFallbackChatPath(bootstrap)} replace />;
  }

  const selectedThreadId = thread?.id || null;
  const isProjectInfoView = isNewProjectRoute || Boolean(project && !thread);
  const isThreadView = Boolean(project && renderedThread);

  let content: React.ReactNode;

  if (isNewProjectRoute || (project && !thread)) {
    content = (
      <ProjectChatView
        project={project}
        isNew={isNewProjectRoute}
        draft={projectController.projectDraft}
        notice={projectController.projectNotice}
        folderBrowserOpen={projectController.folderBrowserOpen}
        onDraftChange={projectController.setProjectDraft}
        onOpenFolderBrowser={() => projectController.setFolderBrowserOpen(true)}
        onCloseFolderBrowser={() => projectController.setFolderBrowserOpen(false)}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onSave={projectController.saveProject}
        onCancel={projectController.cancelProjectEdit}
        onDelete={projectController.deleteProject}
        onCreateThread={() => {
          if (!project) {
            return;
          }

          projectController.setProjectNotice(null);
          projectController.createThreadInProject(project.id, (error) => {
            projectController.setProjectNotice({ tone: "error", message: error.message });
          });
        }}
      />
    );
  } else if (threadController.threadViewProps && threadController.attachmentPickerProps) {
    content = (
      <>
        <ThreadChatView {...threadController.threadViewProps} />
        <ProjectFilePicker {...threadController.attachmentPickerProps} />
      </>
    );
  } else {
    content = (
      <EmptyState title="프로젝트를 선택하세요" description="좌측 사이드바에서 project를 고르거나 새 project를 생성하세요." />
    );
  }

  return (
    <WorkspaceFrame
      section="chat"
      userName={authUserName}
      sidebar={
        <ChatSidebar
          projects={bootstrap.projects}
          selectedProjectId={project?.id || null}
          selectedThreadId={selectedThreadId}
          expandedProjectIds={projectController.expandedProjectIds}
          onToggleProject={(projectId) =>
            projectController.setExpandedProjectIds((current) => ({ ...current, [projectId]: !current[projectId] }))
          }
          onCreateThread={(projectId) => {
            projectController.setProjectNotice(null);
            projectController.createThreadInProject(projectId, (error) => {
              projectController.setProjectNotice({ tone: "error", message: error.message });
            });
          }}
        />
      }
      sidebarOpen={sidebarOpen}
      onSidebarClose={() => setSidebarOpen(false)}
    >
      <div
        className={cx(
          styles.page,
          isThreadView && styles.threadPage,
          isProjectInfoView && styles.projectPage,
          !isThreadView && !isProjectInfoView && styles.emptyPage,
        )}
      >
        {content}
      </div>
    </WorkspaceFrame>
  );
}
