/*
 * Jira Mod - background service worker (transport only)
 *
 * The content script runs in the page origin (insight.fsoft.com.vn) and cannot
 * fetch the local AI adapter directly: the adapter sends no CORS headers and has
 * no OPTIONS handler, so a page-origin request is blocked at preflight. This
 * service worker holds the host permission for http://127.0.0.1:4924/* and so
 * can fetch it CORS-free. Content -> chrome.runtime.sendMessage -> here -> fetch.
 *
 * Stateless by design: a service worker can be terminated between messages, so
 * config is read on every call and nothing is cached across invocations.
 */
"use strict";

var DEFAULT_ADAPTER = "http://127.0.0.1:4924";
var DEFAULT_TIMEOUT_MS = 45000;
var MODEL = "jira-mod"; // Adapter forces its own model; this value is ignored.

// Read config fresh each call (SW may have been killed since the last message).
function getConfig() {
  return new Promise(function (resolve) {
    chrome.storage.sync.get(
      { aiAdapterUrl: DEFAULT_ADAPTER, aiTimeoutMs: DEFAULT_TIMEOUT_MS },
      function (cfg) {
        var url = (cfg.aiAdapterUrl || DEFAULT_ADAPTER).replace(/\/+$/, "");
        var timeoutMs = Number(cfg.aiTimeoutMs) || DEFAULT_TIMEOUT_MS;
        resolve({ url: url, timeoutMs: timeoutMs });
      }
    );
  });
}

// OpenAI-shaped content: choices[0].message.content is a string OR an array of
// {type,text} parts. Return the plain text either way.
function extractContent(payload) {
  var content =
    payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(function (p) {
        return p && p.type === "text" && typeof p.text === "string";
      })
      .map(function (p) {
        return p.text;
      })
      .join("");
  }
  return "";
}

// Throw a shaped error {code, message, status?} the content script can map.
function fail(code, message, status) {
  var e = new Error(message || code);
  e.code = code;
  if (status) e.status = status;
  return e;
}

// A single fetch with an AbortController timeout.
function fetchWithTimeout(resource, options, timeoutMs) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () {
    ctrl.abort();
  }, timeoutMs);
  options = options || {};
  options.signal = ctrl.signal;
  return fetch(resource, options).finally(function () {
    clearTimeout(timer);
  });
}

// POST /v1/chat/completions and return the assistant text.
function callChat(messages, timeoutMs, url) {
  var body = JSON.stringify({ model: MODEL, messages: messages, stream: false });
  return fetchWithTimeout(
    url + "/v1/chat/completions",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: body },
    timeoutMs
  )
    .catch(function (err) {
      throw err && err.name === "AbortError"
        ? fail("timeout", "Yêu cầu quá thời gian.")
        : fail("network", (err && err.message) || "Không kết nối được adapter.");
    })
    .then(function (res) {
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw fail("auth", "Adapter chưa đăng nhập.", res.status);
        }
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw fail("upstream", "AI upstream lỗi.", res.status);
        }
        throw fail("http", "Adapter trả lỗi.", res.status);
      }
      return res.json().catch(function () {
        throw fail("empty", "Adapter trả về không phải JSON.");
      });
    })
    .then(function (payload) {
      var text = extractContent(payload);
      if (!text || !text.trim()) throw fail("empty", "AI trả về rỗng.");
      return text;
    });
}

// GET /health -> {status, auth:{configured}}. Optional readiness probe.
function probeHealth(timeoutMs, url) {
  return fetchWithTimeout(url + "/health", { method: "GET" }, timeoutMs)
    .catch(function () {
      throw fail("network", "Không kết nối được adapter.");
    })
    .then(function (res) {
      if (!res.ok) throw fail("http", "Health lỗi.", res.status);
      return res.json();
    });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      var cfg = await getConfig();
      var timeoutMs = msg && msg.timeoutMs ? msg.timeoutMs : cfg.timeoutMs;
      if (msg && msg.action === "aiSuggest") {
        var content = await callChat(msg.messages, timeoutMs, cfg.url);
        sendResponse({ ok: true, content: content });
      } else if (msg && msg.action === "aiHealth") {
        var health = await probeHealth(timeoutMs, cfg.url);
        sendResponse({ ok: true, health: health });
      } else {
        sendResponse({ ok: false, error: { code: "bad_action" } });
      }
    } catch (err) {
      sendResponse({
        ok: false,
        error: {
          code: (err && err.code) || "network",
          message: err && err.message,
          status: err && err.status
        }
      });
    }
  })();
  return true; // Keep the message channel open for the async sendResponse.
});
