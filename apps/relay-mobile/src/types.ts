export type WorkspaceProject = {
  id: number;
  name: string;
  threads: Array<{ id: number; title: string }>;
};

export type WorkspaceThreadMessage = {
  id: number;
  role: string;
  content: string;
};
