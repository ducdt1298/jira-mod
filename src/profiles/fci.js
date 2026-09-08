/*
 * Site profile — FCI Jira (jira.fci.vn)
 *
 * Jira Data Center 8.5.6. Same AUI markup as FSOFT Insight (`div.field-group` +
 * `span.icon-required`), so the generic "hide optional fields" layer works
 * as-is. Two things differ, and they shape this profile:
 *
 * 1. NO WORKFLOW TRANSITION SCREENS.
 *    Surveyed via REST (`/transitions?expand=transitions.fields`) on SDC plus
 *    the busiest bug projects (XMO, FSEC, XDPAAS, XK8S, CTM): every transition
 *    reports zero fields, i.e. Jira runs them straight through without opening
 *    a dialog. A transition-only extension would therefore never fire here.
 *    Where the optional-field noise actually lives on this instance is the
 *    Edit and Create dialogs (the Edit screen alone carries 16 field-groups of
 *    which 2 are required), so those are enhanced too. The transition dialog
 *    stays declared: it costs nothing and covers any project that later gets a
 *    transition screen.
 *
 * 2. NO DEFECT-CLASSIFICATION FIELDS.
 *    "Defect Origin", "Defect Type", "Direct Cause of Defect" and "Correction
 *    Action" do not exist anywhere in this instance's field list, so there is
 *    no bug-Resolve recipe to run and `recipes` is deliberately empty — the AI
 *    bar, auto-fill and the two-column layout simply never activate here.
 *
 *    Careful if that changes: the customfield ids the FSOFT recipe falls back
 *    to are TAKEN on this instance and mean something else entirely —
 *      customfield_10219 = "Operational categorization"  (not Defect Origin)
 *      customfield_10220 = "Pending reason"              (not Defect Type)
 *      customfield_10217 = "Investigation reason"        (not Cause Category)
 *    That is exactly why every recipe resolves its fields by LABEL first. To
 *    add a recipe here, copy the shape from src/profiles/fsoft.js and fill in
 *    this instance's own labels and ids — never reuse FSOFT's.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod;
  var D = JiraMod.profiles.DIALOGS;

  JiraMod.profiles.register({
    id: "fci",
    label: "FCI Jira",
    hosts: ["jira.fci.vn"],

    dialogs: [D.transition, D.edit, D.create],

    // The Edit/Create dialogs are wide-open forms; a screen where nothing is
    // required would collapse to nothing at all, so leave those alone.
    hideOptional: { skipIfNoRequired: true },

    /*
     * The SDC board ships only two Quick Filters ("Only My Issues", "Recently
     * Updated") and adding more needs board-admin rights on a board the whole
     * team shares. The filter bar gives every member the rest, client-side,
     * without touching that shared configuration.
     */
    board: {
      facets: ["assignee", "type", "priority", "status", "epic"],
      hideDoneToggle: true
    },

    recipes: []
  });
})(window);
