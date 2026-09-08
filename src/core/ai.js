/*
 * Jira Mod — AI suggest (spec-driven)
 *
 * Reads the bug context off the screen, asks the local adapter to fill a set of
 * fields, and writes the answer back. Which fields, how they are found and what
 * the model is told all come from the profile's AiSpec — nothing about any
 * particular Jira instance is hard-coded here.
 *
 * All network I/O goes through the background service worker: the adapter sends
 * no CORS headers, so a page-origin fetch would be blocked at preflight.
 *
 * ---------------------------------------------------------------------------
 * AiSpec
 *   buttonLabel     string    text of the "suggest" button
 *   persona         string    system-prompt lead-in (role + task)
 *   textRule        string    how free-text answers must be written
 *   maxTextLength   number    reject free-text answers longer than this (200)
 *   healthTimeoutMs number    pre-flight probe timeout (5000)
 *   context { summarySelector, summaryMax, descriptionSelector, descriptionMax }
 *                             where the issue text lives on the page BEHIND the
 *                             dialog, and how much of it to send
 *   fields  Field[]           the fields to suggest, in display order
 *
 * Field
 *   key       string  the JSON key the model must return
 *   label     string  field-group label used to locate the control
 *   type      "select" | "text"
 *   selector  string? control selector, used only when the label lookup misses
 *   required  bool?   answer must be non-empty (default: true for text fields,
 *                     false for selects — a dropdown the model leaves blank is
 *                     simply skipped)
 *   example   string? anchors the model's language / length / style
 * ---------------------------------------------------------------------------
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod || (root.JiraMod = {});
  var dom = JiraMod.dom;

  var DEFAULT_MAX_TEXT = 200;
  var DEFAULT_HEALTH_TIMEOUT_MS = 5000;

  function isRequiredField(field) {
    return field.required === undefined ? field.type === "text" : !!field.required;
  }

  function keysOfType(spec, type) {
    return spec.fields
      .filter(function (f) {
        return f.type === type;
      })
      .map(function (f) {
        return f.key;
      });
  }

  // Locate a field's control: by label first (instance-independent), falling
  // back to the profile's selector. Label-first is what lets one recipe survive
  // a custom-field id changing — or meaning something else on another instance.
  function controlFor(form, field) {
    var group = dom.groupByLabel(form, field.label);
    if (group) {
      var el = dom.fieldControl(group);
      if (el) return el;
    }
    return field.selector ? form.querySelector(field.selector) : null;
  }

  // Read everything the model needs: the issue text plus, for each field, its
  // current value and (for dropdowns) the list of options that actually exist.
  function collect(form, spec) {
    var ctx = spec.context || {};
    return {
      summary: dom.readText(ctx.summarySelector, ctx.summaryMax),
      description: dom.readText(ctx.descriptionSelector, ctx.descriptionMax),
      fields: spec.fields.map(function (f) {
        var el = controlFor(form, f);
        return {
          key: f.key,
          type: f.type,
          selected: el ? dom.selectedText(el) || (el.value || "").trim() : "",
          options: el ? dom.optionTexts(el) : []
        };
      })
    };
  }

  // Build the OpenAI-style messages from the spec. On a repair pass, feed back
  // the previous (invalid) raw output and the reason so the model corrects it.
  function buildMessages(spec, data, repair) {
    var selectKeys = keysOfType(spec, "select");
    var textKeys = keysOfType(spec, "text");
    var allKeys = spec.fields.map(function (f) {
      return f.key;
    });

    function quoted(keys) {
      return keys
        .map(function (k) {
          return '"' + k + '"';
        })
        .join(", ");
    }

    var examples = {};
    spec.fields.forEach(function (f) {
      if (f.example) examples[f.key] = f.example;
    });

    var system =
      spec.persona +
      " Trả về DUY NHẤT một JSON hợp lệ với đúng " +
      allKeys.length +
      " khóa: " +
      quoted(allKeys) +
      ".";
    if (selectKeys.length) {
      system +=
        " Với các khóa " +
        quoted(selectKeys) +
        ", giá trị PHẢI là một trong các lựa chọn được cung cấp bên dưới" +
        " (chép chính xác nguyên văn).";
    }
    if (textKeys.length) {
      system += " Với các khóa " + quoted(textKeys) + ", " + spec.textRule + ".";
    }
    system += " Không markdown, không giải thích, không văn bản thừa.";
    if (Object.keys(examples).length) {
      system += " Ví dụ: " + JSON.stringify(examples);
    }

    var lines = [
      "Summary: " + (data.summary || "(không có)"),
      "",
      "Description:",
      data.description || "(không có)"
    ];

    var withOptions = data.fields.filter(function (f) {
      return f.options.length;
    });
    if (withOptions.length) {
      lines.push("", "Lựa chọn hợp lệ cho từng trường (chọn đúng một, chép nguyên văn):");
      withOptions.forEach(function (f) {
        lines.push("- " + f.key + ": " + f.options.join(" | "));
      });
    }

    lines.push(
      "",
      "Giá trị đang chọn (nếu có): " +
        data.fields
          .map(function (f) {
            return f.key + "=" + (f.selected || "(chưa chọn)");
          })
          .join(", ")
    );

    var messages = [
      { role: "system", content: system },
      { role: "user", content: lines.join("\n") }
    ];
    if (repair) {
      messages.push({ role: "assistant", content: repair.prevRaw });
      messages.push({
        role: "user",
        content:
          "Phản hồi trước không hợp lệ: " +
          repair.error +
          ". Trả lại DUY NHẤT JSON đúng các khóa " +
          quoted(allKeys) +
          "."
      });
    }
    return messages;
  }

  // Pull a JSON object out of possibly-chatty model text (strip ``` fences,
  // slice from the first { to the last }).
  function extractJson(text) {
    var t = String(text || "").replace(/```(?:json)?/gi, "");
    var a = t.indexOf("{");
    var b = t.lastIndexOf("}");
    if (a === -1 || b === -1 || b < a) {
      throw { code: "invalid", message: "không thấy JSON" };
    }
    return JSON.parse(t.slice(a, b + 1));
  }

  /*
   * Keep only string values, and only for keys the spec declares. Required
   * fields anchor validity (and trigger the repair retry); optional ones are
   * best-effort — kept when present, and setSelect silently skips anything that
   * does not map to a real option.
   */
  function validate(spec, obj) {
    if (!obj || typeof obj !== "object") {
      throw { code: "invalid", message: "không phải object" };
    }
    var max = spec.maxTextLength || DEFAULT_MAX_TEXT;
    var out = {};
    var missing = [];
    spec.fields.forEach(function (f) {
      var v = typeof obj[f.key] === "string" ? obj[f.key].trim() : "";
      if (!v) {
        if (isRequiredField(f)) missing.push(f.key);
        return;
      }
      if (f.type === "text" && v.length > max) {
        throw { code: "invalid", message: "giá trị " + f.key + " quá dài" };
      }
      out[f.key] = v;
    });
    if (missing.length) {
      throw { code: "invalid", message: "thiếu " + missing.join(", ") };
    }
    return out;
  }

  // Round-trip one request through the background service worker.
  function send(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (resp) {
        if (chrome.runtime.lastError) {
          return reject({ code: "runtime", message: chrome.runtime.lastError.message });
        }
        if (!resp || !resp.ok) return reject((resp && resp.error) || { code: "network" });
        resolve(resp);
      });
    });
  }

  function sendChat(messages) {
    return send({ action: "aiSuggest", messages: messages }).then(function (r) {
      return r.content;
    });
  }

  /*
   * Fast readiness probe. Lets the button report a stopped or not-logged-in
   * adapter in ~5s instead of waiting out the full chat timeout. Rejects with
   * {code:"auth"} when the adapter answers but has no session.
   */
  function checkReady(spec) {
    var timeoutMs = spec.healthTimeoutMs || DEFAULT_HEALTH_TIMEOUT_MS;
    return send({ action: "aiHealth", timeoutMs: timeoutMs }).then(function (r) {
      var health = r.health;
      if (!health || !health.auth || !health.auth.configured) throw { code: "auth" };
      return health;
    });
  }

  // One AI call, then exactly one repair retry on parse/validation failure.
  async function request(spec, data) {
    var raw = await sendChat(buildMessages(spec, data));
    try {
      return validate(spec, extractJson(raw));
    } catch (e1) {
      var raw2 = await sendChat(
        buildMessages(spec, data, { prevRaw: raw, error: (e1 && e1.message) || "invalid" })
      );
      return validate(spec, extractJson(raw2));
    }
  }

  // Write the suggestions back. Overwrites on purpose — this is an explicit
  // user action, unlike the on-open auto-fill.
  function fill(form, spec, values) {
    spec.fields.forEach(function (f) {
      var value = values[f.key];
      if (!value) return; // field the model left blank / unmatched: skip.
      dom.setControl(controlFor(form, f), value);
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
        return (
          "AI tạm lỗi" +
          (err && err.status ? " (mã " + err.status + ")" : "") +
          ", thử lại sau."
        );
      case "invalid":
      case "empty":
        return "AI trả dữ liệu không hợp lệ, thử lại.";
      default:
        return "Không kết nối được AI adapter — mở app trên máy rồi thử lại.";
    }
  }

  JiraMod.ai = {
    controlFor: controlFor,
    collect: collect,
    buildMessages: buildMessages,
    extractJson: extractJson,
    validate: validate,
    checkReady: checkReady,
    request: request,
    fill: fill,
    toUserMessage: toUserMessage
  };
})(window);
