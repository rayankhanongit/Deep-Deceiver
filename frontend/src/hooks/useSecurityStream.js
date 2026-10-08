import { useEffect, useState } from "react";

import { API } from "../api";

/**
 * Subscribes to the backend's Server-Sent Events stream and exposes the
 * most recent HIGH / CRITICAL alert. EventSource reconnects automatically.
 */
export default function useSecurityStream() {
  const [alert, setAlert] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let source;

    try {
      source = new EventSource(`${API}/security/stream`);
    } catch {
      return undefined;
    }

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);

        if (payload.type === "security_alert") {
          setAlert({ ...payload, receivedAt: Date.now() });
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => source.close();
  }, []);

  return { alert, connected, clearAlert: () => setAlert(null) };
}
