import { useCallback, useEffect, useRef, useState } from "react";

import { formatTime, getJSON, postJSON, prettyCategory } from "../api";

const OUTCOME_LABEL = {
  BLOCKED: "Attack blocked",
  SUCCESS: "Jailbreak success",
  SUSPICIOUS: "Suspicious",
  ATTEMPT: "Attempt",
};

/** Animates a number from its previous value to the new one. */
function CountUp({ value, suffix = "" }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - t, 3);

      setShown(origin + (target - origin) * eased);

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        from.current = target;
      }
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [target]);

  const digits = Number.isInteger(target) ? 0 : 1;

  return (
    <>
      {shown.toFixed(digits)}
      {suffix}
    </>
  );
}

function Metric({ label, value, tone, hint, suffix }) {
  return (
    <div className={`metric ${tone || ""}`} title={hint}>
      <span>{label}</span>
      <strong>
        <CountUp value={value} suffix={suffix} />
      </strong>
    </div>
  );
}

function RiskRing({ value, level }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, value) / 100);

  return (
    <div className="risk-ring">
      <svg viewBox="0 0 140 140" width="140" height="140">
        <circle cx="70" cy="70" r={radius} className="ring-track" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          className={`ring-fill ring-${level}`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
        />
      </svg>

      <div className="ring-label">
        <strong>
          <CountUp value={value} />
        </strong>
        <span>avg risk</span>
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`sec-event sev-border-${event.severity}`}>
      <button className="sec-event-head" onClick={() => setOpen(!open)}>
        <span className={`badge sev-${event.severity}`}>{event.severity}</span>

        <span className="sec-event-summary">{event.summary}</span>

        <span className={`outcome outcome-${event.outcome}`}>
          {OUTCOME_LABEL[event.outcome] || event.outcome}
        </span>

        <span className="sec-event-risk">{event.risk_score}</span>

        <span className="sec-event-time">{formatTime(event.timestamp)}</span>
      </button>

      {open && (
        <div className="sec-event-body">
          <dl>
            <dt>Category</dt>
            <dd>{prettyCategory(event.category)}</dd>

            <dt>Source</dt>
            <dd>
              {event.source === "red_team"
                ? `Red Team (assessment ${event.assessment_id})`
                : `Chat (session ${String(event.session_id).slice(0, 8)})`}
            </dd>

            <dt>Confidence</dt>
            <dd>{Math.round(event.confidence * 100)}%</dd>

            <dt>Model resisted</dt>
            <dd>
              {event.model_resisted === null
                ? "unknown"
                : event.model_resisted
                ? "yes"
                : "no"}
            </dd>

            <dt>Host alert</dt>
            <dd>{event.alert_triggered ? "sent" : "not triggered"}</dd>

            {event.details?.reason && (
              <>
                <dt>Reason</dt>
                <dd>{event.details.reason}</dd>
              </>
            )}

            {event.details?.prompt_excerpt && (
              <>
                <dt>Prompt (redacted)</dt>
                <dd className="rt-quote">{event.details.prompt_excerpt}</dd>
              </>
            )}

            {event.details?.response_excerpt && (
              <>
                <dt>Response (redacted)</dt>
                <dd className="rt-quote">{event.details.response_excerpt}</dd>
              </>
            )}

            <dt>Event ID</dt>
            <dd className="mono">{event.event_id}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function SecurityPage({ refreshKey }) {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const query =
        filter === "ALL" ? "" : `&min_severity=${filter.toLowerCase()}`;

      const [statsData, eventsData] = await Promise.all([
        getJSON("/security/stats"),
        getJSON(`/security/events?limit=100${query}`),
      ]);

      setStats(statsData);
      setEvents(eventsData.events);
      setError("");
    } catch {
      setError("Unable to load security data. Is the backend running?");
    }
  }, [filter]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 5000);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, refreshKey]);

  const sendTest = async () => {
    setTesting(true);

    try {
      await postJSON("/security/alerts/test");
    } catch {
      setError("Test alert failed.");
    } finally {
      setTesting(false);
    }
  };

  if (!stats) {
    return (
      <main className="page">
        <div className="page-inner">
          <div className="soc-loading">
            {error || "Loading security monitor…"}
          </div>
        </div>
      </main>
    );
  }

  const threat = stats.current_threat_level;

  return (
    <main className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Security Monitor</h1>
            <p>Jailbreak detection, risk scoring and Red Team results.</p>
          </div>

          <div className="page-head-actions">
            <button className="btn-secondary" onClick={sendTest} disabled={testing}>
              Send test host alert
            </button>

            <button className="btn-secondary" onClick={load}>
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="status-banner">
          <div>
            <span className="status-label">System status</span>

            <strong
              className={
                stats.system_status === "PROTECTED" ? "status-ok" : "status-bad"
              }
            >
              ● {stats.system_status}
            </strong>
          </div>

          <div>
            <span className="status-label">Current threat level (15 min)</span>
            <strong className={`sev-text-${threat}`}>{threat}</strong>
          </div>
        </div>

        <div className="metrics">
          <Metric
            label="Total Attempts"
            value={stats.total_attempts}
            hint="All detected attack attempts, chat and Red Team"
          />
          <Metric
            label="Blocked Attempts"
            value={stats.blocked_attempts}
            tone="good"
          />
          <Metric
            label="Successful Jailbreaks"
            value={stats.successful_jailbreaks}
            tone={stats.successful_jailbreaks ? "bad" : ""}
          />
          <Metric label="High Risk Events" value={stats.high_risk_events} />
          <Metric
            label="Critical Events"
            value={stats.critical_events}
            tone={stats.critical_events ? "bad" : ""}
          />
          <Metric label="Average Risk Score" value={stats.average_risk_score} />
          <Metric
            label="Model Robustness"
            value={stats.model_robustness}
            suffix="%"
            hint="Blocked / (blocked + suspicious + successful)"
          />
          <Metric
            label="Jailbreak Success Rate"
            value={stats.jailbreak_success_rate}
            suffix="%"
          />
        </div>

        <section className="panel overview">
          <RiskRing
            value={stats.average_risk_score}
            level={
              stats.average_risk_score > 80
                ? "CRITICAL"
                : stats.average_risk_score > 60
                ? "HIGH"
                : stats.average_risk_score > 40
                ? "MEDIUM"
                : "LOW"
            }
          />

          <div className="category-bars">
            <h2>Attack categories</h2>

            {Object.keys(stats.by_category).length === 0 && (
              <div className="empty-inline">No attacks recorded yet.</div>
            )}

            {Object.entries(stats.by_category)
              .sort((a, b) => b[1] - a[1])
              .map(([category, count]) => (
                <div className="cat-row" key={category}>
                  <span>{prettyCategory(category)}</span>

                  <div className="cat-track">
                    <div
                      className="cat-fill"
                      style={{
                        width: `${(count / stats.total_attempts) * 100}%`,
                      }}
                    />
                  </div>

                  <b>{count}</b>
                </div>
              ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Recent Security Events</h2>

            <div className="filters">
              {["ALL", "MEDIUM", "HIGH", "CRITICAL"].map((level) => (
                <button
                  key={level}
                  className={filter === level ? "chip active" : "chip"}
                  onClick={() => setFilter(level)}
                >
                  {level === "ALL" ? "All" : `${level}+`}
                </button>
              ))}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="empty-state">
              No security events yet. Send a jailbreak attempt in the chat or
              run a Red Team assessment.
            </div>
          ) : (
            <div className="sec-events">
              {events.map((event) => (
                <EventRow key={event.event_id} event={event} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default SecurityPage;
