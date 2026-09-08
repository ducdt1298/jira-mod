/*
 * Jira Mod — engine
 *
 * Finds the things the active profile cares about and runs the matching
 * features over each of them, on every DOM mutation.
 *
 * A SURFACE is a kind of place a feature can live. Each one knows how to find
 * its instances on the page and how to describe one as a context:
 *
 *   dialog   every transition / edit / create form currently open
 *   board    the agile board, when one is rendered
 *
 * The engine knows nothing about any specific Jira instance and nothing about
 * any specific enhancement: it wires a profile (data) to features (behaviour).
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod || (root.JiraMod = {});
  var dom = JiraMod.dom;
  var profiles = JiraMod.profiles;

  var SCAN_DEBOUNCE_MS = 50;

  var profile = null;
  var enabled = true;
  var scheduled = false;
  var observer = new MutationObserver(schedule);

  /*
   * Every dialog form currently on the page, paired with the dialog spec that
   * found it. The submit button of a transition dialog lives in the dialog
   * FOOTER, OUTSIDE the <form>, so closest('form') does not work — walk up to
   * the dialog container and take the form inside it, with the profile's
   * formSelector as the fallback.
   *
   * A form is claimed by the first dialog spec that finds it, so the same form
   * is never processed twice in one scan.
   */
  function dialogContexts() {
    var found = [];
    profile.dialogs.forEach(function (dialog) {
      document.querySelectorAll(dialog.submitSelector).forEach(function (submitEl) {
        var container = submitEl.closest(dom.DIALOG_CONTAINERS);
        var form =
          (container && container.querySelector("form")) ||
          (dialog.formSelector ? document.querySelector(dialog.formSelector) : null);
        if (!form || !dom.fieldGroups(form).length) return;
        var known = found.some(function (e) {
          return e.form === form;
        });
        if (known) return;
        found.push({
          form: form,
          dialog: dialog,
          profile: profile,
          recipe: profiles.recipeFor(profile, form, dialog.id)
        });
      });
    });
    return found;
  }

  // The agile board, when the work view is rendered. At most one per page.
  function boardContexts() {
    var boardRoot = JiraMod.board.root();
    return boardRoot ? [{ root: boardRoot, profile: profile }] : [];
  }

  var SURFACES = [
    {
      name: "dialog",
      contexts: dialogContexts,
      rootOf: function (ctx) {
        return ctx.form;
      },
      // content.css only hides fields inside a form we have processed.
      prepare: function (ctx) {
        ctx.form.dataset.jiraModProcessed = "1";
      },
      cleanup: function (form) {
        delete form.dataset.jiraModProcessed;
      }
    },
    {
      name: "board",
      contexts: boardContexts,
      rootOf: function (ctx) {
        return ctx.root;
      }
    }
  ];

  // Run one feature, contained: a throw in one enhancement must not stop the
  // rest of the pipeline from running on every future mutation.
  function runGuarded(what, fn) {
    try {
      fn();
    } catch (err) {
      console.warn("[Jira Mod] " + what + " failed:", err);
    }
  }

  function processSurface(surface) {
    var features = JiraMod.features.bySurface(surface.name);
    if (!features.length) return;

    surface.contexts().forEach(function (ctx) {
      if (surface.prepare) surface.prepare(ctx);
      features.forEach(function (feature) {
        var cfg = feature.config(ctx);
        if (!cfg) return;
        runGuarded(feature.id, function () {
          feature.apply(ctx, cfg);
        });
      });
    });
  }

  // Undo every change on a surface, in reverse order of application.
  function revertSurface(surface) {
    var features = JiraMod.features.bySurface(surface.name);
    surface.contexts().forEach(function (ctx) {
      var target = surface.rootOf(ctx);
      for (var i = features.length - 1; i >= 0; i--) {
        var feature = features[i];
        runGuarded(feature.id + ".revert", function () {
          feature.revert(target);
        });
      }
      if (surface.cleanup) surface.cleanup(target);
    });
  }

  function scan() {
    if (!enabled) return;
    SURFACES.forEach(processSurface);
  }

  // Light debounce to coalesce bursts of mutations while Jira renders/updates.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      scan();
    }, SCAN_DEBOUNCE_MS);
  }

  function start() {
    // childList/subtree only (not attributes), so our own class changes do not
    // re-trigger the observer into a loop.
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  function stop() {
    observer.disconnect();
    SURFACES.forEach(revertSurface);
  }

  function apply() {
    if (enabled) start();
    else stop();
  }

  // Bind the engine to a profile and follow the popup's master switch.
  function boot(siteProfile) {
    profile = siteProfile;
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
  }

  JiraMod.engine = { boot: boot, scan: scan };
})(window);
