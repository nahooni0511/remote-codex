import { useEffect, useRef } from "react";

type RealtimeConnection = {
  close: () => void;
};

type UseRealtimeConnectionOptions = {
  connect: () => Promise<RealtimeConnection>;
  onRetry: () => void;
};

export function useRealtimeConnection({ connect, onRetry }: UseRealtimeConnectionOptions) {
  const connectRef = useRef(connect);
  const onRetryRef = useRef(onRetry);

  useEffect(() => {
    connectRef.current = connect;
    onRetryRef.current = onRetry;
  }, [connect, onRetry]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let currentConnection: RealtimeConnection | null = null;

    const scheduleRetry = () => {
      if (cancelled) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        startConnection();
      }, 1500);
    };

    const startConnection = () => {
      if (cancelled) {
        return;
      }

      void connectRef.current()
        .then((connection) => {
          if (cancelled) {
            connection.close();
            return;
          }

          currentConnection = connection;
        })
        .catch(() => {
          onRetryRef.current();
          scheduleRetry();
        });
    };

    startConnection();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      currentConnection?.close();
    };
  }, []);
}
