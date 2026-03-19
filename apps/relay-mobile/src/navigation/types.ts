export type AuthStackParamList = {
  Login: undefined;
};

export type AppStackParamList = {
  Devices: undefined;
  Projects: { deviceId?: string } | undefined;
  Threads: { deviceId: string; projectId: number };
  Chat: { deviceId: string; projectId: number; threadId: number };
};
