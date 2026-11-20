window.__ModuleLoader__.load({
  id: "dsh-bark-push",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    // Host-shipped menu primitive; absent in minimal/test hosts, so fall back
    // to a locally styled button.
    var UI_PRIMITIVES = null;
    try {
      UI_PRIMITIVES = require("@deepseek-ai/dsh-client-ui-primitives") || null;
    } catch (_) {
      UI_PRIMITIVES = null;
    }

    /**
     * Browser half of dsh-bark-push.
     *
     * It contributes three things and owns no notification logic:
     *   1. a Settings section that hosts the authenticated management page;
     *   2. per-session and per-workspace mute switches in the native context
     *      menus (plus a bell in the Session row);
     *   3. a tiny deep-link bridge: `?barkSession=<id>` opens that Session,
     *      because this DSH release has no addressable Session route.
     *
     * All state and all Bark calls live on the host; the page only reads and
     * writes `/api/bark-push/*` with the browser's existing cookie.
     */

    const NS = "bark-push";
    const API = {
      state: "/api/bark-push/state?catalog=0",
      toggle: "/api/bark-push/toggle?catalog=0",
      browserEvents: "/api/bark-push/browser-events",
    };

    const COPY = {
      zh: {
        nav: "通知",
        mute: "静音推送通知",
        unmute: "取消静音推送通知",
        muted: "推送通知已静音",
        mutedWorkspace: "工作区推送通知已静音",
        unmuted: "推送通知已取消静音",
        settingsTitle: "通知",
        settingsIntro: "在下方管理推送通知与浏览器通知；两套渠道可以独立开启。",
        unavailable: "管理接口不可用；请确认 Web 运行时与 client-connection 已加载。",
        failed: "操作失败",
      },
      en: {
        nav: "Notifications",
        mute: "Mute push notifications",
        unmute: "Unmute push notifications",
        muted: "Push notifications muted",
        mutedWorkspace: "Workspace push notifications muted",
        unmuted: "Push notifications unmuted",
        settingsTitle: "Notifications",
        settingsIntro: "Manage push notifications and browser notifications below; the two channels are independent.",
        unavailable: "Management API unavailable; check that the Web runtime and client-connection are mounted.",
        failed: "Action failed",
      },
    };

    function localeOf(ctx) {
      try {
        const value = ctx.locale && typeof ctx.locale.getLocale === "function" ? ctx.locale.getLocale() : "";
        return typeof value === "string" && value.toLowerCase().startsWith("en") ? "en" : "zh";
      } catch (_) {
        return "zh";
      }
    }

    function bindCopy(ctx) {
      const cached = localeOf(ctx);
      const table = COPY[cached] || COPY.zh;
      return (key) => table[key] || COPY.zh[key] || key;
    }

    /** Shared mute cache: the page and the native menus read the same view. */
    const store = {
      loaded: false,
      workspaces: new Set(),
      sessions: new Set(),
      /** Session id -> workspace id, so a row can reflect workspace-level mute. */
      sessionWorkspace: new Map(),
      /** Workspace id -> root path, used to infer a workspace from a Session cwd. */
      workspacePaths: new Map(),
      /** Browser-notification switches mirrored from the latest state payload. */
      browserConfig: {
        enabled: false,
        skipForeground: true,
        persistent: {
          reply: false,
          approval: true,
          question: true,
        },
      },
      listeners: new Set(),
    };

    /**
     * Transient notices raised by the iframe management page. The iframe cannot
     * anchor a fixed toast (the host grows it to full content height), so it
     * posts here and this top-document store feeds a `shell.overlay` entry.
     */
    const toastStore = (() => {
      let current = null;
      let seq = 0;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch (_) {
            // A broken subscriber must not stop the others.
          }
        }
      };
      return {
        get: () => current,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        show(message, kind) {
          if (!message) return;
          seq += 1;
          current = { id: seq, message: String(message), kind: kind === 'bad' ? 'bad' : 'ok' };
          emit();
        },
        dismiss() {
          if (current === null) return;
          current = null;
          emit();
        },
      };
    })();

    function emit() {
      for (const listener of store.listeners) {
        try {
          listener();
        } catch (_) {
          // A broken subscriber must not stop the others.
        }
      }
    }

    /** Longest workspace root containing a Session cwd. */
    function workspaceIdForPath(paths, cwd) {
      const target = String(cwd || "").replace(/[\\/]+$/, "");
      if (target.length === 0) return undefined;
      let best;
      let bestLength = -1;
      for (const [id, path] of paths) {
        const root = String(path || "").replace(/[\\/]+$/, "");
        if (root.length === 0) continue;
        if (target === root || target.startsWith(root + "/") || target.startsWith(root + "\\")) {
          if (root.length > bestLength) {
            best = id;
            bestLength = root.length;
          }
        }
      }
      return best;
    }

    function browserPersistenceOf(config) {
      return {
        reply: config.browserNotifyReplyPersistent === true,
        approval: config.browserNotifyApprovalPersistent !== false,
        question: config.browserNotifyQuestionPersistent !== false,
      };
    }

    function adopt(payload) {
      if (!payload || !payload.mute) return;
      store.workspaces = new Set(Array.isArray(payload.mute.workspaces) ? payload.mute.workspaces : []);
      store.sessions = new Set(Array.isArray(payload.mute.sessions) ? payload.mute.sessions : []);
      if (payload.config && typeof payload.config === "object") {
        store.browserConfig = {
          enabled: payload.config.browserNotifyEnabled === true,
          skipForeground: payload.config.browserNotifySkipForeground !== false,
          persistent: browserPersistenceOf(payload.config),
        };
      }
      if (payload.catalog && typeof payload.catalog === "object") {
        const catalog = payload.catalog;
        const paths = new Map();
        for (const row of Array.isArray(catalog.workspaces) ? catalog.workspaces : []) {
          if (row && typeof row.id === "string" && typeof row.path === "string" && row.path.length > 0) {
            paths.set(row.id, row.path);
          }
        }
        store.workspacePaths = paths;

        const map = new Map();
        if (catalog.sessionWorkspace && typeof catalog.sessionWorkspace === "object") {
          for (const [sessionId, workspaceId] of Object.entries(catalog.sessionWorkspace)) {
            if (typeof sessionId === "string" && typeof workspaceId === "string" && workspaceId.length > 0) {
              map.set(sessionId, workspaceId);
            }
          }
        }
        for (const row of Array.isArray(catalog.sessions) ? catalog.sessions : []) {
          if (!row || typeof row.id !== "string") continue;
          if (typeof row.workspaceId === "string" && row.workspaceId.length > 0) {
            map.set(row.id, row.workspaceId);
          } else if (typeof row.cwd === "string" && row.cwd.length > 0) {
            const inferred = workspaceIdForPath(paths, row.cwd);
            if (inferred !== undefined) map.set(row.id, inferred);
          }
        }
        store.sessionWorkspace = map;
      }
      store.loaded = true;
      emit();
    }

    async function request(path, body) {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers:
          body === undefined
            ? { accept: "application/json" }
            : {
                "content-type": "application/json",
                "x-dsh-bark-action": "1",
                accept: "application/json",
              },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error((payload && payload.error) || "HTTP " + response.status);
      }
      return payload;
    }

    let refreshPromise = null;

    function refresh() {
      if (refreshPromise) return refreshPromise;
      refreshPromise = (async () => {
        try {
          adopt(await request(API.state));
        } catch (_) {
          // The host half may be absent in a static/desktop composition.
        } finally {
          refreshPromise = null;
        }
      })();
      return refreshPromise;
    }

    async function toggle(kind, id) {
      const payload = await request(API.toggle, { kind, id });
      adopt(payload);
      return payload.muted === true;
    }

    function useMuted(kind, id) {
      const [, force] = React.useReducer((value) => value + 1, 0);
      React.useEffect(() => {
        const listener = () => force();
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
      }, []);
      const set = kind === "workspace" ? store.workspaces : store.sessions;
      return set.has(id);
    }

    /** Effective mute for a Session row: its own mute, or its workspace's mute. */
    function useSessionMuteState(sessionId) {
      const [, force] = React.useReducer((value) => value + 1, 0);
      React.useEffect(() => {
        const listener = () => force();
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
      }, []);
      const session = store.sessions.has(sessionId);
      const workspaceId = store.sessionWorkspace.get(sessionId);
      const workspace = typeof workspaceId === "string" && store.workspaces.has(workspaceId);
      return { session, workspace };
    }

    // Bell / bell-off glyphs mirror lib/assets/bell.svg and bell-off.svg.
    // They are inlined so `currentColor` follows the host theme and no
    // authenticated image request is needed for a 24x24 icon.
    const BELL_PATHS = {
      bell: [
        "M10.268 21a2 2 0 0 0 3.464 0",
        "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
      ],
      bellOff: [
        "M10.268 21a2 2 0 0 0 3.464 0",
        "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",
        "m2 2 20 20",
        "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",
      ],
    };

    function BellGlyph({ off, size = 14 }) {
      const paths = off ? BELL_PATHS.bellOff : BELL_PATHS.bell;
      return React.createElement(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
          style: { display: "block" },
        },
        paths.map((d, index) => React.createElement("path", { key: index, d })),
      );
    }

    /**
     * Frame-wide toast rendered into the host's `shell.overlay` seat. It lives
     * in the top document (outside the Settings iframe), so it stays visible
     * regardless of how far the Settings content is scrolled.
     */
    function BarkToast(props) {
      const notify = props.store;
      const [state, setState] = React.useState(notify.get());
      React.useEffect(() => notify.subscribe(() => setState(notify.get())), [notify]);
      React.useEffect(() => {
        if (state === null) return undefined;
        const timer = setTimeout(() => notify.dismiss(), 3200);
        return () => clearTimeout(timer);
      }, [state, notify]);
      if (state === null) return null;
      const tone = state.kind === 'bad'
        ? { background: '#c0392b', color: '#ffffff' }
        : { background: '#1c1d21', color: '#ffffff' };
      return React.createElement(
        'div',
        {
          role: 'status',
          'aria-live': 'polite',
          'data-bark-toast': state.kind,
          style: {
            position: 'absolute',
            left: '50%',
            bottom: '24px',
            transform: 'translateX(-50%)',
            maxWidth: '80vw',
            padding: '9px 16px',
            borderRadius: '999px',
            fontSize: '13px',
            lineHeight: '1.5',
            textAlign: 'center',
            boxShadow: '0 6px 24px rgba(0, 0, 0, .18)',
            pointerEvents: 'auto',
            ...tone,
          },
        },
        state.message,
      );
    }

    function sessionCopy(props) {
      return typeof props.t === "function" ? props.t : (key) => COPY.zh[key] || key;
    }

    /** Inject the menu-row styles once; mirrors the host's own menu item look. */
    function ensureMenuStyles() {
      try {
        if (typeof document === "undefined" || !document.head) return;
        if (document.getElementById("dsh-bark-push-menu-style")) return;
        const style = document.createElement("style");
        style.id = "dsh-bark-push-menu-style";
        style.textContent =
          ".bark-menuItem{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;" +
          "padding:6px 10px;border:0;border-radius:6px;background:none;" +
          "color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));font-family:inherit;" +
          "font-size:13px;line-height:20px;text-align:left;cursor:pointer}" +
          ".bark-menuItem:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}" +
          ".bark-menuIcon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}" +
          ".bark-menuLabel{flex:1;min-width:0;text-align:left}";
        document.head.append(style);
      } catch (_) {
        // Styling is cosmetic; the menu entry still works without it.
      }
    }

    /** Session-row "..." / right-click menu entry that toggles this mute. */
    function SessionMuteMenuItem(props) {
      const translate = sessionCopy(props);
      const muted = useMuted("session", props.sessionId);
      const label = muted ? translate("unmute") : translate("mute");
      const menu = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState() : [false, () => {}];
      const setMenuOpen = menu[1];
      const select = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        setMenuOpen(false);
        toggle("session", props.sessionId).catch(() => {});
      };
      const icon = React.createElement(BellGlyph, { off: muted, size: 16 });
      const MenuItemButton = UI_PRIMITIVES && typeof UI_PRIMITIVES.MenuItemButton === "function"
        ? UI_PRIMITIVES.MenuItemButton
        : null;
      if (MenuItemButton) {
        return React.createElement(
          MenuItemButton,
          { icon, onSelect: select, "data-bark-muted": muted ? "1" : "0" },
          label,
        );
      }
      return React.createElement(
        "button",
        {
          type: "button",
          role: "menuitem",
          className: "bark-menuItem",
          "data-bark-muted": muted ? "1" : "0",
          onClick: select,
        },
        React.createElement("span", { className: "bark-menuIcon" }, icon),
        React.createElement("span", { className: "bark-menuLabel" }, label),
      );
    }

    /** Non-interactive muted mark in the Session row, only while muted. */
    function SessionMutedMark(props) {
      const translate = sessionCopy(props);
      const state = useSessionMuteState(props.sessionId);
      if (!state.session && !state.workspace) return null;
      const label = state.workspace ? translate("mutedWorkspace") : translate("muted");
      return React.createElement(
        "span",
        {
          role: "img",
          title: label,
          "aria-label": label,
          "data-bark-muted-mark": state.workspace ? "workspace" : "session",
          style: { display: "inline-flex", alignItems: "center", opacity: 0.72 },
        },
        React.createElement(BellGlyph, { off: true, size: 12 }),
      );
    }

    /** Current Session's header bell toggle (quick access, one icon only). */
    function SessionHeaderMute(props) {
      const translate = sessionCopy(props);
      const muted = useMuted("session", props.sessionId);
      const [busy, setBusy] = React.useState(false);
      const label = muted ? translate("unmute") : translate("mute");
      return React.createElement(
        "button",
        {
          type: "button",
          title: label,
          "aria-label": label,
          "data-bark-muted": muted ? "1" : "0",
          disabled: busy,
          style: {
            background: "transparent",
            border: 0,
            padding: "0 6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            opacity: muted ? 0.95 : 0.6,
          },
          onClick: () => {
            setBusy(true);
            toggle("session", props.sessionId)
              .catch(() => {})
              .finally(() => setBusy(false));
          },
        },
        React.createElement(BellGlyph, { off: muted, size: 16 }),
      );
    }

    /** Browser Notification API from the top-level window, when available. */
    function notificationApi() {
      try {
        if (typeof window !== "undefined" && typeof window.Notification === "function") return window.Notification;
      } catch (_) {
        // Fall through to the global for unusual test harnesses.
      }
      try {
        return typeof Notification === "function" ? Notification : undefined;
      } catch (_) {
        return undefined;
      }
    }

    /** Current main-view Session id, matching the DSH sidebar's own rule. */
    function currentSessionId(ctx) {
      try {
        let sessions = ctx && ctx.sessions ? ctx.sessions : undefined;
        if (!sessions && ctx && typeof ctx.get === "function") {
          sessions = ctx.get("sessions");
        }
        const snapshot = sessions && sessions.list && typeof sessions.list.getSnapshot === "function"
          ? sessions.list.getSnapshot()
          : undefined;
        if (!snapshot || !snapshot.byId) return undefined;
        const row = Object.values(snapshot.byId).find((entry) => (entry?.retainedBy?.mainView ?? 0) > 0);
        return row && typeof row.id === "string" ? row.id : undefined;
      } catch (_) {
        return undefined;
      }
    }

    /** Whether a browser event should be shown under the foreground rule. */
    function browserEventShouldDisplay(ctx, event) {
      if (!event || typeof event !== "object") return false;
      if (store.loaded && (!store.browserConfig || store.browserConfig.enabled !== true)) return false;
      if (store.browserConfig.skipForeground === false) return true;
      const focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
      const foreground = document.visibilityState === "visible" && focused;
      if (!foreground) return true;
      const current = currentSessionId(ctx);
      return current === undefined || event.sessionId !== current;
    }

    /** Open a Session from the top document after a notification click. */
    function openSessionFromNotification(ctx, sessionId) {
      if (typeof sessionId !== "string" || sessionId.length === 0) return;
      try {
        if (ctx && ctx.uiWorkspace && typeof ctx.uiWorkspace.openSession === "function") {
          ctx.uiWorkspace.openSession(sessionId);
          return;
        }
      } catch (_) {
        // Fall through to the injected scope.
      }
      try {
        ctx.inject(["uiWorkspace"], (scope) => {
          try {
            scope.uiWorkspace.openSession(sessionId);
          } catch (_) {
            // The workspace UI may be tearing down.
          }
        });
      } catch (_) {
        // No workspace UI in this composition.
      }
    }

    /** Show one browser notification and wire its click-through. */
    function showBrowserNotification(ctx, event) {
      const Api = notificationApi();
      if (!Api || Api.permission !== "granted") return false;
      if (!browserEventShouldDisplay(ctx, event)) return false;
      const title = typeof event.sessionTitle === "string" && event.sessionTitle.length > 0
        ? event.sessionTitle
        : "当前会话";
      const body = typeof event.body === "string" ? event.body : (event.status || "");
      try {
        const notification = new Api(title, {
          body,
          tag: `dsh-bark:${event.kind || "notice"}:${event.sessionId || ""}`,
          renotify: true,
          requireInteraction: store.browserConfig.persistent[event.kind] === true,
          data: { sessionId: event.sessionId, kind: event.kind },
        });
        notification.onclick = () => {
          try {
            window.focus();
          } catch (_) {
            // A background tab may not be focusable.
          }
          openSessionFromNotification(ctx, event.sessionId);
          try {
            notification.close();
          } catch (_) {
            // Already closed.
          }
        };
        return true;
      } catch (_) {
        return false;
      }
    }

    /** Request permission from the top document for the settings iframe. */
    function requestTopNotificationPermission() {
      const Api = notificationApi();
      if (!Api || typeof Api.requestPermission !== "function") return Promise.resolve("unsupported");
      try {
        return Promise.resolve(Api.requestPermission());
      } catch (_) {
        return Promise.resolve("denied");
      }
    }

    /** Show a test notification from the top document. */
    function showTopTestNotification() {
      const Api = notificationApi();
      if (!Api || Api.permission !== "granted") return false;
      try {
        new Api("DSH 浏览器通知测试", { body: "浏览器通知已开启。" });
        return true;
      } catch (_) {
        return false;
      }
    }

    /**
     * Connect the browser-notification SSE stream. A leader lock keeps multiple
     * DSH tabs from showing the same notification twice.
     */
    function installBrowserNotifications(ctx) {
      let source = null;
      let started = false;
      let lockRequested = false;
      let lockHeld = false;
      let leaderGeneration = 0;
      let releaseLock;

      const start = () => {
        if (started) return;
        if (!store.loaded || store.browserConfig.enabled !== true || !lockHeld) return;
        const EventSourceCtor = typeof window !== "undefined" ? window.EventSource : undefined;
        if (typeof EventSourceCtor !== "function") return;
        started = true;
        try {
          source = new EventSourceCtor(API.browserEvents);
          source.addEventListener("browser-notify", (message) => {
            try {
              const event = JSON.parse(message.data);
              showBrowserNotification(ctx, event);
            } catch (_) {
              // Malformed events must not break the stream.
            }
          });
        } catch (_) {
          started = false;
          source = null;
        }
      };

      const stop = () => {
        if (source && typeof source.close === "function") source.close();
        source = null;
        started = false;
      };

      const releaseLeader = () => {
        leaderGeneration++;
        if (releaseLock) {
          const resolve = releaseLock;
          releaseLock = undefined;
          resolve();
        }
        lockRequested = false;
        lockHeld = false;
      };

      const acquireLeader = () => {
        if (lockRequested || lockHeld) return;
        if (!store.loaded || store.browserConfig.enabled !== true) return;
        try {
          const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
          if (locks && typeof locks.request === "function") {
            lockRequested = true;
            const generation = leaderGeneration;
            const hold = new Promise((resolve) => { releaseLock = resolve; });
            locks.request("dsh-bark-push:browser-notify-leader", { mode: "exclusive" }, async () => {
              if (generation !== leaderGeneration) return;
              lockRequested = false;
              lockHeld = true;
              start();
              await hold;
              if (generation === leaderGeneration) lockHeld = false;
            }).catch(() => {
              if (generation !== leaderGeneration) return;
              lockRequested = false;
              lockHeld = true;
              start();
            });
          } else {
            lockHeld = true;
            start();
          }
        } catch (_) {
          lockRequested = false;
          lockHeld = true;
          start();
        }
      };

      const sync = () => {
        if (!store.loaded || store.browserConfig.enabled !== true) {
          stop();
          releaseLeader();
          return;
        }
        acquireLeader();
      };

      store.listeners.add(sync);
      sync();

      try {
        ctx.effect(() => () => {
          store.listeners.delete(sync);
          releaseLeader();
          stop();
        }, "bark-push: browser notification stream");
      } catch (_) {
        // Non-DOM test harnesses can still call showBrowserNotification directly.
      }
    }

    function BarkSettings() {
      const [failed, setFailed] = React.useState(false);
      const frameRef = React.useRef(null);
      const [frameHeight, setFrameHeight] = React.useState(0);

      React.useEffect(() => {
        const onMessage = (event) => {
          if (event.origin !== window.location.origin) return;
          if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
          const data = event.data;
          if (!data) return;
          if (data.type === "dsh-bark-push:height") {
            const height = Number(data.height);
            if (Number.isFinite(height)) setFrameHeight(Math.max(480, Math.min(4000, Math.ceil(height))));
            return;
          }
          if (data.type === "dsh-bark-push:browser-permission-request") {
            void requestTopNotificationPermission().then((permission) => {
              try {
                frameRef.current?.contentWindow?.postMessage(
                  { type: "dsh-bark-push:browser-permission-result", permission },
                  window.location.origin,
                );
              } catch (_) {
                // The iframe may have been closed while the prompt was open.
              }
            });
            return;
          }
          if (data.type === "dsh-bark-push:browser-test") {
            showTopTestNotification();
            return;
          }
          if (data.type === "dsh-bark-push:config-updated") {
            const config = data.config && typeof data.config === "object" ? data.config : {};
            store.browserConfig = {
              enabled: config.browserNotifyEnabled === true,
              skipForeground: config.browserNotifySkipForeground !== false,
              persistent: browserPersistenceOf(config),
            };
            emit();
          }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
      }, []);

      const frameStyle = {
        width: "100%",
        height: frameHeight > 0 ? `${frameHeight}px` : "min(72vh, 900px)",
        minHeight: "480px",
        border: "1px solid rgba(127,127,127,.25)",
        borderRadius: "10px",
        background: "#fff",
        display: "block",
      };
      return React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "10px" } },
        React.createElement(
          "p",
          { style: { margin: 0, opacity: 0.75 } },
          COPY[localeOf(propsContext)].settingsIntro,
        ),
        failed
          ? React.createElement("p", { style: { color: "#c0392b" } }, COPY.zh.unavailable)
          : React.createElement("iframe", {
              ref: frameRef,
              src: "/api/bark-push/ui?embed=1",
              style: frameStyle,
              title: COPY.zh.settingsTitle,
              allow: "notifications",
              onError: () => setFailed(true),
            }),
      );
    }

    // `BarkSettings` is a slot component with no framework props of its own.
    // The context is captured by `apply`; this variable is set before any
    // component can render, and the locale helper tolerates its absence.
    let propsContext = null;

    function registerLocale(ctx) {
      try {
        if (ctx.locale && typeof ctx.locale.register === "function") {
          return ctx.locale.register(NS, COPY);
        }
      } catch (_) {
        // HMR can race a dictionary registration; labels fall back to Chinese.
      }
      return undefined;
    }

    function installDeepLink(ctx) {
      let url;
      try {
        url = new URL(window.location.href);
      } catch (_) {
        return;
      }
      const sessionId = url.searchParams.get("barkSession");
      if (!sessionId) return;
      const clearQuery = () => {
        url.searchParams.delete("barkSession");
        url.searchParams.delete("barkFocus");
        try {
          window.history.replaceState(null, "", url.pathname + url.search + url.hash);
        } catch (_) {
          // A sandboxed frame may refuse history writes; opening still works.
        }
      };
      try {
        ctx.inject(["uiWorkspace", "sessions"], (scope) => {
          let attempts = 0;
          const sessionReady = () => {
            try {
              const snapshot = scope.sessions?.list?.getSnapshot?.();
              if (!snapshot || !snapshot.byId) return undefined;
              return snapshot.byId[sessionId] !== undefined;
            } catch (_) {
              return undefined;
            }
          };
          const open = () => {
            const ready = sessionReady();
            if (ready === false && attempts < 60) {
              attempts += 1;
              window.setTimeout(open, 500);
              return;
            }
            try {
              scope.uiWorkspace.openSession(sessionId);
              clearQuery();
            } catch (_) {
              attempts += 1;
              if (attempts < 60) {
                window.setTimeout(open, 500);
              }
            }
          };
          window.setTimeout(open, 350);
        });
      } catch (_) {
        // No workspace UI in this composition.
      }
    }

    const inject = ["slots", "sessions"];

    function apply(ctx) {
      propsContext = ctx;
      const t = bindCopy(ctx);
      ensureMenuStyles();

      let disposeLocale;
      try {
        disposeLocale = registerLocale(ctx);
        if (typeof disposeLocale === "function") ctx.effect(() => disposeLocale, "bark-push: locale dictionary");
      } catch (_) {
        disposeLocale = undefined;
      }

      refresh();
      // The first state fetch can race the connection/route mount. Retry soon
      // until one succeeds, so mute state and the session->workspace map do not
      // stay empty for a whole 60s polling period.
      try {
        const bootTimers = [];
        const retry = () => { if (!store.loaded) refresh(); };
        for (const delay of [600, 4000]) bootTimers.push(window.setTimeout(retry, delay));
        ctx.effect(() => () => {
          for (const id of bootTimers) window.clearTimeout(id);
        }, "bark-push: initial refresh retry");
      } catch (_) {
        // No timers in a non-DOM harness: the normal refresh still runs later.
      }
      try {
        ctx.effect(() => {
          const timer = window.setInterval(refresh, 60_000);
          const onVisible = () => {
            if (document.visibilityState === "visible") refresh();
          };
          document.addEventListener("visibilitychange", onVisible);
          return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
          };
        }, "bark-push: mute cache refresh");
      } catch (_) {
        // Non-DOM test harnesses skip the refresh timer.
      }

      // Bridge: the management iframe posts toast notices here for the
      // frame-wide overlay, because a toast inside the auto-height iframe would
      // be anchored to the whole (tall) document rather than the viewport.
      try {
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          const onToast = (event) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data;
            if (!data || data.type !== "dsh-bark-push:toast") return;
            toastStore.show(data.message, data.kind);
          };
          window.addEventListener("message", onToast);
          ctx.effect(() => () => window.removeEventListener("message", onToast), "bark-push: toast bridge");
        }
      } catch (_) {
        // No window (non-web composition): notices stay local to the iframe.
      }

      installBrowserNotifications(ctx);

      if (!ctx.slots) return;

      // Frame-wide overlay entry hosted by the layout shell (top document,
      // above every column and outside their scroll containers).
      try {
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "dsh-bark-push.toast",
          inject: () => ({ store: toastStore }),
        }, BarkToast));
      } catch (_) {
        // Hosts without the overlay seat simply do not show host toasts.
      }

      // Settings section: an authenticated iframe keeps the rich form out of
      // the client bundle and works in every web shell that declares the slot.
      try {
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: "bark-push",
              order: 46,
              label: () => t("nav"),
              locale: NS,
              inject: () => ({ t }),
            },
            BarkSettings,
          ),
        );
      } catch (_) {
        // The Settings shell is optional in a minimal composition.
      }

      // Match the Settings navigation glyph to the same bell used by the
      // mute control. The host scopes this list slot to the section id.
      try {
        ctx.slots.inject("settings.section.icon", () =>
          ctx.slots.register(
            {
              name: "settings.section.icon",
              id: "bark-push",
              order: 1,
            },
            function BarkNavIcon(props) {
              return React.createElement(BellGlyph, { off: false, size: props && props.size ? props.size : 16 });
            },
          ),
        );
      } catch (_) {
        // Older Settings shells render their fallback nav glyph.
      }

      // Per-Session mute is contributed through the existing contextMenus
      // session entry, which the host renders in both the right-click menu and
      // the row's "..." menu. The crowded row hover strip is no longer used.
      // A small non-interactive mark keeps the muted state glanceable without
      // adding another clickable icon to the row.
      try {
        ctx.slots.inject("sidebar.session.row.trailing", () =>
          ctx.slots.register(
            {
              name: "sidebar.session.row.trailing",
              id: "bark-push.muted-mark",
              order: 500,
              locale: NS,
              inject: () => ({ t }),
            },
            SessionMutedMark,
          ),
        );
      } catch (_) {
        // Older hosts may not declare the row trailing slot.
      }

      // Quick toggle for the Session that is currently open, in the header's
      // right-aligned utilities. Session-scoped inject supplies the id.
      try {
        ctx.slots.inject("conversation.session.header.utilities", () =>
          ctx.slots.register(
            {
              name: "conversation.session.header.utilities",
              id: "bark-push.mute",
              order: 10,
              locale: NS,
              inject: (sessionId) => ({ sessionId, t }),
            },
            SessionHeaderMute,
          ),
        );
      } catch (_) {
        // Older hosts may not declare the header utilities slot.
      }

      // Context-menu icons use the keyed contextMenu.icon slot. Register both
      // states once; each menu item points at the key matching its state.
      try {
        ctx.slots.inject("contextMenu.icon", function* () {
          yield ctx.slots.register(
            { name: "contextMenu.icon", key: "bark-push.bell" },
            function BarkBellIcon() {
              return React.createElement(BellGlyph, { off: false, size: 16 });
            },
          );
          yield ctx.slots.register(
            { name: "contextMenu.icon", key: "bark-push.bell-off" },
            function BarkBellOffIcon() {
              return React.createElement(BellGlyph, { off: true, size: 16 });
            },
          );
        });
      } catch (_) {
        // Hosts without the keyed icon slot render text-only menu rows.
      }

      // Session mute is a React menu row in the legacy slot the host renders
      // in BOTH the row "..." menu and the right-click menu, together before
      // the built-in Archive row. Using this slot instead of contextMenus
      // keeps the position deterministic.
      try {
        ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
          ctx.slots.register(
            {
              name: "sidebar.workspaces.session.menu.item",
              id: "bark-push.mute",
              order: 510,
              locale: NS,
              inject: () => ({ t }),
            },
            SessionMuteMenuItem,
          ),
        );
      } catch (_) {
        // Older hosts may not declare the row menu slot.
      }

      // Workspace mute stays in the context menu. The host renders the
      // reveal/copy/open/archive workspace actions as one provider group at
      // order 200, so "above archive" means sitting just before that group;
      // order 199 is the closest slot available without a workspace menu slot.
      try {
        ctx.inject(["contextMenus"], (scope) => {
          scope.effect(
            () =>
              scope.contextMenus.register({
                id: "bark-push.workspace",
                target: "workspace",
                order: 199,
                resolve: (target) => {
                  const id = target && target.workspaceId;
                  if (!id) return [];
                  const muted = store.workspaces.has(id);
                  return [
                    {
                      id: "bark-mute",
                      label: muted ? t("unmute") : t("mute"),
                      icon: { key: muted ? "bark-push.bell-off" : "bark-push.bell" },
                      run: () => {
                        toggle("workspace", id).catch(() => {});
                      },
                    },
                  ];
                },
              }),
            "bark-push: workspace mute menu",
          );
        });
      } catch (_) {
        // Context menus are optional; the Settings section remains available.
      }

      installDeepLink(ctx);
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      store,
      toastStore,
      request,
      toggle,
      adopt,
      useMuted,
      COPY,
      NS,
      BELL_PATHS,
      browser: {
        currentSessionId,
        shouldDisplay: browserEventShouldDisplay,
        show: showBrowserNotification,
        requestTopPermission: requestTopNotificationPermission,
        showTopTest: showTopTestNotification,
      },
    };
    return module.exports;
  },
});
