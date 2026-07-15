// Popup: master enable switch + AI adapter configuration and a health check.
// Settings persist to chrome.storage.sync under the same keys background.js
// reads (aiAdapterUrl, aiTimeoutMs), so the content script picks them up live.
(function () {
  "use strict";

  var DEFAULT_ADAPTER = "http://127.0.0.1:4924";
  var DEFAULT_TIMEOUT_MS = 45000;
  var MIN_TIMEOUT_SEC = 5;
  var MAX_TIMEOUT_SEC = 120;
  var SAVE_DEBOUNCE_MS = 400;
  var TEST_TIMEOUT_MS = 5000;

  var enabledEl = document.getElementById("enabled");
  var urlEl = document.getElementById("adapterUrl");
  var urlErrorEl = document.getElementById("adapterUrlError");
  var timeoutEl = document.getElementById("timeoutSec");
  var testBtn = document.getElementById("testBtn");
  var statusEl = document.getElementById("status");
  var statusTextEl = document.getElementById("statusText");
  var versionEl = document.getElementById("version");

  // Show the extension version (e.g. "v1.0.0") next to the title.
  try {
    versionEl.textContent = "v" + chrome.runtime.getManifest().version;
  } catch (e) {
    /* getManifest can throw in odd contexts; a missing badge is harmless. */
  }

  // Normalize an adapter URL for storage: trim and drop trailing slashes.
  function normalizeUrl(s) {
    return String(s || "").trim().replace(/\/+$/, "");
  }

  // A URL is valid when it parses and uses an http(s) scheme.
  function isValidUrl(s) {
    var v = normalizeUrl(s);
    if (!/^https?:\/\//i.test(v)) return false;
    try {
      new URL(v);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Clamp the timeout (seconds) into the allowed range; fall back to default.
  function clampTimeoutSec(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS / 1000;
    return Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, n));
  }

  function setUrlError(show) {
    urlEl.classList.toggle("is-invalid", show);
    urlErrorEl.classList.toggle("is-shown", show);
    urlErrorEl.textContent = show ? "URL phải bắt đầu bằng http:// hoặc https://" : "";
  }

  // Map an adapter error code (from background.js) to a Vietnamese message.
  // Mirrors content.js toUserMessage; the two contexts are isolated so a small
  // duplication is acceptable.
  function toUserMessage(err) {
    var code = (err && err.code) || "network";
    switch (code) {
      case "auth":
        return "Đã kết nối nhưng chưa đăng nhập — mở app trên máy và đăng nhập.";
      case "timeout":
        return "Adapter phản hồi quá lâu.";
      case "upstream":
      case "http":
        return "Adapter lỗi" + (err && err.status ? " (mã " + err.status + ")" : "") + ".";
      case "empty":
        return "Adapter trả dữ liệu không hợp lệ.";
      default:
        return "Không kết nối được adapter — kiểm tra app đã chạy chưa.";
    }
  }

  function setStatus(state, text) {
    statusEl.className = "status" + (state ? " is-" + state : "");
    statusTextEl.textContent = text || "";
  }

  // ----- Load persisted settings -----------------------------------------
  chrome.storage.sync.get(
    { enabled: true, aiAdapterUrl: DEFAULT_ADAPTER, aiTimeoutMs: DEFAULT_TIMEOUT_MS },
    function (cfg) {
      enabledEl.checked = cfg.enabled;
      urlEl.value = cfg.aiAdapterUrl || DEFAULT_ADAPTER;
      timeoutEl.value = String(clampTimeoutSec((Number(cfg.aiTimeoutMs) || DEFAULT_TIMEOUT_MS) / 1000));
    }
  );

  // ----- Persist the master switch immediately ----------------------------
  enabledEl.addEventListener("change", function () {
    chrome.storage.sync.set({ enabled: enabledEl.checked });
  });

  // ----- Persist adapter settings (debounced) -----------------------------
  var saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAdapterSettings, SAVE_DEBOUNCE_MS);
  }

  function saveAdapterSettings() {
    var validUrl = isValidUrl(urlEl.value);
    setUrlError(!validUrl);
    var patch = { aiTimeoutMs: clampTimeoutSec(timeoutEl.value) * 1000 };
    if (validUrl) patch.aiAdapterUrl = normalizeUrl(urlEl.value);
    chrome.storage.sync.set(patch);
  }

  urlEl.addEventListener("input", scheduleSave);
  timeoutEl.addEventListener("input", scheduleSave);
  // Normalize the displayed timeout to the clamped value when leaving the field.
  timeoutEl.addEventListener("blur", function () {
    timeoutEl.value = String(clampTimeoutSec(timeoutEl.value));
  });

  // ----- Test connection: probe /health via the background service worker -
  testBtn.addEventListener("click", function () {
    if (!isValidUrl(urlEl.value)) {
      setUrlError(true);
      setStatus("error", "URL không hợp lệ.");
      return;
    }
    // Flush any pending debounced save so the probe uses the current URL.
    if (saveTimer) clearTimeout(saveTimer);
    saveAdapterSettings();

    testBtn.disabled = true;
    setStatus("loading", "Đang kiểm tra…");

    chrome.runtime.sendMessage(
      { action: "aiHealth", timeoutMs: TEST_TIMEOUT_MS },
      function (resp) {
        testBtn.disabled = false;
        if (chrome.runtime.lastError) {
          setStatus("error", "Không gọi được service worker.");
          return;
        }
        if (!resp || !resp.ok) {
          var err = (resp && resp.error) || { code: "network" };
          setStatus(err.code === "auth" ? "warn" : "error", toUserMessage(err));
          return;
        }
        // Adapter reachable; distinguish logged-in from not-configured.
        var authed = resp.health && resp.health.auth && resp.health.auth.configured;
        if (authed) {
          setStatus("ok", "Đã kết nối · đã đăng nhập.");
        } else {
          setStatus("warn", "Đã kết nối nhưng chưa đăng nhập.");
        }
      }
    );
  });
})();
