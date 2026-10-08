import { useCallback, useEffect, useMemo, useState } from "react";

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
import "./conversations.css";

const OPERATOR_NAV = [
  { id: "chat", label: "LLM Interface", icon: "💬" },
  { id: "security", label: "Security Monitor", icon: "🛡" },
  { id: "soc", label: "SOC Dashboard", icon: "📊" },
];

const STORE_KEY = "dd_conversations_v1";
const NEW_TITLE = "New chat";

function newConversation() {
  return {
    id: crypto.randomUUID(),
    title: NEW_TITLE,
    messages: [],
    updatedAt: Date.now(),
  };
}

/** Only plain chat content is persisted; security details never are. */
function toStorable(conversations) {
  return conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    messages: c.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.error ? { error: true } : {}),
    })),
  }));
}

function loadConversations() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");

    if (Array.isArray(raw) && raw.length > 0) {
      return raw;
    }
  } catch {
    /* corrupt or unavailable storage */
  }

  return [newConversation()];
}

function groupLabel(timestamp) {
  const day = 86400000;
  const age = Date.now() - timestamp;

  if (age < day) return "Today";
  if (age < 2 * day) return "Yesterday";
  if (age < 7 * day) return "Previous 7 days";

  return "Older";
}

function App() {

  const [page, setPage] = useState("chat");

  // Conversations live at App level and are saved in this browser, so
  // they survive page switches and reloads. Each conversation id doubles as
  // the backend session id.
  const [conversations, setConversations] = useState(loadConversations);
  const [activeId, setActiveId] = useState(() => loadConversations()[0].id);

  const active = conversations.find((c) => c.id === activeId) || conversations[0];
  const sessionId = active.id;
  const messages = active.messages;

  const setMessages = useCallback(
    (updater) =>
      setConversations((list) =>
        list.map((c) => {
          if (c.id !== activeId) return c;

          const next = typeof updater === "function" ? updater(c.messages) : updater;
          const firstUser = next.find((m) => m.role === "user");

          return {
            ...c,
            messages: next,
            updatedAt: Date.now(),
            title:
              c.title === NEW_TITLE && firstUser
                ? firstUser.content.slice(0, 42)
                : c.title,
          };
        })
      ),
    [activeId]
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(toStorable(conversations)));
    } catch {
      /* storage full or unavailable */
    }
  }, [conversations]);

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
  }, []);

  // Restore a verified operator session after a reload.
  useEffect(() => {
    if (!getOperatorToken()) return;

    getJSON("/security/status")
      .then(() => setOperator(true))
      .catch(() => setOperatorToken(""));
  }, []);

  const newChat = useCallback(() => {
    // Reuse an existing empty conversation instead of piling up blanks.
    const empty = conversations.find((c) => c.messages.length === 0);

    if (empty) {
      setActiveId(empty.id);
    } else {
      const fresh = newConversation();
      setConversations((list) => [fresh, ...list]);
      setActiveId(fresh.id);
    }

    setPage("chat");
  }, [conversations]);

  const openConversation = (id) => {
    setActiveId(id);
    setPage("chat");
  };

  const deleteConversation = (id) => {
    const rest = conversations.filter((c) => c.id !== id);
    const list = rest.length ? rest : [newConversation()];

    setConversations(list);

    if (id === activeId) {
      setActiveId(list[0].id);
    }
  };

  const grouped = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const groups = [];

    for (const conversation of sorted) {
      if (conversation.messages.length === 0 && conversation.id !== activeId) continue;

      const label = groupLabel(conversation.updatedAt);
      const last = groups[groups.length - 1];

      if (last && last.label === label) {
        last.items.push(conversation);
      } else {
        groups.push({ label, items: [conversation] });
      }
    }

    return groups;
  }, [conversations, activeId]);

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
        newChat();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [operator, lock, newChat]);

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

        <div className="chat-list">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="chat-group">{group.label}</div>

              {group.items.map((c) => (
                <div
                  key={c.id}
                  className={
                    c.id === activeId && page === "chat"
                      ? "chat-item active"
                      : "chat-item"
                  }
                >
                  <button
                    className="chat-item-title"
                    onClick={() => openConversation(c.id)}
                    title={c.title}
                  >
                    {c.title}
                  </button>

                  <button
                    className="chat-item-delete"
                    onClick={() => deleteConversation(c.id)}
                    aria-label="Delete chat"
                    title="Delete chat"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

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
            key={sessionId}
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
