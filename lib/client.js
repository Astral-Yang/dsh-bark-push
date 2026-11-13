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
        settingsIntro: "在下方配置 Bark，以及 Gotify、ntfy、Webhook 等更多推送渠道、通知类型与静音状态。",
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
        settingsIntro: "Configure Bark plus Gotify, ntfy, webhook and other channels, notification types, and mute state below.",
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

    function SessionMuteAction(props) {
      const muted = useMuted("session", props.sessionId);
      const [busy, setBusy] = React.useState(false);
      const translate = typeof props.t === "function" ? props.t : (key) => COPY.zh[key] || key;
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
        React.createElement(BellGlyph, { off: muted, size: 14 }),
      );
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
          if (!data || data.type !== "dsh-bark-push:height") return;
          const height = Number(data.height);
          if (Number.isFinite(height)) setFrameHeight(Math.max(480, Math.min(4000, Math.ceil(height))));
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
                      icon: { key: muted ? "bark-push.bell-off" : "bark-push.bell" },
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
    exports.__internals = { store, toastStore, request, toggle, adopt, useMuted, COPY, NS, BELL_PATHS };
    return module.exports;
  },
});
