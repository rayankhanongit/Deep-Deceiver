import { useState } from "react";

import ChatPage from "./pages/ChatPage";
import SOCPage from "./pages/SOCPage";
import SecurityPage from "./pages/SecurityPage";

import RedTeamPanel from "./components/RedTeamPanel";
import SecurityToast from "./components/SecurityToast";
import useSecurityStream from "./hooks/useSecurityStream";

import "./App.css";
import "./ui.css";

const NAV = [
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

  // Bumped on every alert so the Security Monitor refreshes immediately.
  const [refreshKey, setRefreshKey] = useState(0);

  const { alert, connected, clearAlert } = useSecurityStream();

  const [seenAlert, setSeenAlert] = useState(null);

  if (alert && alert !== seenAlert) {
    setSeenAlert(alert);
    setRefreshKey((key) => key + 1);
  }

  const newChat = () => {
    setMessages([]);
    setSessionId(crypto.randomUUID());
    setPage("chat");
  };

  return (
    <div className="shell">

      <aside className="sidebar">

        <div className="brand">
          <span className="brand-mark">✺</span>

          <div>
            <h1>DEEP-DECEIVER</h1>
            <p>Agentic Active-Defense Framework</p>
          </div>
        </div>

        <button className="new-chat" onClick={newChat}>
          ＋ New chat
        </button>

        <nav className="side-nav">
          {NAV.map((item) => (
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

        <div className="sidebar-foot">
          <div className="status">
            <span
              className={connected ? "status-dot" : "status-dot offline"}
            ></span>

            {connected ? "System Online" : "Connecting…"}
          </div>

          <div className="foot-note">
            Real-time alerts {connected ? "connected" : "offline"}
          </div>
        </div>

      </aside>


      <div className="main">

        {page === "chat" && (
          <ChatPage
            messages={messages}
            setMessages={setMessages}
            sessionId={sessionId}
            onOpenRedTeam={() => setRedTeamOpen(true)}
          />
        )}

        {page === "security" && <SecurityPage refreshKey={refreshKey} />}

        {page === "soc" && (
          <div className="page">
            <SOCPage />
          </div>
        )}

      </div>


      {redTeamOpen && (
        <RedTeamPanel
          onClose={() => {
            setRedTeamOpen(false);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <SecurityToast
        alert={alert}
        onClose={clearAlert}
        onView={() => {
          clearAlert();
          setPage("security");
        }}
      />

    </div>
  );
}

export default App;
