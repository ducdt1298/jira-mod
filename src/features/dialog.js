/*
 * Jira Mod — dialog features
 *
 * Everything that happens inside a transition / edit / create dialog. Each
 * feature gates itself on the active profile (see src/core/features.js for the
 * contract); a profile that configures nothing gets nothing.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod;
  var dom = JiraMod.dom;
  var ai = JiraMod.ai;

  // User-facing strings (Vietnamese). UI wording, not site knowledge.
  var SHOW_TEXT = "Hiện các trường không bắt buộc";
  var HIDE_TEXT = "Ẩn các trường không bắt buộc";
  var DEFAULT_BTN_LABEL = "mặc định";

  // Class names shared with content.css.
  var CLS = {
    optional: "jira-mod-optional",
    hidden: "jira-mod-hidden",
    showOptional: "jira-mod-show-optional",
    toggleWrap: "jira-mod-toggle-wrap",
    toggle: "jira-mod-toggle",
    block: "jira-mod-fields",
    pair: "jira-mod-pair",
    wide: "jira-mod-wide",
    aiBar: "jira-mod-ai-bar",
    aiBtn: "jira-mod-ai-btn",
    aiStatus: "jira-mod-ai-status"
  };

  // Read a recipe key, or null when the recipe is absent / does not use it.
  // This one helper is what keeps every feature's config() a single line.
  function fromRecipe(ctx, key) {
    var value = ctx.recipe ? ctx.recipe[key] : null;
    if (!value) return null;
    if (Array.isArray(value) && !value.length) return null;
    return value;
  }

  // The configured default for a label, from the recipe's autoFill list — so
  // the on-open auto-fill and the per-field buttons share one source of truth.
  function defaultValueFor(recipe, label) {
    var want = dom.norm(label);
    var list = (recipe && recipe.autoFill) || [];
    for (var i = 0; i < list.length; i++) {
      if (dom.norm(list[i].label) === want) return list[i].value;
    }
    return null;
  }

  /* ---------------------------------------------------------------------------
   * 1. Hide optional fields + toggle
   * The one feature every profile gets. Re-classifies every field-group by its
   * CURRENT required state on each pass, because the Behaviours plugin can turn
   * fields required/optional on the fly (e.g. after choosing a Resolution) and a
   * field that becomes required must never stay hidden.
   * ------------------------------------------------------------------------- */
  var hideOptional = {
    id: "hideOptional",
    surface: "dialog",

    config: function (ctx) {
      return ctx.profile.hideOptional;
    },

    apply: function (ctx, cfg) {
      var form = ctx.form;
      var groups = dom.fieldGroups(form);
      if (!groups.length) return; // form not rendered yet; a later scan retries.

      var requiredCount = 0;
      var optionalCount = 0;
      groups.forEach(function (g) {
        if (dom.isRequired(g)) requiredCount++;
        else optionalCount++;
      });

      /*
       * Nothing required at all (the comment dialog, some transition screens):
       * hiding every field would leave a dialog with no inputs, which is worse
       * than the problem we solve. Back out instead.
       */
      if (cfg.skipIfNoRequired && requiredCount === 0) {
        hideOptional.revert(form);
        return;
      }

      groups.forEach(function (g) {
        var optional = !dom.isRequired(g);
        g.classList.toggle(CLS.optional, optional);
        g.classList.toggle(CLS.hidden, optional);
      });

      var button = form.querySelector("." + CLS.toggle);
      if (!button && optionalCount > 0 && groups[0].parentNode) {
        button = insertToggle(form, groups[0]);
      }
      form.dataset.jiraModOptional = String(optionalCount);
      if (button) label(form, button, optionalCount);
    },

    revert: function (form) {
      var wrap = form.querySelector("." + CLS.toggleWrap);
      if (wrap) wrap.remove();
      form.classList.remove(CLS.showOptional);
      dom.fieldGroups(form).forEach(function (g) {
        g.classList.remove(CLS.optional, CLS.hidden);
      });
      delete form.dataset.jiraModOptional;
    }
  };

  function label(form, button, optionalCount) {
    button.textContent = form.classList.contains(CLS.showOptional)
      ? HIDE_TEXT
      : SHOW_TEXT + " (" + optionalCount + ")";
  }

  function insertToggle(form, firstGroup) {
    var wrap = document.createElement("div");
    wrap.className = CLS.toggleWrap;

    var button = document.createElement("button");
    button.type = "button";
    button.className = CLS.toggle;
    button.addEventListener("click", function () {
      form.classList.toggle(CLS.showOptional);
      label(form, button, Number(form.dataset.jiraModOptional || 0));
    });

    wrap.appendChild(button);
    firstGroup.parentNode.insertBefore(wrap, firstGroup);
    return button;
  }

  /* ---------------------------------------------------------------------------
   * 2. Auto-fill defaults
   * Fill each configured field once, and only while it is still empty. Runs on
   * every scan so fields the Behaviours plugin reveals later still get filled.
   * A per-control marker guarantees a field is touched at most once, so a value
   * the user later changes or clears is never overwritten.
   * ------------------------------------------------------------------------- */
  var autoFill = {
    id: "autoFill",
    surface: "dialog",

    config: function (ctx) {
      return fromRecipe(ctx, "autoFill");
    },

    apply: function (ctx, entries) {
      entries.forEach(function (entry) {
        var group = dom.groupByLabel(ctx.form, entry.label);
        if (!group) return;
        var el = dom.fieldControl(group);
        if (!el || el.dataset.jiraModFilled) return;
        el.dataset.jiraModFilled = "1"; // touch each control at most once
        if (dom.isControlEmpty(el)) dom.setControl(el, entry.value);
      });
    },

    revert: function (form) {
      form.querySelectorAll("[data-jira-mod-filled]").forEach(function (el) {
        delete el.dataset.jiraModFilled;
      });
    }
  };

  /* ---------------------------------------------------------------------------
   * 3. Group the classification dropdowns into one compact, full-width block
   * ------------------------------------------------------------------------- */
  var groupBlock = {
    id: "groupBlock",
    surface: "dialog",

    config: function (ctx) {
      return fromRecipe(ctx, "groupBlock");
    },

    apply: function (ctx, labels) {
      dom.wrapGroups(ctx.form, CLS.block, dom.groupsByLabels(ctx.form, labels));
    },

    revert: function (form) {
      dom.unwrapAll(form, CLS.block);
    }
  };

  /* ---------------------------------------------------------------------------
   * 4. Two-column row + wider dialog
   * The two fields are not adjacent in the DOM (an optional "(translated)" twin
   * can sit between them), so they are moved into a shared wrapper.
   * ------------------------------------------------------------------------- */
  var pairLayout = {
    id: "pairLayout",
    surface: "dialog",

    config: function (ctx) {
      return fromRecipe(ctx, "pair");
    },

    apply: function (ctx, labels) {
      // Widen only once both columns are actually in place, so a half-rendered
      // form never leaves the dialog stretched around a single field.
      if (!dom.wrapGroups(ctx.form, CLS.pair, dom.groupsByLabels(ctx.form, labels))) {
        return;
      }
      var dialog = ctx.form.closest(dom.DIALOG_ROOTS);
      if (dialog) dialog.classList.add(CLS.wide);
    },

    revert: function (form) {
      dom.unwrapAll(form, CLS.pair);
      var dialog = form.closest(dom.DIALOG_ROOTS);
      if (dialog) dialog.classList.remove(CLS.wide);
    }
  };

  /* ---------------------------------------------------------------------------
   * 5. Per-field "mặc định" button
   * Re-applies that ONE field's configured default, overwriting whatever is
   * there — handy after the user (or the AI) changed it. Independent of the
   * on-open auto-fill, which still runs.
   * ------------------------------------------------------------------------- */
  var defaultButtons = {
    id: "defaultButtons",
    surface: "dialog",

    config: function (ctx) {
      return fromRecipe(ctx, "defaultButtons");
    },

    apply: function (ctx, labels) {
      labels.forEach(function (labelText) {
        var group = dom.groupByLabel(ctx.form, labelText);
        if (!group || group.querySelector("[data-jira-mod-defbtn]")) return;
        var value = defaultValueFor(ctx.recipe, labelText);
        if (value == null) return;

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "aui-button aui-button-link jira-mod-def-btn";
        btn.dataset.jiraModDefbtn = "1";
        btn.textContent = DEFAULT_BTN_LABEL;
        btn.title = "Điền giá trị mặc định: " + value;
        btn.addEventListener("click", function () {
          dom.setControl(dom.fieldControl(group), value);
        });

        // Sit inline next to the pulldown. For select2 fields the visible
        // element is the .select2-container (the real <select> is hidden), so
        // anchor on that when present; otherwise on the control itself.
        var visible =
          group.querySelector(".select2-container") || dom.fieldControl(group);
        if (visible && visible.parentNode) visible.insertAdjacentElement("afterend", btn);
        else group.appendChild(btn);
      });
    },

    revert: function (form) {
      form.querySelectorAll("[data-jira-mod-defbtn]").forEach(function (b) {
        b.remove();
      });
    }
  };

  /* ---------------------------------------------------------------------------
   * 6. AI analyse-and-fill bar
   * ------------------------------------------------------------------------- */
  var aiBar = {
    id: "aiBar",
    surface: "dialog",

    config: function (ctx) {
      return ctx.recipe && ctx.recipe.ai ? ctx.recipe.ai : null;
    },

    apply: function (ctx, spec) {
      var form = ctx.form;
      if (form.querySelector("." + CLS.aiBar)) return; // already injected

      var bar = document.createElement("div");
      bar.className = CLS.aiBar;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aui-button aui-button-primary " + CLS.aiBtn;
      btn.textContent = spec.buttonLabel;

      var status = document.createElement("span");
      status.className = CLS.aiStatus;

      bar.appendChild(btn);
      bar.appendChild(status);

      // Sit above the toggle so the AI action is the first thing seen.
      var anchor =
        form.querySelector("." + CLS.toggleWrap) ||
        form.querySelector("." + CLS.block) ||
        dom.fieldGroups(form)[0];
      if (!anchor || !anchor.parentNode) return; // nothing rendered yet; retry later
      anchor.parentNode.insertBefore(bar, anchor);

      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        // Pre-flight the adapter so an offline / not-logged-in one fails fast
        // (~5s) instead of waiting out the full chat timeout.
        setState(bar, "loading", "Đang kiểm tra kết nối…");
        ai.checkReady(spec)
          .then(function () {
            setState(bar, "loading", "Đang tạo gợi ý…");
            return ai.request(spec, ai.collect(form, spec));
          })
          .then(
            function (values) {
              ai.fill(form, spec, values);
              setState(bar, "done", "Đã điền gợi ý.");
            },
            function (err) {
              setState(bar, "error", ai.toUserMessage(err));
            }
          );
      });
    },

    revert: function (form) {
      form.querySelectorAll("." + CLS.aiBar).forEach(function (b) {
        b.remove();
      });
    }
  };

  function setState(bar, state, message) {
    var btn = bar.querySelector("." + CLS.aiBtn);
    var status = bar.querySelector("." + CLS.aiStatus);
    btn.classList.toggle("is-loading", state === "loading");
    btn.disabled = state === "loading";
    status.textContent = message || "";
    status.classList.toggle("is-error", state === "error");
    status.classList.toggle("is-done", state === "done");
  }

  // Order matters: hide/toggle first (later features anchor on the toggle),
  // then content, then layout, then the controls that decorate the layout.
  [hideOptional, autoFill, groupBlock, pairLayout, defaultButtons, aiBar].forEach(
    JiraMod.features.register
  );
})(window);
