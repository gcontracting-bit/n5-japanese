// Japanese Learning cloud sync — shared across every page of the project.
// Mirrors a small set of localStorage keys to Supabase and streams realtime
// updates back in when any device writes to the cloud.
//
// Requirements: this file must be loaded AFTER the Supabase JS CDN:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="cloud_sync.js"></script>

(function () {
  "use strict";

  var SUPABASE_URL = "https://zknkjedxudhdzphxxsfj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbmtqZWR4dWRoZHpwaHh4c2ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzIxNzksImV4cCI6MjA5MTg0ODE3OX0.RgE2FZPDOmSpy1XeC7JMmTxpWgi0QbCATnvMoF3zEfQ";
  var TABLE = "learning_japanese_state";
  var TRACKED_KEYS = ["kana_scores", "kanji_scores", "vocab_scores", "study_plan_completed"];

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.warn("[cloud_sync] Supabase JS not loaded. Include the CDN script before cloud_sync.js.");
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Expose a tiny global API in case a page wants to hook in.
  window.CloudSync = { sb: sb, table: TABLE, trackedKeys: TRACKED_KEYS.slice() };

  // --- Monkey-patch localStorage so existing code auto-syncs ------------------
  var nativeSetItem = Storage.prototype.setItem.bind(localStorage);
  var nativeGetItem = Storage.prototype.getItem.bind(localStorage);
  var nativeRemoveItem = Storage.prototype.removeItem.bind(localStorage);

  var suppressPush = false;       // set true while applying cloud->local updates
  var pendingPushes = new Map();  // key -> stringified value
  var pushTimer = null;

  function schedulePush(key, value) {
    if (suppressPush) return;
    pendingPushes.set(key, value);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPushes, 700);
  }

  async function flushPushes() {
    if (pendingPushes.size === 0) return;
    var entries = Array.from(pendingPushes.entries());
    pendingPushes.clear();
    setStatus("syncing", "Saving...");
    var payload = entries.map(function (kv) {
      var parsed;
      try { parsed = JSON.parse(kv[1]); } catch (e) { parsed = kv[1]; }
      return { key: kv[0], value: parsed };
    });
    try {
      var res = await sb.from(TABLE).upsert(payload, { onConflict: "key" });
      if (res.error) throw res.error;
      setStatus("synced", "Live");
    } catch (e) {
      console.warn("[cloud_sync] push failed:", e);
      setStatus("error", "Cloud error");
    }
  }

  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (TRACKED_KEYS.indexOf(key) !== -1) schedulePush(key, value);
  };
  localStorage.removeItem = function (key) {
    nativeRemoveItem(key);
    if (TRACKED_KEYS.indexOf(key) !== -1 && !suppressPush) {
      sb.from(TABLE).delete().eq("key", key).then(function (r) {
        if (r.error) console.warn("[cloud_sync] delete failed:", r.error);
      });
    }
  };

  // --- Initial fetch: cloud wins on page load --------------------------------
  async function initialFetch() {
    setStatus("syncing", "Connecting...");
    try {
      var res = await sb.from(TABLE).select("*").in("key", TRACKED_KEYS);
      if (res.error) throw res.error;
      suppressPush = true;
      var cloudKeys = new Set();
      (res.data || []).forEach(function (row) {
        cloudKeys.add(row.key);
        nativeSetItem(row.key, JSON.stringify(row.value));
      });
      // Any tracked key present locally but not in cloud gets pushed up (first run seeding).
      TRACKED_KEYS.forEach(function (k) {
        if (!cloudKeys.has(k)) {
          var v = nativeGetItem(k);
          if (v != null) schedulePush(k, v);
        }
      });
      suppressPush = false;
      setStatus("synced", "Live");
      window.dispatchEvent(new CustomEvent("cloudsync:ready"));
    } catch (e) {
      console.warn("[cloud_sync] initial fetch failed:", e);
      setStatus("error", "Cloud error");
    }
  }

  // --- Realtime subscription -------------------------------------------------
  function subscribeRealtime() {
    sb.channel("learning_japanese_state_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, function (payload) {
        var row = payload.new || payload.old;
        if (!row || TRACKED_KEYS.indexOf(row.key) === -1) return;
        suppressPush = true;
        try {
          if (payload.eventType === "DELETE") {
            nativeRemoveItem(row.key);
          } else {
            nativeSetItem(row.key, JSON.stringify(row.value));
          }
        } finally {
          suppressPush = false;
        }
        window.dispatchEvent(new CustomEvent("cloudsync:update", { detail: { key: row.key, eventType: payload.eventType } }));
        setStatus("synced", "Live • updated from another device");
        setTimeout(function () { setStatus("synced", "Live"); }, 2000);
      })
      .subscribe(function (status) {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("error", "Realtime lost");
      });
  }

  // --- Small status pill injected into every page ---------------------------
  function injectIndicator() {
    if (document.getElementById("cloudSyncIndicator")) return;
    var el = document.createElement("div");
    el.id = "cloudSyncIndicator";
    el.style.cssText = [
      "position:fixed", "top:10px", "right:10px", "z-index:99999",
      "font-family:system-ui,-apple-system,sans-serif", "font-size:12px",
      "padding:4px 10px", "border-radius:12px",
      "background:#f8fafc", "border:1px solid #e2e8f0", "color:#64748b",
      "pointer-events:none", "user-select:none",
      "box-shadow:0 1px 2px rgba(0,0,0,0.04)"
    ].join(";");
    el.textContent = "Connecting...";
    document.body.appendChild(el);
  }

  function setStatus(state, text) {
    var el = document.getElementById("cloudSyncIndicator");
    if (!el) return;
    var styles = {
      synced:  { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d" },
      syncing: { bg: "#fffbeb", border: "#fde68a", color: "#b45309" },
      error:   { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" }
    };
    var s = styles[state] || { bg: "#f8fafc", border: "#e2e8f0", color: "#64748b" };
    el.style.background = s.bg;
    el.style.borderColor = s.border;
    el.style.color = s.color;
    el.textContent = text || state;
  }

  function boot() {
    injectIndicator();
    initialFetch();
    subscribeRealtime();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
