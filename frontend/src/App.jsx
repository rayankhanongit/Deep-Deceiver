import { useCallback, useEffect, useState } from "react";

import Logo from "./components/Logo";

import ChatPage from "./pages/ChatPage";
import SOCPage from "./pages/SOCPage";
import SecurityPage from "./pages/SecurityPage";

import OperatorUnlock from "./components/OperatorUnlock";
import RedTeamPanel from "./components/RedTeamPanel";
import SecurityToast from "./components/SecurityToast";
import useSecurityStream from "./hooks/useSecurityStream";
import { getJSON, getOperatorToken, setOperatorToken } from "./api";

import "./App.css";
import "./ui.css";
import "./theme.css";

const OPERATOR_NAV = [
  { id: "chat", label: "LLM Interface", icon: "💬" },
  { id: "security", label: "Security Monitor", icon: "🛡" },
  { id: "soc", label: "SOC Dashboard", icon: "📊" },
];

function App() {

  const [page, setPage] = useState("chat");

  // Keep chat history at App level so it survives
  // switching between pages.
  const [messages, setMessages] = useState([]);

  // One unique session per browser conversation.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const [redTeamOpen, setRedTeamOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  // Operator mode: only a verified OPERATOR_TOKEN reveals anything about
  // the defence. Ordinary visitors get a plain chat with no security UI.
  const [operator, setOperator] = useState(false);

  // Bumped on every alert so the Security Monitor refreshes immediately.
  const [refreshKey, setRefreshKey] = useState(0);

  const { alert, connected, clearAlert } = useSecurityStream(operator);

  const [seenAlert, setSeenAlert] = useState(null);

  if (alert && alert !== seenAlert) {
    setSeenAlert(alert);
    setRefreshKey((key) => key + 1);
  }

  const lock = useCallback(() => {
    setOperatorToken("");
    setOperator(false);
    setPage("chat");
    setMessages([]);
  }, []);

  // Restore a verified operator session after a reload.
  useEffect(() => {
    if (!getOperatorToken()) return;

    getJSON("/security/status")
      .then(() => setOperator(true))
      .catch(() => setOperatorToken(""));
  }, []);

  const newChat = () => {
    setMessages([]);
    setSessionId(crypto.randomUUID());
    setPage("chat");
  };

  // Ctrl/Cmd + K: new chat.  Ctrl/Cmd + Shift + O: operator unlock/lock
  // (intentionally has no visible button).
  useEffect(() => {
    const onKey = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && event.shiftKey && key === "o") {
        event.preventDefault();

        if (operator) {
          lock();
        } else {
          setUnlockOpen(true);
        }
      } else if (mod && key === "k") {
        event.preventDefault();
        setMessages([]);
        setSessionId(crypto.randomUUID());
        setPage("chat");
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [operator, lock]);

  return (
    <div className="shell">

      <div className="aurora" aria-hidden="true" />

      <aside className="sidebar">

        <div className="brand">
          <Logo size={34} className="brand-logo" />

          <div>
            <h1>DEEP-DECEIVER</h1>
            <p>{operator ? "Operator view" : "Assistant"}</p>
          </div>
        </div>

        <button className="new-chat" onClick={newChat}>
          ＋ New chat <kbd>Ctrl K</kbd>
        </button>

        {operator && (
          <nav className="side-nav">
            {OPERATOR_NAV.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "side-link active" : "side-link"}
                onClick={() => setPage(item.id)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}

        {operator && (
          <div className="sidebar-foot">
            <div className="status">
              <span
                className={connected ? "status-dot" : "status-dot offline"}
              ></span>

              {connected ? "Live alerts connected" : "Connecting…"}
            </div>

            <button className="lock-button" onClick={lock}>
              🔒 Lock operator view
            </button>
          </div>
        )}

      </aside>


      <div className="main">

        {page === "chat" && (
          <ChatPage
            messages={messages}
            setMessages={setMessages}
            sessionId={sessionId}
            operator={operator}
            onOpenRedTeam={() => setRedTeamOpen(true)}
          />
        )}

        {operator && page === "security" && (
          <SecurityPage refreshKey={refreshKey} />
        )}

        {operator && page === "soc" && (
          <div className="page">
            <SOCPage />
          </div>
        )}

      </div>


      {unlockOpen && (
        <OperatorUnlock
          onClose={() => setUnlockOpen(false)}
          onUnlocked={() => {
            setUnlockOpen(false);
            setOperator(true);
            setMessages([]);
            setPage("security");
          }}
        />
      )}

      {operator && redTeamOpen && (
        <RedTeamPanel
          onClose={() => {
            setRedTeamOpen(false);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      {operator && (
        <SecurityToast
          alert={alert}
          onClose={clearAlert}
          onView={() => {
            clearAlert();
            setPage("security");
          }}
        />
      )}

    </div>
  );
}

export default App;
