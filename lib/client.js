window.__ModuleLoader__.load({
  id: "dsh-bark-push",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

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
      state: "/api/bark-push/state",
      toggle: "/api/bark-push/toggle",
    };

    const COPY = {
      zh: {
        nav: "Bark 推送",
        mute: "静音 Bark 通知",
        unmute: "取消静音 Bark 通知",
        muted: "Bark 通知已静音",
        unmuted: "Bark 通知已取消静音",
        settingsTitle: "Bark 推送",
        settingsIntro: "在下方配置 Bark Server、Device Key、通知类型与静音状态。",
        open: "在新标签页打开管理页",
        unavailable: "管理接口不可用；请确认 Web 运行时与 client-connection 已加载。",
        failed: "操作失败",
      },
      en: {
        nav: "Bark push",
        mute: "Mute Bark notifications",
        unmute: "Unmute Bark notifications",
        muted: "Bark notifications muted",
        unmuted: "Bark notifications unmuted",
        settingsTitle: "Bark push",
        settingsIntro: "Configure the Bark server, device keys, notification types, and mute state below.",
        open: "Open the management page in a new tab",
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
      listeners: new Set(),
    };

    function emit() {
      for (const listener of store.listeners) {
        try {
          listener();
        } catch (_) {
          // A broken subscriber must not stop the others.
        }
      }
    }

    function adopt(payload) {
      if (!payload || !payload.mute) return;
      store.workspaces = new Set(Array.isArray(payload.mute.workspaces) ? payload.mute.workspaces : []);
      store.sessions = new Set(Array.isArray(payload.mute.sessions) ? payload.mute.sessions : []);
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

    async function refresh() {
      try {
        adopt(await request(API.state));
      } catch (_) {
        // The host half may be absent in a static/desktop composition.
      }
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

    function SessionMuteAction(props) {
      const muted = useMuted("session", props.sessionId);
      const [busy, setBusy] = React.useState(false);
      const label = muted ? t("unmute") : t("mute");
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
            padding: "0 2px",
            cursor: "pointer",
            fontSize: "12px",
            lineHeight: "1",
            opacity: muted ? 0.95 : 0.5,
          },
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setBusy(true);
            toggle("session", props.sessionId)
              .catch(() => {})
              .finally(() => setBusy(false));
          },
        },
        muted ? "🔕" : "🔔",
      );
    }

    function BarkSettings() {
      const [failed, setFailed] = React.useState(false);
      const frameStyle = {
        width: "100%",
        height: "min(72vh, 900px)",
        minHeight: "520px",
        border: "1px solid rgba(127,127,127,.25)",
        borderRadius: "10px",
        background: "#fff",
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
              src: "/api/bark-push/ui?embed=1",
              style: frameStyle,
              title: COPY.zh.settingsTitle,
              onError: () => setFailed(true),
            }),
        React.createElement(
          "a",
          { href: "/api/bark-push/ui", target: "_blank", rel: "noreferrer" },
          COPY[localeOf(propsContext)].open,
        ),
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
      url.searchParams.delete("barkSession");
      url.searchParams.delete("barkFocus");
      try {
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      } catch (_) {
        // A sandboxed frame may refuse history writes; opening still works.
      }
      try {
        ctx.inject(["uiWorkspace"], (scope) => {
          let attempts = 0;
          const open = () => {
            try {
              scope.uiWorkspace.openSession(sessionId);
            } catch (_) {
              attempts += 1;
              if (attempts < 12) window.setTimeout(open, 700);
            }
          };
          window.setTimeout(open, 350);
        });
      } catch (_) {
        // No workspace UI in this composition.
      }
    }

    const inject = ["slots"];

    function apply(ctx) {
      propsContext = ctx;
      const t = bindCopy(ctx);

      let disposeLocale;
      try {
        disposeLocale = registerLocale(ctx);
        if (typeof disposeLocale === "function") ctx.effect(() => disposeLocale, "bark-push: locale dictionary");
      } catch (_) {
        disposeLocale = undefined;
      }

      refresh();
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

      if (!ctx.slots) return;

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

      // Session-row bell, shown only when the host declares the list slot.
      try {
        ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.workspaces.session.row.action",
              id: "bark-push-mute",
              order: 30,
              locale: NS,
              inject: () => ({ t }),
            },
            SessionMuteAction,
          ),
        );
      } catch (_) {
        // Older hosts may not declare the row action slot.
      }

      // Native context-menu entries for Session and workspace mute. The
      // service may activate after this plugin, so wait for it through
      // ctx.inject() instead of reading ctx.contextMenus at apply time.
      try {
        ctx.inject(["contextMenus"], (scope) => {
          scope.effect(
            () =>
              scope.contextMenus.register({
                id: "bark-push.session",
                target: "session",
                order: 900,
                resolve: (target) => {
                  const id = target && target.sessionId;
                  if (!id) return [];
                  const muted = store.sessions.has(id);
                  return [
                    {
                      id: "bark-mute",
                      label: muted ? t("unmute") : t("mute"),
                      run: () => {
                        toggle("session", id).catch(() => {});
                      },
                    },
                  ];
                },
              }),
            "bark-push: session mute menu",
          );
          scope.effect(
            () =>
              scope.contextMenus.register({
                id: "bark-push.workspace",
                target: "workspace",
                order: 900,
                resolve: (target) => {
                  const id = target && target.workspaceId;
                  if (!id) return [];
                  const muted = store.workspaces.has(id);
                  return [
                    {
                      id: "bark-mute",
                      label: muted ? t("unmute") : t("mute"),
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
    exports.__internals = { store, request, toggle, adopt, useMuted, COPY, NS };
    return module.exports;
  },
});
