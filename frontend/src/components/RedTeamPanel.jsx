import { useCallback, useEffect, useRef, useState } from "react";

import { getJSON, postJSON, prettyCategory } from "../api";

const STATUS_LABEL = {
  BLOCKED: "BLOCKED",
  SUSPICIOUS: "SUSPICIOUS",
  SUCCESSFUL: "SUCCESSFUL",
  ERROR: "ERROR",
};

function Finding({ finding }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rt-finding status-${finding.status}`}>
      <button className="rt-finding-head" onClick={() => setOpen(!open)}>
        <span className="rt-finding-index">{finding.index}.</span>

        <span className="rt-finding-title">
          {prettyCategory(finding.category)}
        </span>

        <span className={`badge sev-${finding.severity}`}>
          {finding.severity}
        </span>

        <span className="rt-finding-conf">
          {Math.round(finding.confidence * 100)}%
        </span>

        <span className={`rt-status ${finding.status}`}>
          {STATUS_LABEL[finding.status] || finding.status}
        </span>

        <span className="rt-chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="rt-finding-body">
          <dl>
            <dt>Objective</dt>
            <dd>{finding.objective}</dd>

            <dt>Expected behaviour</dt>
            <dd>{finding.expected_behavior}</dd>

            <dt>Evaluation</dt>
            <dd>
              {finding.classification} · risk {finding.risk_score}/100
              {finding.judge_used ? " · AI-judged" : ""}
            </dd>

            <dt>Reason</dt>
            <dd>{finding.reason}</dd>

            {finding.violated_boundary && (
              <>
                <dt>Violated boundary</dt>
                <dd>{finding.violated_boundary}</dd>
              </>
            )}

            <dt>Test prompt (redacted)</dt>
            <dd className="rt-quote">{finding.prompt_excerpt}</dd>

            <dt>Model response (redacted)</dt>
            <dd className="rt-quote">{finding.response_excerpt || "—"}</dd>

            <dt>Escalation level</dt>
            <dd>
              {finding.level + 1}
              {finding.turns > 1 ? ` · ${finding.turns} turns` : ""}
              {finding.alert_triggered ? " · alert raised" : ""}
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function RedTeamPanel({ onClose }) {
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState("standard");
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");

  const [assessmentId, setAssessmentId] = useState(null);
  const [view, setView] = useState(null);

  const pollRef = useRef(null);

  useEffect(() => {
    getJSON("/red-team/config")
      .then((data) => {
        setConfig(data);
        setSelected(data.categories.map((c) => c.id));
      })
      .catch(() => setError("Unable to reach the backend."));
  }, []);

  const poll = useCallback(async (id) => {
    try {
      const data = await getJSON(`/red-team/${id}`);

      setView(data);

      if (data.status !== "running") {
        clearInterval(pollRef.current);
      }
    } catch {
      clearInterval(pollRef.current);
      setError("Lost connection to the assessment.");
    }
  }, []);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const start = async () => {
    setError("");

    try {
      const data = await postJSON("/red-team/start", {
        mode,
        categories: selected,
      });

      setAssessmentId(data.assessment_id);
      setView(null);

      clearInterval(pollRef.current);
      poll(data.assessment_id);
      pollRef.current = setInterval(() => poll(data.assessment_id), 1000);
    } catch (err) {
      setError(err.message);
    }
  };

  const stop = async () => {
    try {
      await postJSON(`/red-team/${assessmentId}/stop`);
    } catch (err) {
      setError(err.message);
    }
  };

  const reset = () => {
    clearInterval(pollRef.current);
    setAssessmentId(null);
    setView(null);
    setError("");
  };

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );

  const running = view?.status === "running";
  const finished = view && view.status !== "running";
  const report = view?.report;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal rt-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Red Team Assessment"
      >
        <div className="modal-head">
          <div>
            <h2>
              {finished ? "Red Team Assessment Complete" : "Red Team Assessment"}
            </h2>

            <p>
              Adaptive adversarial testing of this application&apos;s own
              model. Nothing leaves the app.
            </p>
          </div>

          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {/* ---------------- configuration ---------------- */}

        {!assessmentId && config && (
          <>
            <section>
              <h3>Target</h3>
              <div className="rt-target">Current AI Model (DEEP-DECEIVER Protected LLM)</div>
            </section>

            <section>
              <h3>Assessment Mode</h3>

              <div className="rt-modes">
                {config.modes.map((m) => (
                  <label
                    key={m.id}
                    className={`rt-mode ${mode === m.id ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === m.id}
                      onChange={() => setMode(m.id)}
                    />

                    <strong>
                      {m.id === "quick"
                        ? "Quick Scan"
                        : m.id === "deep"
                        ? "Deep Assessment"
                        : "Standard"}
                    </strong>

                    <span>{m.tests} tests</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3>Attack Categories</h3>

              <div className="rt-categories">
                {config.categories.map((c) => (
                  <label key={c.id} className="rt-category" title={c.description}>
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>

              <button
                className="btn-primary"
                onClick={start}
                disabled={selected.length === 0 || !config.enabled}
              >
                START ASSESSMENT
              </button>
            </div>

            {!config.enabled && (
              <div className="form-error">
                Red Team is disabled (RED_TEAM_ENABLED=false).
              </div>
            )}
          </>
        )}

        {!assessmentId && !config && !error && (
          <div className="rt-loading">Loading…</div>
        )}

        {/* ---------------- progress / results ---------------- */}

        {assessmentId && (
          <>
            {running && (
              <div className="rt-progress">
                <div className="rt-progress-label">
                  <span>
                    Running {view.mode} assessment… test{" "}
                    {view.progress.executed} of {view.progress.planned}
                  </span>
                  <button className="btn-secondary small" onClick={stop}>
                    Stop
                  </button>
                </div>

                <div className="rt-bar">
                  <div
                    className="rt-bar-fill"
                    style={{
                      width: `${
                        (view.progress.executed / view.progress.planned) * 100
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}

            {!view && <div className="rt-loading">Starting assessment…</div>}

            {finished && report && (
              <>
                {view.status === "failed" && (
                  <div className="form-error">
                    The assessment failed ({view.error}). Partial results are
                    shown below.
                  </div>
                )}

                <div className="rt-summary">
                  <div className="rt-stat">
                    <span>Tests Executed</span>
                    <strong>{report.tests_executed}</strong>
                  </div>

                  <div className="rt-stat good">
                    <span>Blocked</span>
                    <strong>{report.blocked}</strong>
                  </div>

                  <div className="rt-stat warn">
                    <span>Suspicious</span>
                    <strong>{report.suspicious}</strong>
                  </div>

                  <div className="rt-stat bad">
                    <span>Successful</span>
                    <strong>{report.successful}</strong>
                  </div>

                  <div className="rt-stat">
                    <span>Overall Risk</span>
                    <strong className={`sev-text-${report.overall_risk}`}>
                      {report.overall_risk}
                    </strong>
                  </div>

                  <div className="rt-stat">
                    <span>Model Robustness</span>
                    <strong>{report.model_robustness}%</strong>
                  </div>
                </div>

                <div className="rt-note">
                  {report.stop_reason === "stopped_by_user" && "Stopped by user. "}
                  {report.stop_reason === "timeout" && "Stopped at the time limit. "}
                  {report.stop_reason === "critical_finding" &&
                    "Stopped after a critical finding. "}
                  {report.alerts_triggered > 0 &&
                    `${report.alerts_triggered} host alert(s) raised. `}
                  Duration {report.duration_seconds ?? "—"}s · Risk score{" "}
                  {report.overall_risk_score}/100
                </div>
              </>
            )}

            {view && view.findings.length > 0 && (
              <section>
                <h3>Findings</h3>

                <div className="rt-findings">
                  {view.findings.map((finding) => (
                    <Finding key={finding.index} finding={finding} />
                  ))}
                </div>
              </section>
            )}

            {finished && (
              <div className="modal-actions">
                <button className="btn-secondary" onClick={reset}>
                  New assessment
                </button>

                <button className="btn-primary" onClick={onClose}>
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default RedTeamPanel;
