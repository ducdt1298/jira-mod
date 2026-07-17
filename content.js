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

  /*
   * Auto-fill defaults for the BUG Resolve dialog.
   *
   * Each entry maps a field by its (normalized) label to the value we want.
   * A field is only filled when it is still EMPTY / "not chosen", and each
   * field is touched at most once, so a value the user later changes or clears
   * is never overwritten. For <select> the value is matched against option
   * text (or option value); for text inputs / textareas it is set verbatim.
   *
   * Labels/values live here so they are easy to edit without touching logic.
   */
  var AUTO_FILL = [
    { label: "Resolution", value: "Fixed" },
    { label: "Defect Origin", value: "Coding" },
    { label: "Defect Type", value: "Cod_Coding Standard" },
    { label: "Cause Category", value: "CAR_Carelessness" },
    { label: "Direct Cause of Defect", value: "Design thiếu mô tả hoặc mô tả chưa rõ" },
    { label: "Correction Action", value: "Check và fix theo đúng yêu cầu mô tả" }
  ];

  // The six fields the AI analyses and fills, in display order. Each is located
  // by its (normalized) label with a customfield-id selector as fallback.
  //  - key:        the JSON key the model must return.
  //  - label:      normalized field-group label (matches fieldLabel()).
  //  - idSelector: fallback control selector when the label lookup misses.
  //  - type:       "select" (choose an option) or "text" (free text).
  var AI_FIELDS = [
    { key: "resolution", label: "resolution", type: "select",
      idSelector: "select#resolution, select[name='resolution']" },
    { key: "defectOrigin", label: "defect origin", type: "select",
      idSelector: "select#customfield_10219, select[name='customfield_10219']" },
    { key: "defectType", label: "defect type", type: "select",
      idSelector: "select#customfield_10220, select[name='customfield_10220']" },
    { key: "causeCategory", label: "cause category", type: "select",
      idSelector: "select#customfield_10217, select[name='customfield_10217']" },
    { key: "directCause", label: "direct cause of defect", type: "text",
      idSelector: "textarea#customfield_10206, textarea[name='customfield_10206']" },
    { key: "correctionAction", label: "correction action", type: "text",
      idSelector: "textarea#customfield_10504, textarea[name='customfield_10504']" }
  ];

  // The four dropdowns that get a per-field "fill default" button, and are
  // grouped into a single-column, full-width block. Their default values come
  // from AUTO_FILL (reused, single source of truth). Order matches the dialog.
  var DEFAULT_FIELD_LABELS = [
    "resolution",
    "defect origin",
    "defect type",
    "cause category"
  ];
  var FIELD_LABELS = DEFAULT_FIELD_LABELS;

  // Small, per-field default button (user-facing, Vietnamese).
  var DEFAULT_BTN_LABEL = "mặc định";

  // Labels that mark the form as a *bug* Resolve (so we do not force Resolution
  // = Fixed on ordinary transition dialogs that lack these defect fields).
  var BUG_MARKER_LABELS = ["defect origin", "defect type", "cause category"];

  // Two fields to lay out side by side (left, right) on the bug Resolve dialog.
  // The dialog is also widened so both columns have room. Matched by label.
  var PAIR_LABELS = ["direct cause of defect", "correction action"];

  // AI suggest: a button in the pair row calls the local adapter (via the
  // background service worker) and fills the two wiki fields on demand.
  var AI_BTN_LABEL = "✨ Phân tích & điền bằng AI";
  var AI_SUMMARY_MAX = 400; // chars of #summary-val sent as context
  var AI_DESC_MAX = 4000; // chars of #description-val sent as context
  var AI_HEALTH_TIMEOUT_MS = 5000; // fast pre-flight probe before the chat call
  // Two example values that anchor the AI's language / length / style.
  var AI_EXAMPLE_DIRECT = "Design thiếu mô tả hoặc mô tả chưa rõ";
  var AI_EXAMPLE_CORRECTION = "Check và fix theo đúng yêu cầu mô tả";

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

  // Normalize a string for matching: collapse whitespace, trim, lowercase.
  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // The label text of a field-group, minus the required-icon / error markers.
  // Jira marks "required" two ways: an .icon-required span AND a
  // .visually-hidden "Required" text node — strip both, plus a trailing
  // "required" word as a belt-and-braces fallback.
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

  // The primary editable control inside a field-group. Prefer the real <select>
  // (for select2 fields it is present but hidden and comes AFTER the select2
  // helper <input>s in the DOM, so a combined selector would wrongly pick the
  // helper). Then textarea, then a plain text input (never a select2 helper).
  function fieldControl(fieldGroup) {
    return (
      fieldGroup.querySelector("select") ||
      fieldGroup.querySelector("textarea") ||
      fieldGroup.querySelector(
        "input[type='text']:not(.select2-input):not(.select2-focusser), input:not([type])"
      )
    );
  }

  // Fire the events Jira / the Behaviours plugin listen for. Dispatched native
  // events reach page-side jQuery handlers too (they share the DOM/event system).
  function fireEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // A <select> counts as "not chosen" when it sits on a placeholder / None option.
  function isSelectEmpty(sel) {
    if (sel.selectedIndex < 0) return true;
    var v = norm(sel.value);
    if (v === "" || v === "-1") return true;
    var opt = sel.options[sel.selectedIndex];
    var t = norm(opt ? opt.textContent : "");
    return t === "" || t === "none" || t === "-- none --" || t === "select...";
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

  // The configured default value for a normalized label (from AUTO_FILL), or
  // null when the label has no default. Reused by both the on-open auto-fill
  // and the per-field "default" buttons so there is one source of truth.
  function defaultValueFor(normLabel) {
    for (var i = 0; i < AUTO_FILL.length; i++) {
      if (norm(AUTO_FILL[i].label) === normLabel) return AUTO_FILL[i].value;
    }
    return null;
  }

  // True only when the form is a bug Resolve (has the defect-specific fields).
  function looksLikeBugResolve(form) {
    var groups = form.querySelectorAll(".field-group");
    for (var i = 0; i < groups.length; i++) {
      if (BUG_MARKER_LABELS.indexOf(fieldLabel(groups[i])) !== -1) return true;
    }
    return false;
  }

  /*
   * Fill each configured field once, if empty. Runs on every scan so fields
   * that Behaviours reveals later (e.g. Cause Category after Defect Type) still
   * get filled when they appear. A per-control marker guarantees we never touch
   * a field twice, so user edits are preserved and we cannot loop.
   */
  function autoFillForm(form) {
    if (!looksLikeBugResolve(form)) return;
    form.querySelectorAll(".field-group").forEach(function (fieldGroup) {
      var labelText = fieldLabel(fieldGroup);
      if (!labelText) return;

      // Exact match only: a startsWith match would also catch the optional
      // "... (translated)" twin fields, which we must leave untouched.
      var entry = null;
      for (var i = 0; i < AUTO_FILL.length; i++) {
        if (labelText === norm(AUTO_FILL[i].label)) {
          entry = AUTO_FILL[i];
          break;
        }
      }
      if (!entry) return;

      var el = fieldControl(fieldGroup);
      if (!el || el.dataset.jiraModFilled) return;
      el.dataset.jiraModFilled = "1"; // Touch each control at most once.

      if (el.tagName === "SELECT") {
        if (isSelectEmpty(el)) setSelect(el, entry.value);
      } else if (norm(el.value) === "") {
        el.value = entry.value;
        fireEvents(el);
      }
    });
  }

  // Find the (first) field-group in a form whose label matches exactly.
  function findGroupByLabel(form, wantLabel) {
    var groups = form.querySelectorAll(".field-group");
    for (var i = 0; i < groups.length; i++) {
      if (fieldLabel(groups[i]) === wantLabel) return groups[i];
    }
    return null;
  }

  /*
   * Widen the bug Resolve dialog and place the two PAIR_LABELS field-groups side
   * by side in a flex row. The two fields are not adjacent in the DOM (an
   * optional "(translated)" field sits between them), so we move them into a
   * wrapper. The editors are contenteditable (not iframes), so relocating the
   * nodes preserves their content. Idempotent, and re-pairs if Behaviours
   * re-renders and drops our wrapper.
   */
  /*
   * Gather the four classification dropdowns (Resolution, Defect Origin, Defect
   * Type, Cause Category) into a single-column, full-width block. They are
   * contiguous field-groups near the top of the form. Moving the whole
   * field-group keeps each field's select2 container (a sibling of the hidden
   * <select>) intact. Idempotent, and re-groups if Behaviours re-renders and
   * drops our wrapper.
   */
  function enhanceFields(form) {
    if (!looksLikeBugResolve(form)) return;

    var groups = FIELD_LABELS.map(function (l) {
      return findGroupByLabel(form, l);
    });
    if (
      groups.some(function (g) {
        return !g;
      })
    ) {
      return; // not all present yet; a later scan retries.
    }

    var block = form.querySelector(".jira-mod-fields");
    if (
      block &&
      groups.every(function (g) {
        return block.contains(g);
      })
    ) {
      return; // already grouped
    }
    if (!block) {
      block = document.createElement("div");
      block.className = "jira-mod-fields";
    }
    // Anchor the block where the first dropdown sits, then move all four in.
    groups[0].parentNode.insertBefore(block, groups[0]);
    groups.forEach(function (g) {
      block.appendChild(g);
    });
  }

  function enhanceLayout(form) {
    if (!looksLikeBugResolve(form)) return;

    var dialog = form.closest(".aui-dialog2, .jira-dialog2");
    if (dialog) dialog.classList.add("jira-mod-wide");

    var left = findGroupByLabel(form, PAIR_LABELS[0]);
    var right = findGroupByLabel(form, PAIR_LABELS[1]);
    if (!left || !right) return;

    var pair = form.querySelector(".jira-mod-pair");
    if (pair && pair.contains(left) && pair.contains(right)) return; // already paired

    if (!pair) {
      pair = document.createElement("div");
      pair.className = "jira-mod-pair";
    }
    // Anchor the row where the left field currently sits, then move both in.
    left.parentNode.insertBefore(pair, left);
    pair.appendChild(left);
    pair.appendChild(right);
  }

  /*
   * Add a small "default" button to each of the four classification dropdowns.
   * Clicking it re-applies that ONE field's configured default (from AUTO_FILL),
   * overwriting whatever is there — handy after the user changed a field or the
   * AI filled something. Independent of the on-open auto-fill, which still runs.
   * Idempotent per field (a data-marker), so it survives Behaviours re-renders.
   */
  function enhanceDefaultButtons(form) {
    if (!looksLikeBugResolve(form)) return;
    DEFAULT_FIELD_LABELS.forEach(function (labelText) {
      var group = findGroupByLabel(form, labelText);
      if (!group) return;
      if (group.querySelector("[data-jira-mod-defbtn]")) return; // already added
      var value = defaultValueFor(labelText);
      if (value == null) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aui-button aui-button-link jira-mod-def-btn";
      btn.dataset.jiraModDefbtn = "1";
      btn.textContent = DEFAULT_BTN_LABEL;
      btn.title = "Điền giá trị mặc định: " + value;
      btn.addEventListener("click", function () {
        var el = fieldControl(group);
        if (el && el.tagName === "SELECT") setSelect(el, value);
      });

      // Sit inline right next to the pulldown. For select2 fields the visible
      // element is the .select2-container (the real <select> is hidden), so
      // anchor on that; otherwise on the <select> itself.
      var visible = group.querySelector(".select2-container") || fieldControl(group);
      if (visible && visible.parentNode) visible.insertAdjacentElement("afterend", btn);
      else group.appendChild(btn);
    });
  }

  /* ---------------------------------------------------------------------------
   * AI suggest: fill "Direct Cause of Defect" and "Correction Action" from the
   * bug context via the local adapter. All network I/O goes through the
   * background service worker (the adapter sends no CORS headers, so a
   * page-origin fetch would be blocked).
   * ------------------------------------------------------------------------- */

  // The selected option's text of a <select> (works for select2: the real
  // hidden <select> keeps the value). "" when nothing meaningful is chosen.
  function selectedText(root, selector) {
    var sel = root.querySelector(selector);
    if (!sel || sel.selectedIndex < 0) return "";
    var opt = sel.options[sel.selectedIndex];
    var t = opt ? opt.textContent.trim() : "";
    return /^(none|please select\.\.\.|-- none --)$/i.test(t) ? "" : t;
  }

  // All selectable option texts of a <select> (skips None/placeholder). Fed to
  // the model so it picks a value that actually exists in each dropdown.
  function selectOptions(root, selector) {
    var sel = root.querySelector(selector);
    if (!sel) return [];
    var out = [];
    for (var i = 0; i < sel.options.length; i++) {
      var t = (sel.options[i].textContent || "").trim();
      if (!t) continue;
      if (/^(none|please select\.\.\.|-- none --)$/i.test(t)) continue;
      out.push(t);
    }
    return out;
  }

  // Read the bug context to feed the model. summary/description live on the
  // issue page BEHIND the dialog (classic view); selects live in the form. For
  // each dropdown we also send the list of valid options so the model returns a
  // value that maps to a real option.
  function gatherBugContext(form) {
    function text(sel, cap) {
      var el = document.querySelector(sel);
      var v = el ? (el.innerText || el.textContent || "").trim() : "";
      v = v.replace(/\n{3,}/g, "\n\n");
      if (cap && v.length > cap) v = v.slice(0, cap) + " …[cắt bớt]";
      return v;
    }
    var origin = "select#customfield_10219, select[name='customfield_10219']";
    var type = "select#customfield_10220, select[name='customfield_10220']";
    var cause = "select#customfield_10217, select[name='customfield_10217']";
    return {
      summary: text("#summary-val", AI_SUMMARY_MAX),
      description: text("#description-val", AI_DESC_MAX),
      resolution: selectedText(form, "#resolution"),
      defectOrigin: selectedText(form, origin),
      defectType: selectedText(form, type),
      causeCategory: selectedText(form, cause),
      options: {
        resolution: selectOptions(form, "#resolution"),
        defectOrigin: selectOptions(form, origin),
        defectType: selectOptions(form, type),
        causeCategory: selectOptions(form, cause)
      }
    };
  }

  // Build the OpenAI-style messages. On a repair pass, feed back the previous
  // (invalid) raw output and the reason so the model corrects itself.
  function buildMessages(ctx, repair) {
    var system =
      "Bạn là trợ lý QA. Dựa trên thông tin bug, hãy phân tích và đề xuất giá trị cho " +
      "các trường phân loại lỗi và nguyên nhân. Trả về DUY NHẤT một JSON hợp lệ với đúng " +
      'sáu khóa: "resolution", "defectOrigin", "defectType", "causeCategory", ' +
      '"directCause", "correctionAction". Với bốn khóa đầu, giá trị PHẢI là một trong ' +
      "các lựa chọn được cung cấp bên dưới (chép chính xác nguyên văn). Với " +
      '"directCause" và "correctionAction", viết bằng TIẾNG VIỆT, ngắn gọn (một cụm, ' +
      "khoảng dưới 15 từ). Không markdown, không giải thích, không văn bản thừa. " +
      'Ví dụ hai khóa cuối: {"directCause":"' +
      AI_EXAMPLE_DIRECT +
      '","correctionAction":"' +
      AI_EXAMPLE_CORRECTION +
      '"}';

    var opts = ctx.options || {};
    function optList(arr) {
      return arr && arr.length ? arr.join(" | ") : "(không có)";
    }

    var user =
      "Summary: " +
      (ctx.summary || "(không có)") +
      "\n\nDescription:\n" +
      (ctx.description || "(không có)") +
      "\n\nLựa chọn hợp lệ cho từng trường (chọn đúng một, chép nguyên văn):" +
      "\n- resolution: " +
      optList(opts.resolution) +
      "\n- defectOrigin: " +
      optList(opts.defectOrigin) +
      "\n- defectType: " +
      optList(opts.defectType) +
      "\n- causeCategory: " +
      optList(opts.causeCategory) +
      "\n\nGiá trị đang chọn (nếu có): resolution=" +
      (ctx.resolution || "(chưa chọn)") +
      ", defectOrigin=" +
      (ctx.defectOrigin || "(chưa chọn)") +
      ", defectType=" +
      (ctx.defectType || "(chưa chọn)") +
      ", causeCategory=" +
      (ctx.causeCategory || "(chưa chọn)");

    var messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
    if (repair) {
      messages.push({ role: "assistant", content: repair.prevRaw });
      messages.push({
        role: "user",
        content:
          "Phản hồi trước không hợp lệ: " +
          repair.error +
          ". Trả lại DUY NHẤT JSON đúng sáu khóa resolution, defectOrigin, " +
          "defectType, causeCategory, directCause, correctionAction."
      });
    }
    return messages;
  }

  // Round-trip a chat request through the background service worker.
  function sendChat(messages) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { action: "aiSuggest", messages: messages },
        function (resp) {
          if (chrome.runtime.lastError) {
            return reject({ code: "runtime", message: chrome.runtime.lastError.message });
          }
          if (!resp || !resp.ok) return reject((resp && resp.error) || { code: "network" });
          resolve(resp.content);
        }
      );
    });
  }

  // Fast readiness probe through the background worker. Resolves with the
  // health payload ({status, auth:{configured}}) or rejects with a shaped
  // error. Lets the AI button report a stopped/unauthed adapter in ~5s instead
  // of waiting out the full chat timeout.
  function sendHealth() {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { action: "aiHealth", timeoutMs: AI_HEALTH_TIMEOUT_MS },
        function (resp) {
          if (chrome.runtime.lastError) {
            return reject({ code: "runtime", message: chrome.runtime.lastError.message });
          }
          if (!resp || !resp.ok) return reject((resp && resp.error) || { code: "network" });
          resolve(resp.health);
        }
      );
    });
  }

  // Pull a JSON object out of possibly-chatty model text (strip ``` fences,
  // slice from first { to last }).
  function extractJson(text) {
    var t = String(text || "").replace(/```(?:json)?/gi, "");
    var a = t.indexOf("{");
    var b = t.lastIndexOf("}");
    if (a === -1 || b === -1 || b < a) throw { code: "invalid", message: "không thấy JSON" };
    return JSON.parse(t.slice(a, b + 1));
  }

  function validateSuggestion(obj) {
    if (!obj || typeof obj !== "object") throw { code: "invalid", message: "không phải object" };
    function str(v) {
      return typeof v === "string" ? v.trim() : "";
    }
    // The two text fields anchor validity (and the repair retry). The four
    // dropdown values are best-effort: kept if present, applied via setSelect
    // which tolerates near-matches and silently skips anything unmatched.
    var d = str(obj.directCause);
    var c = str(obj.correctionAction);
    if (!d || !c) throw { code: "invalid", message: "thiếu directCause/correctionAction" };
    if (d.length > 200 || c.length > 200) throw { code: "invalid", message: "giá trị quá dài" };
    return {
      resolution: str(obj.resolution),
      defectOrigin: str(obj.defectOrigin),
      defectType: str(obj.defectType),
      causeCategory: str(obj.causeCategory),
      directCause: d,
      correctionAction: c
    };
  }

  // One AI call, then exactly one repair retry on parse/validation failure.
  async function requestSuggestion(ctx) {
    var raw = await sendChat(buildMessages(ctx));
    try {
      return validateSuggestion(extractJson(raw));
    } catch (e1) {
      var raw2 = await sendChat(
        buildMessages(ctx, { prevRaw: raw, error: (e1 && e1.message) || "invalid" })
      );
      return validateSuggestion(extractJson(raw2));
    }
  }

  // Write all six suggestions (overwrite on purpose — this is an explicit user
  // action). Selects go through setSelect (matches option text/value); text
  // fields are set verbatim. findGroupByLabel matches labels exactly, so the
  // "(translated)" twins are never targeted; the id-selector is the fallback.
  function fillSuggestion(form, s) {
    AI_FIELDS.forEach(function (f) {
      var value = s[f.key];
      if (!value) return; // dropdown the model left blank / unmatched: skip.
      var group = findGroupByLabel(form, f.label);
      var el = group ? fieldControl(group) : form.querySelector(f.idSelector);
      if (!el) return;
      if (el.tagName === "SELECT") {
        setSelect(el, value);
      } else {
        el.value = value;
        fireEvents(el);
      }
    });
  }

  // Map an error code to a Vietnamese, user-facing message.
  function toUserMessage(err) {
    var code = (err && err.code) || "network";
    switch (code) {
      case "auth":
        return "Phiên AI adapter hết hạn — mở app trên máy và đăng nhập lại.";
      case "timeout":
        return "AI phản hồi quá lâu, thử lại.";
      case "upstream":
      case "http":
        return "AI tạm lỗi" + (err && err.status ? " (mã " + err.status + ")" : "") + ", thử lại sau.";
      case "invalid":
      case "empty":
        return "AI trả dữ liệu không hợp lệ, thử lại.";
      default:
        return "Không kết nối được AI adapter — mở app trên máy rồi thử lại.";
    }
  }

  function setAiState(bar, state, message) {
    var btn = bar.querySelector(".jira-mod-ai-btn");
    var status = bar.querySelector(".jira-mod-ai-status");
    btn.classList.toggle("is-loading", state === "loading");
    btn.disabled = state === "loading";
    status.textContent = message || "";
    status.classList.toggle("is-error", state === "error");
    status.classList.toggle("is-done", state === "done");
  }

  // Insert the AI bar (button + status) at the top of the form, above the
  // classification fields. Idempotent per DOM presence, so it re-appears if
  // Behaviours re-renders the form.
  function enhanceAiFill(form) {
    if (!looksLikeBugResolve(form)) return;
    var block = form.querySelector(".jira-mod-fields");
    if (!block) return; // enhanceFields has not run yet; a later scan retries.
    if (form.querySelector(".jira-mod-ai-bar")) return; // already injected

    var bar = document.createElement("div");
    bar.className = "jira-mod-ai-bar";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aui-button aui-button-primary jira-mod-ai-btn";
    btn.textContent = AI_BTN_LABEL;

    var status = document.createElement("span");
    status.className = "jira-mod-ai-status";

    bar.appendChild(btn);
    bar.appendChild(status);
    // Sit above the toggle (if present) so the AI action is the first thing seen.
    var anchor = form.querySelector(".jira-mod-toggle-wrap") || block;
    anchor.parentNode.insertBefore(bar, anchor);

    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      // Pre-flight: verify the adapter is up and logged in before the (slow)
      // chat call, so an offline/unauthed adapter fails fast (~5s).
      setAiState(bar, "loading", "Đang kiểm tra kết nối…");
      sendHealth()
        .then(function (health) {
          if (!health || !health.auth || !health.auth.configured) {
            throw { code: "auth" };
          }
          setAiState(bar, "loading", "Đang tạo gợi ý…");
          return requestSuggestion(gatherBugContext(form));
        })
        .then(
          function (s) {
            fillSuggestion(form, s);
            setAiState(bar, "done", "Đã điền gợi ý.");
          },
          function (err) {
            setAiState(bar, "error", toUserMessage(err));
          }
        );
    });
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

    // Fill the bug-resolve defaults (no-op on non-bug dialogs / filled fields).
    autoFillForm(form);

    // Lay out the bug Resolve dialog (bug resolve only): group the four
    // classification dropdowns, widen the dialog and pair the two text fields.
    enhanceFields(form);
    enhanceLayout(form);

    // Per-field "default" buttons on the four dropdowns.
    enhanceDefaultButtons(form);

    // Add the AI analyse-and-fill bar at the top of the form.
    enhanceAiFill(form);
  }

  // Undo every change on a form: remove the button, classes and markers.
  function revertForm(form) {
    var wrap = form.querySelector(".jira-mod-toggle-wrap");
    if (wrap) wrap.remove();
    form.classList.remove("jira-mod-show-optional");
    form.querySelectorAll(".field-group").forEach(function (fieldGroup) {
      fieldGroup.classList.remove("jira-mod-optional", "jira-mod-hidden");
    });
    form.querySelectorAll("[data-jira-mod-filled]").forEach(function (el) {
      delete el.dataset.jiraModFilled;
    });
    // Remove the AI bar and the per-field "default" buttons.
    form.querySelectorAll(".jira-mod-ai-bar").forEach(function (b) {
      b.remove();
    });
    form.querySelectorAll("[data-jira-mod-defbtn]").forEach(function (b) {
      b.remove();
    });
    // Undo the layout wrappers: move the fields back out, then drop the wrappers.
    form.querySelectorAll(".jira-mod-fields, .jira-mod-pair").forEach(function (wrap) {
      while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });
    var dialog = form.closest(".aui-dialog2, .jira-dialog2");
    if (dialog) dialog.classList.remove("jira-mod-wide");
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
