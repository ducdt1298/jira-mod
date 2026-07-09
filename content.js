/*
 * Jira Mod - Hide optional fields
 *
 * On Jira Data Center workflow transition dialogs (Resolve, Close, Reopen, ...),
 * hide every non-required field by default and expose a toggle to reveal them.
 * This spares the user from scrolling past optional fields to reach the next
 * required one.
 */
(function () {
  "use strict";

  // The transition dialog is reliably identified by this submit button id.
  var SUBMIT_ID = "issue-workflow-transition-submit";

  // Toggle button labels (user-facing, Vietnamese).
  var SHOW_TEXT = "Hiện các trường không bắt buộc";
  var HIDE_TEXT = "Ẩn các trường không bắt buộc";

  var enabled = true; // Master switch, persisted in chrome.storage.
  var observer = new MutationObserver(schedule);

  /*
   * Resolve the transition <form> from its submit button.
   * The submit button lives in the dialog FOOTER, OUTSIDE the <form>, so
   * closest('form') does not work. Walk up to the dialog container instead,
   * then grab the form inside it.
   */
  function findTransitionForm(submitEl) {
    var container = submitEl.closest(
      ".jira-dialog2, .aui-dialog2, .jira-dialog, .jira-dialog-content"
    );
    if (container) {
      var form = container.querySelector("form");
      if (form) return form;
    }
    // Fallback: the transition form posts to CommentAssignIssue.jspa.
    return document.querySelector('form[action*="CommentAssignIssue"]');
  }

  // A field-group is required when it contains the AUI required-icon span.
  function isRequired(fieldGroup) {
    return !!fieldGroup.querySelector(".icon-required");
  }

  /*
   * Re-classify every field-group by its CURRENT required state. Idempotent, so
   * it can run on every mutation: required fields are always shown, optional
   * ones are hidden. This is needed because the Jira Behaviours plugin can turn
   * fields required/optional dynamically (e.g. based on the chosen Resolution),
   * and a field that becomes required must never stay hidden.
   */
  function syncFields(form) {
    var groups = form.querySelectorAll(".field-group");
    var optionalCount = 0;
    var firstGroup = null;
    groups.forEach(function (fieldGroup) {
      if (!firstGroup) firstGroup = fieldGroup;
      if (isRequired(fieldGroup)) {
        fieldGroup.classList.remove("jira-mod-optional", "jira-mod-hidden");
      } else {
        fieldGroup.classList.add("jira-mod-optional", "jira-mod-hidden");
        optionalCount++;
      }
    });
    return { optionalCount: optionalCount, firstGroup: firstGroup };
  }

  function updateButtonLabel(form, button, optionalCount) {
    var showing = form.classList.contains("jira-mod-show-optional");
    button.textContent = showing
      ? HIDE_TEXT
      : SHOW_TEXT + " (" + optionalCount + ")";
  }

  function insertToggleButton(form, firstGroup) {
    var wrap = document.createElement("div");
    wrap.className = "jira-mod-toggle-wrap";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "jira-mod-toggle";
    button.addEventListener("click", function () {
      form.classList.toggle("jira-mod-show-optional");
      updateButtonLabel(form, button, Number(form.dataset.jiraModOptional || 0));
    });

    wrap.appendChild(button);
    firstGroup.parentNode.insertBefore(wrap, firstGroup);
    return button;
  }

  function processForm(form) {
    var info = syncFields(form);
    if (!form.querySelectorAll(".field-group").length) {
      return; // Form not fully rendered yet; a later mutation will retry.
    }

    var button = form.querySelector(".jira-mod-toggle");

    // First pass on this form: add the toggle button once.
    if (!form.dataset.jiraModProcessed) {
      form.dataset.jiraModProcessed = "1";
      if (info.optionalCount > 0 && info.firstGroup && info.firstGroup.parentNode) {
        button = insertToggleButton(form, info.firstGroup);
      }
    }

    // Keep the counter/label in sync (optional count can change via Behaviours).
    form.dataset.jiraModOptional = String(info.optionalCount);
    if (button) updateButtonLabel(form, button, info.optionalCount);
  }

  // Undo every change on a form: remove the button, classes and markers.
  function revertForm(form) {
    var wrap = form.querySelector(".jira-mod-toggle-wrap");
    if (wrap) wrap.remove();
    form.classList.remove("jira-mod-show-optional");
    form.querySelectorAll(".field-group").forEach(function (fieldGroup) {
      fieldGroup.classList.remove("jira-mod-optional", "jira-mod-hidden");
    });
    delete form.dataset.jiraModProcessed;
    delete form.dataset.jiraModOptional;
  }

  function forEachTransitionForm(callback) {
    var seen = [];
    document.querySelectorAll("#" + SUBMIT_ID).forEach(function (submitEl) {
      var form = findTransitionForm(submitEl);
      if (form && seen.indexOf(form) === -1) {
        seen.push(form);
        callback(form);
      }
    });
  }

  function scan() {
    if (!enabled) return;
    forEachTransitionForm(processForm);
  }

  // Light debounce to coalesce bursts of mutations while Jira renders/updates.
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      scan();
    }, 50);
  }

  function start() {
    // childList/subtree only (not attributes), so our own class changes do not
    // re-trigger the observer into a loop.
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  function stop() {
    observer.disconnect();
    forEachTransitionForm(revertForm);
  }

  function apply() {
    if (enabled) start();
    else stop();
  }

  // Load the persisted enabled state, then react to changes from the popup.
  chrome.storage.sync.get({ enabled: true }, function (cfg) {
    enabled = cfg.enabled;
    apply();
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "sync" && changes.enabled) {
      enabled = changes.enabled.newValue;
      apply();
    }
  });
})();
