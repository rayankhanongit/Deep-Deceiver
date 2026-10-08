import { useEffect } from "react";

import { formatTime, prettyCategory } from "../api";

function SecurityToast({ alert, onClose, onView }) {
  useEffect(() => {
    if (!alert) return undefined;

    const timer = setTimeout(onClose, 14000);

    return () => clearTimeout(timer);
  }, [alert, onClose]);

  if (!alert) return null;

  const event = alert.event;
  const critical = alert.critical;

  return (
    <div
      className={`security-toast ${critical ? "critical" : "high"}`}
      role="alert"
    >
      <div className="toast-head">
        <span className="toast-icon">⚠</span>
        <strong>SECURITY ALERT{alert.test ? " (test)" : ""}</strong>
        <button className="toast-close" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      </div>

      <div className="toast-body">
        <div>
          {event.jailbreak_success
            ? "Successful jailbreak detected."
            : "Potential jailbreak attempt detected."}
        </div>

        <div className="toast-meta">
          <span>Severity: {event.severity}</span>
          <span>Risk: {event.risk_score}</span>
          <span>{prettyCategory(event.category)}</span>
          <span>{formatTime(event.timestamp)}</span>
        </div>
      </div>

      <button className="toast-action" onClick={onView}>
        View Security Event
      </button>
    </div>
  );
}

export default SecurityToast;
