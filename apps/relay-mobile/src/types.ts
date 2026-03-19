export type WorkspaceProject = {
  id: number;
  name: string;
  folderPath: string;
  threads: Array<{ id: number; title: string }>;
};

export type WorkspaceThreadMessage = {
  id: number;
  role: string;
  content: string;
};
