/*
 * Jira Mod — site profile registry
 *
 * One Jira instance = one profile. A profile is pure DATA: it says which
 * dialogs to touch and which automation "recipes" that instance's screens
 * support. The engine and the features never branch on hostname — they read
 * the resolved profile. Supporting a new Jira means adding a file under
 * src/profiles/, not editing logic.
 *
 * ---------------------------------------------------------------------------
 * SiteProfile
 *   id            string    stable key, e.g. "fsoft"
 *   label         string    human name, shown in the popup / logs
 *   hosts         string[]  exact hostnames this profile owns
 *   dialogs       Dialog[]  which Jira dialogs to enhance (see below)
 *   hideOptional  { skipIfNoRequired: boolean }
 *                           skipIfNoRequired: leave the form alone when NOTHING
 *                           is required — hiding everything would otherwise
 *                           leave an empty dialog (e.g. the comment dialog).
 *   board         Board?    agile-board filter bar; null (default) = off
 *   recipes       Recipe[]  site-specific automation, matched per form
 *
 * Board
 *   facets         string[] facet ids to offer, in order. Known ids live in
 *                           FACETS in src/features/board.js.
 *   hideDoneToggle bool?    also offer a one-click "Ẩn Done" switch
 *
 * Dialog
 *   id             string   "transition" | "edit" | "create" | ...
 *   submitSelector string   the submit button that identifies the dialog
 *   formSelector   string?  fallback used when the button sits outside any
 *                           recognizable dialog container
 *
 * Recipe — an automation bundle for ONE kind of screen (e.g. "bug resolve").
 *   id            string
 *   markerLabels  string[]  the form matches when ANY of these labels is on it
 *   dialogs       string[]? restrict to these dialog ids (default: all)
 *   autoFill      {label,value}[]?   fill each field once, only while empty
 *   groupBlock    string[]?          labels to gather into one full-width block
 *   pair          [string,string]?   two labels to lay out side by side
 *   defaultButtons string[]?         labels that get a "mặc định" button
 *                                    (values come from autoFill — one source)
 *   ai            AiSpec?            see src/core/ai.js for the shape
 *
 * Every optional key is genuinely optional: a profile that omits `recipes`
 * simply gets the generic "hide optional fields + toggle" behaviour.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod || (root.JiraMod = {});

  var registry = [];

  // Dialog specs shared by every Jira DC instance. A profile picks the subset
  // that is actually worth enhancing on that instance.
  var DIALOGS = {
    transition: {
      id: "transition",
      submitSelector: "#issue-workflow-transition-submit",
      // The transition form posts to CommentAssignIssue.jspa — the fallback for
      // when the submit button is not inside a recognizable dialog container.
      formSelector: "form[action*='CommentAssignIssue']"
    },
    edit: {
      id: "edit",
      submitSelector: "#issue-edit-submit",
      formSelector: "form#issue-edit"
    },
    create: {
      id: "create",
      submitSelector: "#issue-create-submit",
      formSelector: "form#issue-create"
    }
  };

  // Fill in the optional parts so the engine can read a profile without
  // defensive checks at every use site.
  function normalize(profile) {
    return {
      id: profile.id,
      label: profile.label || profile.id,
      hosts: profile.hosts || [],
      dialogs: profile.dialogs || [DIALOGS.transition],
      hideOptional: Object.assign(
        { skipIfNoRequired: true },
        profile.hideOptional || {}
      ),
      board: profile.board
        ? Object.assign({ facets: [], hideDoneToggle: false }, profile.board)
        : null,
      recipes: (profile.recipes || []).map(function (r) {
        return Object.assign({ dialogs: null, markerLabels: [] }, r);
      })
    };
  }

  function register(profile) {
    registry.push(normalize(profile));
  }

  // The profile owning `host`, or null. Exact hostname match: two Jira
  // instances never share a host, so there is nothing fuzzy to resolve.
  function forHost(host) {
    var h = String(host || "").toLowerCase();
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].hosts.indexOf(h) !== -1) return registry[i];
    }
    return null;
  }

  /*
   * The recipe that applies to `form`, or null. A recipe claims a form when the
   * dialog is in scope AND at least one of its marker labels is present — so a
   * bug-resolve recipe never fires on an ordinary transition dialog that lacks
   * the defect fields. First match wins; order recipes most-specific first.
   */
  function recipeFor(profile, form, dialogId) {
    var dom = JiraMod.dom;
    for (var i = 0; i < profile.recipes.length; i++) {
      var r = profile.recipes[i];
      if (r.dialogs && r.dialogs.indexOf(dialogId) === -1) continue;
      if (!r.markerLabels.length) continue;
      if (dom.hasAnyLabel(form, r.markerLabels)) return r;
    }
    return null;
  }

  JiraMod.profiles = {
    DIALOGS: DIALOGS,
    register: register,
    forHost: forHost,
    recipeFor: recipeFor,
    all: function () {
      return registry.slice();
    }
  };
})(window);
