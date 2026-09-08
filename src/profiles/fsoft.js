/*
 * Site profile — FSOFT Insight Jira (insight.fsoft.com.vn/jiradc)
 *
 * Jira Data Center. Transition screens carry the FSOFT defect-classification
 * fields, so this instance gets the full bug-Resolve recipe: auto-fill, the
 * compact classification block, the two-column cause/correction row, per-field
 * default buttons and the AI suggest bar.
 *
 * Everything below is data. To change what gets filled, edit the values here —
 * no logic to touch.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod;
  var D = JiraMod.profiles.DIALOGS;

  // The four classification dropdowns, in display order. Reused as the compact
  // block, as the fields that get a "mặc định" button, and (with the two text
  // fields) as the AI targets — declared once so they cannot drift apart.
  var CLASSIFICATION = [
    "resolution",
    "defect origin",
    "defect type",
    "cause category"
  ];

  // The two free-text fields laid out side by side and written by the AI.
  var CAUSE = "direct cause of defect";
  var CORRECTION = "correction action";

  // Style anchors for the AI's Vietnamese answers.
  var EXAMPLE_CAUSE = "Design thiếu mô tả hoặc mô tả chưa rõ";
  var EXAMPLE_CORRECTION = "Check và fix theo đúng yêu cầu mô tả";

  var bugResolve = {
    id: "bug-resolve",

    // The form is a bug Resolve only when it carries the defect fields — so we
    // never force Resolution = Fixed on an ordinary transition dialog.
    markerLabels: ["defect origin", "defect type", "cause category"],

    // Filled once each, only while still empty; never overwrites a user edit.
    autoFill: [
      { label: "Resolution", value: "Fixed" },
      { label: "Defect Origin", value: "Coding" },
      { label: "Defect Type", value: "Cod_Coding Standard" },
      { label: "Cause Category", value: "CAR_Carelessness" },
      { label: "Direct Cause of Defect", value: EXAMPLE_CAUSE },
      { label: "Correction Action", value: EXAMPLE_CORRECTION }
    ],

    groupBlock: CLASSIFICATION,
    pair: [CAUSE, CORRECTION],
    defaultButtons: CLASSIFICATION,

    ai: {
      buttonLabel: "✨ Phân tích & điền bằng AI",
      persona:
        "Bạn là trợ lý QA. Dựa trên thông tin bug, hãy phân tích và đề xuất giá trị " +
        "cho các trường phân loại lỗi và nguyên nhân.",
      textRule: "viết bằng TIẾNG VIỆT, ngắn gọn (một cụm, khoảng dưới 15 từ)",
      maxTextLength: 200,
      healthTimeoutMs: 5000,

      // Summary and description live on the issue page BEHIND the dialog.
      context: {
        summarySelector: "#summary-val",
        summaryMax: 400,
        descriptionSelector: "#description-val",
        descriptionMax: 4000
      },

      /*
       * Fields are located by LABEL first; `selector` is only the fallback.
       * That ordering matters: these customfield ids are FSOFT-specific and the
       * very same ids mean different fields on other Jira instances, so an
       * id-first lookup would be a foot-gun the moment a recipe is reused.
       */
      fields: [
        {
          key: "resolution",
          label: "resolution",
          type: "select",
          selector: "select#resolution, select[name='resolution']"
        },
        {
          key: "defectOrigin",
          label: "defect origin",
          type: "select",
          selector: "select#customfield_10219, select[name='customfield_10219']"
        },
        {
          key: "defectType",
          label: "defect type",
          type: "select",
          selector: "select#customfield_10220, select[name='customfield_10220']"
        },
        {
          key: "causeCategory",
          label: "cause category",
          type: "select",
          selector: "select#customfield_10217, select[name='customfield_10217']"
        },
        {
          key: "directCause",
          label: CAUSE,
          type: "text",
          selector: "textarea#customfield_10206, textarea[name='customfield_10206']",
          example: EXAMPLE_CAUSE
        },
        {
          key: "correctionAction",
          label: CORRECTION,
          type: "text",
          selector: "textarea#customfield_10504, textarea[name='customfield_10504']",
          example: EXAMPLE_CORRECTION
        }
      ]
    }
  };

  JiraMod.profiles.register({
    id: "fsoft",
    label: "FSOFT Insight Jira",
    hosts: ["insight.fsoft.com.vn"],

    dialogs: [D.transition],

    // Keeps the long-standing behaviour on this instance: a transition dialog
    // with no required field at all still gets everything collapsed behind the
    // toggle. Flip to true to leave such dialogs untouched instead.
    hideOptional: { skipIfNoRequired: false },

    // The board filter bar is generic GreenHopper — it would work here too.
    // Left off so this instance's behaviour is unchanged; enable by copying the
    // `board` block from src/profiles/fci.js.
    board: null,

    recipes: [bugResolve]
  });
})(window);
