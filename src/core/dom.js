/*
 * Jira Mod — DOM helpers
 *
 * Site-agnostic layer. Everything here relies only on the AUI markup that every
 * Jira Data Center dialog shares (`div.field-group` + `span.icon-required`), so
 * it works unchanged on any Jira DC instance.
 *
 * Site-specific knowledge (labels, values, custom-field ids) belongs in
 * src/profiles/ — never here.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod || (root.JiraMod = {});

  /*
   * Dialog container classes across Jira DC generations: 8.x renders
   * `.jira-dialog`, newer AUI renders `.aui-dialog2` / `.jira-dialog2`.
   * Declared once and reused by the form lookup, the "widen dialog" toggle and
   * the revert path, so those three can never drift apart.
   */
  var DIALOG_CONTAINERS =
    ".jira-dialog2, .aui-dialog2, .jira-dialog, .jira-dialog-content";

  /*
   * The same list minus `.jira-dialog-content`, which is an INNER wrapper. Used
   * when a class has to land on the dialog itself (e.g. widening it): matching
   * the inner wrapper there would style the wrong box.
   */
  var DIALOG_ROOTS = ".jira-dialog2, .aui-dialog2, .jira-dialog";

  // Option texts that mean "nothing chosen".
  var PLACEHOLDER = /^(none|-- none --|please select\.\.\.|select\.\.\.)$/i;

  // Collapse whitespace, trim, lowercase — the canonical form for matching.
  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function fieldGroups(form) {
    return Array.prototype.slice.call(form.querySelectorAll(".field-group"));
  }

  // A field-group is required when it carries the AUI required-icon span.
  function isRequired(fieldGroup) {
    return !!fieldGroup.querySelector(".icon-required");
  }

  /*
   * The label text of a field-group, normalized, minus the required markers.
   * Jira marks "required" two ways: an .icon-required span AND a
   * .visually-hidden "Required" text node — strip both, plus a trailing
   * "required" word as a belt-and-braces fallback.
   */
  function fieldLabel(fieldGroup) {
    var label = fieldGroup.querySelector("label");
    if (!label) return "";
    var clone = label.cloneNode(true);
    clone
      .querySelectorAll(
        ".aui-icon, .icon-required, .error, .description, .visually-hidden"
      )
      .forEach(function (n) {
        n.remove();
      });
    return norm(clone.textContent).replace(/\s*required$/, "");
  }

  /*
   * The primary editable control inside a field-group. Prefer the real <select>
   * (for select2 fields it is present but hidden and comes AFTER the select2
   * helper <input>s in the DOM, so a combined selector would wrongly pick the
   * helper). Then textarea, then a plain text input (never a select2 helper).
   */
  function fieldControl(fieldGroup) {
    return (
      fieldGroup.querySelector("select") ||
      fieldGroup.querySelector("textarea") ||
      fieldGroup.querySelector(
        "input[type='text']:not(.select2-input):not(.select2-focusser), input:not([type])"
      )
    );
  }

  // Find the (first) field-group whose label matches exactly. Exact match only:
  // a startsWith match would also catch optional "... (translated)" twin fields.
  function groupByLabel(form, wantLabel) {
    var want = norm(wantLabel);
    var groups = fieldGroups(form);
    for (var i = 0; i < groups.length; i++) {
      if (fieldLabel(groups[i]) === want) return groups[i];
    }
    return null;
  }

  function groupsByLabels(form, labels) {
    return labels.map(function (l) {
      return groupByLabel(form, l);
    });
  }

  // True when the form carries at least one of the given labels. Used to decide
  // whether a profile recipe applies to this particular dialog.
  function hasAnyLabel(form, labels) {
    var wanted = labels.map(norm);
    return fieldGroups(form).some(function (g) {
      return wanted.indexOf(fieldLabel(g)) !== -1;
    });
  }

  // Fire the events Jira / the Behaviours plugin listen for. Dispatched native
  // events reach page-side jQuery handlers too (same DOM/event system).
  function fireEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // A <select> counts as "not chosen" when it sits on a placeholder option.
  function isSelectEmpty(sel) {
    if (sel.selectedIndex < 0) return true;
    var v = norm(sel.value);
    if (v === "" || v === "-1") return true;
    var opt = sel.options[sel.selectedIndex];
    var t = norm(opt ? opt.textContent : "");
    return t === "" || PLACEHOLDER.test(t);
  }

  // Select the option whose text (or value) matches want. Returns true if set.
  function setSelect(sel, want) {
    var wanted = norm(want);
    var chosen = null;
    var i;
    for (i = 0; i < sel.options.length; i++) {
      if (
        norm(sel.options[i].textContent) === wanted ||
        norm(sel.options[i].value) === wanted
      ) {
        chosen = sel.options[i];
        break;
      }
    }
    if (!chosen) {
      // Looser fallback: an option that starts with the wanted text.
      for (i = 0; i < sel.options.length; i++) {
        if (norm(sel.options[i].textContent).indexOf(wanted) === 0) {
          chosen = sel.options[i];
          break;
        }
      }
    }
    if (!chosen) return false;
    sel.value = chosen.value;
    fireEvents(sel);
    return true;
  }

  // Write a value into any control type. Returns true when something changed.
  function setControl(el, value) {
    if (!el || value == null || value === "") return false;
    if (el.tagName === "SELECT") return setSelect(el, value);
    el.value = value;
    fireEvents(el);
    return true;
  }

  // True when the control holds no meaningful value yet.
  function isControlEmpty(el) {
    if (!el) return false;
    return el.tagName === "SELECT" ? isSelectEmpty(el) : norm(el.value) === "";
  }

  // The chosen option's text of a <select> (works for select2: the real hidden
  // <select> keeps the value). "" when nothing meaningful is chosen.
  function selectedText(sel) {
    if (!sel || sel.tagName !== "SELECT" || sel.selectedIndex < 0) return "";
    var opt = sel.options[sel.selectedIndex];
    var t = opt ? opt.textContent.trim() : "";
    return PLACEHOLDER.test(t) ? "" : t;
  }

  // All selectable option texts (skips placeholders). Fed to the model so it
  // can only pick values that actually exist in the dropdown.
  function optionTexts(sel) {
    if (!sel || sel.tagName !== "SELECT") return [];
    var out = [];
    for (var i = 0; i < sel.options.length; i++) {
      var t = (sel.options[i].textContent || "").trim();
      if (!t || PLACEHOLDER.test(t)) continue;
      out.push(t);
    }
    return out;
  }

  // Visible text of a page element, whitespace-tidied and optionally capped.
  function readText(selector, cap) {
    var el = selector ? document.querySelector(selector) : null;
    var v = el ? (el.innerText || el.textContent || "").trim() : "";
    v = v.replace(/\n{3,}/g, "\n\n");
    if (cap && v.length > cap) v = v.slice(0, cap) + " …[cắt bớt]";
    return v;
  }

  // True when `wrap` already holds exactly `groups`, in order — the signal that
  // a layout pass can bail out instead of re-shuffling the DOM on every scan.
  function alreadyWrapped(wrap, groups) {
    if (!wrap) return false;
    var mine = Array.prototype.filter.call(wrap.children, function (c) {
      return groups.indexOf(c) !== -1;
    });
    return (
      mine.length === groups.length &&
      mine.every(function (c, i) {
        return c === groups[i];
      })
    );
  }

  /*
   * Move `groups` into a single wrapper div with `className`, in order.
   * Idempotent: a no-op once the wrapper already holds them, and it re-wraps if
   * the Behaviours plugin re-renders the form and drops the wrapper. Moving the
   * whole field-group keeps each field's select2 container (a sibling of the
   * hidden <select>) and its contenteditable wiki editor intact.
   * Returns the wrapper, or null when a group is missing (a later scan retries).
   */
  function wrapGroups(form, className, groups) {
    if (
      !groups.length ||
      groups.some(function (g) {
        return !g;
      })
    ) {
      return null;
    }
    var wrap = form.querySelector("." + className);
    if (alreadyWrapped(wrap, groups)) return wrap;
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = className;
    }
    // Anchor the wrapper where the first group sits — but only while it is not
    // already in the DOM, otherwise we could try to insert it into itself.
    if (!wrap.isConnected) groups[0].parentNode.insertBefore(wrap, groups[0]);
    // appendChild MOVES nodes, so appending all of them in order also fixes the
    // order of any that happened to be inside already.
    groups.forEach(function (g) {
      wrap.appendChild(g);
    });
    return wrap;
  }

  // Dissolve a wrapper: put its children back where it stood, then drop it.
  function unwrapAll(form, className) {
    form.querySelectorAll("." + className).forEach(function (wrap) {
      while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });
  }

  JiraMod.dom = {
    DIALOG_CONTAINERS: DIALOG_CONTAINERS,
    DIALOG_ROOTS: DIALOG_ROOTS,
    norm: norm,
    fieldGroups: fieldGroups,
    isRequired: isRequired,
    fieldLabel: fieldLabel,
    fieldControl: fieldControl,
    groupByLabel: groupByLabel,
    groupsByLabels: groupsByLabels,
    hasAnyLabel: hasAnyLabel,
    fireEvents: fireEvents,
    isSelectEmpty: isSelectEmpty,
    isControlEmpty: isControlEmpty,
    setSelect: setSelect,
    setControl: setControl,
    selectedText: selectedText,
    optionTexts: optionTexts,
    readText: readText,
    wrapGroups: wrapGroups,
    unwrapAll: unwrapAll
  };
})(window);
