// Popup: reflects and updates the master enabled switch stored in chrome.storage.
(function () {
  "use strict";

  var checkbox = document.getElementById("enabled");

  // Load the current state (enabled by default).
  chrome.storage.sync.get({ enabled: true }, function (cfg) {
    checkbox.checked = cfg.enabled;
  });

  // Persist changes; the content script listens for this and applies live.
  checkbox.addEventListener("change", function () {
    chrome.storage.sync.set({ enabled: checkbox.checked });
  });
})();
