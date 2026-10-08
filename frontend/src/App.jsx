import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  LayoutDashboard,
  Lock,
  Menu,
  MessageSquare,
  Plus,
  Radar,
  Trash2,
  X,
} from "lucide-react";

import Logo from "./components/Logo";
import ChatPage from "./pages/ChatPage";
import OperatorUnlock from "./components/OperatorUnlock";
import SecurityToast from "./components/SecurityToast";
import Button from "./components/ui/Button";
import useSecurityStream from "./hooks/useSecurityStream";
import { getJSON, getOperatorToken, setOperatorToken } from "./api";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/app.css";
import "./styles/polish.css";

// Operator-only screens are code-split: ordinary visitors never download them.
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const SOCPage = lazy(() => import("./pages/SOCPage"));
const RedTeamPanel = lazy(() => import("./components/RedTeamPanel"));

const OPERATOR_NAV = [
  { id: "chat", label: "Assistant", Icon: MessageSquare },
  { id: "security", label: "Security Monitor", Icon: Radar },
  { id: "soc", label: "SOC Dashboard", Icon: LayoutDashboard },
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Destructive actions need a second click (auto-cancels after 4 s).
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    if (!confirmId) return undefined;

    const timer = setTimeout(() => setConfirmId(null), 4000);

    return () => clearTimeout(timer);
  }, [confirmId]);

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
    setDrawerOpen(false);
  }, [conversations]);

  const openConversation = (id) => {
    setActiveId(id);
    setPage("chat");
    setDrawerOpen(false);
  };

  const deleteConversation = (id) => {
    setConfirmId(null);

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
  // (intentionally has no visible button).  Escape closes the drawer.
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
      } else if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [operator, lock, newChat]);

  const closeRedTeam = useCallback(() => {
    setRedTeamOpen(false);
    setRefreshKey((key) => key + 1);
  }, []);

  return (
    <div className="shell">

      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <Button
          variant="ghost"
          size="icon"
          icon={Menu}
          label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
          onClick={() => setDrawerOpen(true)}
        />

        <div className="topbar-brand">
          <Logo size={24} />
          <span translate="no">DEEP-DECEIVER</span>
        </div>
      </header>

      {drawerOpen && (
        <button
          type="button"
          className="scrim"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation"
          tabIndex={-1}
        />
      )}

      <aside
        id="sidebar"
        className={drawerOpen ? "sidebar open" : "sidebar"}
        aria-label="Navigation"
      >

        <div className="brand">
          <Logo size={30} />

          <div>
            <strong translate="no">DEEP-DECEIVER</strong>
            <span>{operator ? "Operator view" : "Assistant"}</span>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-icon drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <Button variant="secondary" icon={Plus} className="new-chat" onClick={newChat}>
          New chat <kbd>Ctrl&nbsp;K</kbd>
        </Button>

        {operator && (
          <nav className="side-nav" aria-label="Sections">
            {OPERATOR_NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={page === id ? "side-link active" : "side-link"}
                aria-current={page === id ? "page" : undefined}
                onClick={() => {
                  setPage(id);
                  setDrawerOpen(false);
                }}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
        )}

        <nav className="chat-list" aria-label="Chats">
          {grouped.map((group) => (
            <div key={group.label}>
              <h2 className="chat-group">{group.label}</h2>

              {group.items.map((c) => {
                const current = c.id === activeId && page === "chat";

                return (
                  <div key={c.id} className={current ? "chat-item active" : "chat-item"}>
                    <button
                      type="button"
                      className="chat-item-title"
                      aria-current={current ? "page" : undefined}
                      onClick={() => openConversation(c.id)}
                      title={c.title}
                    >
                      {c.title}
                    </button>

                    {confirmId === c.id ? (
                      <button
                        type="button"
                        className="chat-item-delete confirm"
                        onClick={() => deleteConversation(c.id)}
                        aria-label={`Confirm delete chat: ${c.title}`}
                      >
                        <Check size={14} aria-hidden="true" /> Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="chat-item-delete"
                        onClick={() => setConfirmId(c.id)}
                        aria-label={`Delete chat: ${c.title}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {operator && (
          <div className="sidebar-foot">
            <div className="live" role="status">
              <span className={connected ? "live-dot on" : "live-dot"} aria-hidden="true" />
              {connected ? "Live alerts connected" : "Connecting to alerts…"}
            </div>

            <Button variant="ghost" size="sm" icon={Lock} onClick={lock}>
              Lock operator view
            </Button>
          </div>
        )}

      </aside>


      <main id="main" className="main" tabIndex="-1">

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

        <Suspense fallback={<div className="page-loading" role="status">Loading…</div>}>
          {operator && page === "security" && (
            <SecurityPage refreshKey={refreshKey} />
          )}

          {operator && page === "soc" && (
            <div className="page">
              <SOCPage />
            </div>
          )}
        </Suspense>

      </main>


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

      <Suspense fallback={null}>
        {operator && redTeamOpen && <RedTeamPanel onClose={closeRedTeam} />}
      </Suspense>

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
