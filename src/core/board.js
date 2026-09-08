/*
 * Jira Mod — agile board data
 *
 * Jira renders board cards with almost nothing to filter on: the DOM carries
 * the issue key and summary, and the rest is icons with tooltips. The board's
 * own data endpoint, however, ships every attribute already —
 *
 *   /rest/greenhopper/1.0/xboard/work/allData.json?rapidViewId=<id>
 *
 * — so this module fetches it once per board and turns it into a
 * key -> attributes index the filter can join to the rendered cards. Same
 * origin, same session, and the exact data the board itself drew from, so
 * there is nothing to keep in sync.
 *
 * Generic GreenHopper markup: works on any Jira Data Center board.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod || (root.JiraMod = {});

  // Work ("Active sprints") mode only. The Backlog view is a different DOM and
  // a different endpoint; the filter simply does not appear there.
  var ROOT_SELECTOR = "#ghx-work";
  var CARD_SELECTOR = ".ghx-issue";
  var SWIMLANE_SELECTOR = ".ghx-swimlane";
  var CONTROLS_SELECTOR = ".ghx-controls-filters";

  var UNASSIGNED = "(Chưa gán)";
  var NO_EPIC = "(Không có Epic)";

  // rapidViewId -> { state: "loading"|"ready"|"error", map, version }
  var cache = {};
  var versionSeq = 0;

  function boardRoot() {
    return document.querySelector(ROOT_SELECTOR);
  }

  function controlsAnchor() {
    return document.querySelector(CONTROLS_SELECTOR);
  }

  function cards(scope) {
    return Array.prototype.slice.call(
      (scope || document).querySelectorAll(CARD_SELECTOR)
    );
  }

  function swimlanes(scope) {
    return Array.prototype.slice.call(
      (scope || document).querySelectorAll(SWIMLANE_SELECTOR)
    );
  }

  // The board id, from the URL that opened it. RapidBoard.jspa always carries
  // it; without one there is no board to index.
  function rapidViewId() {
    var id = new URLSearchParams(location.search).get("rapidView");
    return id && /^\d+$/.test(id) ? id : null;
  }

  /*
   * Flatten the board payload into key -> attributes.
   *
   * entityData holds the lookup tables the card icons are drawn from:
   *   types[id]      = { typeName, typeUrl }
   *   priorities[id] = { priorityName, priorityUrl }
   *   statuses[id]   = { statusName, status: {...} }
   *   epics[id]      = { epicField: { epicKey, text, epicColor } }
   */
  function buildIndex(payload) {
    var entity = payload.entityData || {};
    var types = entity.types || {};
    var priorities = entity.priorities || {};
    var statuses = entity.statuses || {};
    var epics = entity.epics || {};
    var issues = (payload.issuesData || {}).issues || [];

    var map = {};
    issues.forEach(function (issue) {
      var epic = epics[issue.epicId] && epics[issue.epicId].epicField;
      map[issue.key] = {
        key: issue.key,
        summary: issue.summary || "",
        assignee: issue.assigneeName || UNASSIGNED,
        type: (types[issue.typeId] || {}).typeName || "",
        priority: (priorities[issue.priorityId] || {}).priorityName || "",
        status: (statuses[issue.statusId] || {}).statusName || "",
        epic: epic ? epic.text || epic.epicKey : NO_EPIC,
        done: !!issue.done
      };
    });
    return map;
  }

  /*
   * The index for a board. Returns the cached entry immediately (so callers can
   * render without waiting) and kicks off the fetch on first ask; `onReady` is
   * called once the data lands, which is the filter's cue to re-render.
   *
   * A failed fetch is not retried on every mutation — the entry stays in
   * "error" and the filter degrades to key/summary search only.
   */
  function index(id, onReady) {
    var entry = cache[id];
    if (entry) return entry;

    entry = cache[id] = { state: "loading", map: {}, version: ++versionSeq };
    fetch(
      "/rest/greenhopper/1.0/xboard/work/allData.json?rapidViewId=" +
        encodeURIComponent(id),
      { credentials: "same-origin" }
    )
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (payload) {
        entry.map = buildIndex(payload);
        entry.state = "ready";
        entry.version = ++versionSeq;
        if (onReady) onReady(entry);
      })
      .catch(function (err) {
        entry.state = "error";
        entry.error = err;
        entry.version = ++versionSeq;
        console.warn("[Jira Mod] board data unavailable:", err);
        if (onReady) onReady(entry);
      });
    return entry;
  }

  // Drop a cached board so the next index() re-fetches. Used when the rendered
  // cards no longer line up with what we indexed (sprint change, new issue).
  function invalidate(id) {
    delete cache[id];
  }

  JiraMod.board = {
    ROOT_SELECTOR: ROOT_SELECTOR,
    CARD_SELECTOR: CARD_SELECTOR,
    UNASSIGNED: UNASSIGNED,
    NO_EPIC: NO_EPIC,
    root: boardRoot,
    controlsAnchor: controlsAnchor,
    cards: cards,
    swimlanes: swimlanes,
    rapidViewId: rapidViewId,
    buildIndex: buildIndex,
    index: index,
    invalidate: invalidate
  };
})(window);
