import { useState } from "react";

import { getJSON, setOperatorToken } from "../api";

function OperatorUnlock({ onClose, onUnlocked }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();

    if (!token.trim() || busy) return;

    setBusy(true);
    setError("");
    setOperatorToken(token.trim());

    try {
      await getJSON("/security/status");
      onUnlocked();
    } catch {
      setOperatorToken("");
      setError("Invalid operator token.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal unlock-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <h2>Operator access</h2>
            <p>Enter the operator token from your .env file.</p>
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <input
          className="token-input"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="OPERATOR_TOKEN"
          autoFocus
          autoComplete="off"
        />

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>

          <button className="btn-primary" disabled={busy || !token.trim()}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

export default OperatorUnlock;
