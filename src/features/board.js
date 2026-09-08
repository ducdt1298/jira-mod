/*
 * Jira Mod — board filter
 *
 * Jira's board only offers whatever Quick Filters the board ADMIN configured
 * (on the SDC board: two). This adds a client-side filter bar next to them:
 * free-text search plus a multi-select facet per attribute, driven by the
 * board's own data (src/core/board.js).
 *
 * It FILTERS WHAT THE BOARD ALREADY SHOWS — it composes with Jira's quick
 * filters instead of replacing them, and it never touches board configuration,
 * which is shared with the whole team. Cards are hidden with a CSS class; no
 * issue, board or sprint is modified in any way.
 *
 * Which facets appear comes from the profile (`board.facets`), so the same code
 * serves any Jira instance.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod;
  var board = JiraMod.board;

  // Facet id -> label + the attribute it reads from the board index. Adding a
  // facet is one entry here plus its id in a profile's `board.facets`.
  var FACETS = {
    assignee: { label: "Người nhận", attr: "assignee" },
    type: { label: "Loại", attr: "type" },
    priority: { label: "Ưu tiên", attr: "priority" },
    status: { label: "Trạng thái", attr: "status" },
    epic: { label: "Epic", attr: "epic" }
  };

  var CLS = {
    bar: "jira-mod-bf",
    search: "jira-mod-bf-search",
    facet: "jira-mod-bf-facet",
    facetBtn: "jira-mod-bf-btn",
    panel: "jira-mod-bf-panel",
    panelActions: "jira-mod-bf-panel-actions",
    open: "is-open",
    active: "is-active",
    // Collapses the dead space Jira leaves under its own Quick Filters row.
    tight: "jira-mod-tight",
    done: "jira-mod-bf-done",
    clear: "jira-mod-bf-clear",
    count: "jira-mod-bf-count",
    cardHidden: "jira-mod-card-hidden",
    laneHidden: "jira-mod-lane-hidden"
  };

  var SEARCH_DEBOUNCE_MS = 150;

  // Filter state per board id, so switching boards does not carry filters over.
  var states = {};

  function stateFor(id) {
    if (!states[id]) {
      states[id] = { text: "", selected: {}, hideDone: false };
    }
    return states[id];
  }

  function selectedSet(state, facetId) {
    if (!state.selected[facetId]) state.selected[facetId] = {};
    return state.selected[facetId];
  }

  function countSelected(set) {
    return Object.keys(set).length;
  }

  function isFiltering(state, facetIds) {
    if (state.text || state.hideDone) return true;
    return facetIds.some(function (f) {
      return countSelected(selectedSet(state, f)) > 0;
    });
  }

  // The searchable text of a card. Read from the DOM, not the index, so search
  // keeps working even when the board data could not be fetched.
  function cardText(card) {
    var summary = card.querySelector(".ghx-summary");
    return (
      (card.dataset.issueKey || "") +
      " " +
      ((summary && (summary.getAttribute("title") || summary.textContent)) || "")
    ).toLowerCase();
  }

  /*
   * Does this card survive the current filter?
   * Unknown cards (not in the index — e.g. added since the last fetch) are
   * never hidden by a facet: failing open is the safe direction, a filter that
   * silently swallows a new issue is worse than one that shows one extra.
   */
  function matches(card, attrs, state, facetIds) {
    if (state.text && cardText(card).indexOf(state.text) === -1) return false;

    if (state.hideDone) {
      var done = attrs ? attrs.done : card.classList.contains("ghx-done");
      if (done) return false;
    }

    if (!attrs) return true;

    return facetIds.every(function (facetId) {
      var set = selectedSet(state, facetId);
      if (!countSelected(set)) return true;
      return !!set[attrs[FACETS[facetId].attr]];
    });
  }

  /* ------------------------------------------------------------------ UI --- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildBar(cfg, state, rerender) {
    var bar = el("div", CLS.bar);

    var search = el("input", CLS.search);
    search.type = "text";
    search.placeholder = "Tìm key hoặc tiêu đề…";
    search.value = state.text;
    var timer = null;
    search.addEventListener("input", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        state.text = search.value.trim().toLowerCase();
        rerender();
      }, SEARCH_DEBOUNCE_MS);
    });
    bar.appendChild(search);

    cfg.facets.forEach(function (facetId) {
      if (!FACETS[facetId]) return; // unknown facet in a profile: ignore
      bar.appendChild(buildFacet(facetId, state, rerender));
    });

    if (cfg.hideDoneToggle) {
      var doneLabel = el("label", CLS.done);
      var doneBox = document.createElement("input");
      doneBox.type = "checkbox";
      doneBox.checked = state.hideDone;
      doneBox.addEventListener("change", function () {
        state.hideDone = doneBox.checked;
        rerender();
      });
      doneLabel.appendChild(doneBox);
      doneLabel.appendChild(document.createTextNode("Ẩn Done"));
      bar.appendChild(doneLabel);
    }

    var clear = el("button", CLS.clear, "Xoá lọc");
    clear.type = "button";
    clear.addEventListener("click", function () {
      state.text = "";
      state.hideDone = false;
      state.selected = {};
      search.value = "";
      bar.querySelectorAll("input[type='checkbox']").forEach(function (box) {
        box.checked = false;
      });
      rerender();
    });
    bar.appendChild(clear);

    bar.appendChild(el("span", CLS.count, ""));
    return bar;
  }

  function buildFacet(facetId, state, rerender) {
    var wrap = el("div", CLS.facet);
    wrap.dataset.facet = facetId;

    var btn = el("button", CLS.facetBtn);
    btn.type = "button";
    btn.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = wrap.classList.contains(CLS.open);
      closeAllPanels();
      wrap.classList.toggle(CLS.open, !open);
    });

    var panel = el("div", CLS.panel);
    panel.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    var actions = el("div", CLS.panelActions);
    var none = el("button", null, "Bỏ chọn tất cả");
    none.type = "button";
    none.addEventListener("click", function () {
      state.selected[facetId] = {};
      panel.querySelectorAll("input[type='checkbox']").forEach(function (box) {
        box.checked = false;
      });
      rerender();
    });
    actions.appendChild(none);
    panel.appendChild(actions);

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    return wrap;
  }

  function closeAllPanels() {
    document.querySelectorAll("." + CLS.facet).forEach(function (f) {
      f.classList.remove(CLS.open);
    });
  }

  // One document-level listener for "click outside closes the panel".
  var outsideBound = false;
  function bindOutsideClick() {
    if (outsideBound) return;
    outsideBound = true;
    document.addEventListener("click", closeAllPanels);
  }

  /*
   * Rebuild the checkbox lists from the values actually present on the board,
   * with a count each. Guarded by a signature (index version + the set of card
   * keys) so it only runs when the board really changed — otherwise every
   * mutation would rebuild the DOM and close whatever panel is open.
   */
  function refreshOptions(bar, cfg, state, entry, cards, rerender) {
    var signature =
      entry.version +
      "|" +
      cards
        .map(function (c) {
          return c.dataset.issueKey;
        })
        .join(",");
    if (bar.dataset.jiraModSig === signature) return;
    bar.dataset.jiraModSig = signature;

    cfg.facets.forEach(function (facetId) {
      var wrap = bar.querySelector("." + CLS.facet + "[data-facet='" + facetId + "']");
      if (!wrap) return;
      var attr = FACETS[facetId].attr;

      var counts = {};
      cards.forEach(function (card) {
        var attrs = entry.map[card.dataset.issueKey];
        if (!attrs) return;
        var value = attrs[attr];
        if (!value) return;
        counts[value] = (counts[value] || 0) + 1;
      });

      var values = Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a] || a.localeCompare(b, "vi");
      });

      var panel = wrap.querySelector("." + CLS.panel);
      // Keep the actions row, replace the option list below it.
      panel.querySelectorAll("label").forEach(function (l) {
        l.remove();
      });

      var set = selectedSet(state, facetId);
      values.forEach(function (value) {
        var label = el("label");
        var box = document.createElement("input");
        box.type = "checkbox";
        box.value = value;
        box.checked = !!set[value];
        box.addEventListener("change", function () {
          if (box.checked) set[value] = true;
          else delete set[value];
          rerender();
        });
        label.appendChild(box);
        label.appendChild(el("span", null, value));
        label.appendChild(el("em", null, String(counts[value])));
        panel.appendChild(label);
      });

      wrap.classList.toggle("is-empty", values.length === 0);
    });
  }

  // Button captions carry the current selection count, so the bar reads at a
  // glance even with every panel closed.
  function refreshLabels(bar, cfg, state) {
    cfg.facets.forEach(function (facetId) {
      var wrap = bar.querySelector("." + CLS.facet + "[data-facet='" + facetId + "']");
      if (!wrap) return;
      var n = countSelected(selectedSet(state, facetId));
      var btn = wrap.querySelector("." + CLS.facetBtn);
      btn.textContent = FACETS[facetId].label + (n ? " (" + n + ")" : "");
      wrap.classList.toggle(CLS.active, n > 0);
    });
  }

  function applyFilter(root, bar, cfg, state, entry) {
    var cards = board.cards(root);
    var visible = 0;

    cards.forEach(function (card) {
      var ok = matches(card, entry.map[card.dataset.issueKey], state, cfg.facets);
      card.classList.toggle(CLS.cardHidden, !ok);
      if (ok) visible++;
    });

    // A swimlane whose every card is filtered out collapses too, otherwise the
    // board is mostly empty headers.
    board.swimlanes(root).forEach(function (lane) {
      var any = lane.querySelector(
        board.CARD_SELECTOR + ":not(." + CLS.cardHidden + ")"
      );
      lane.classList.toggle(CLS.laneHidden, !any);
    });

    var count = bar.querySelector("." + CLS.count);
    if (entry.state === "loading") count.textContent = "Đang tải dữ liệu board…";
    else if (entry.state === "error") count.textContent = "Chỉ tìm được theo key/tiêu đề";
    else count.textContent = "Hiện " + visible + "/" + cards.length;

    bar.classList.toggle(CLS.active, isFiltering(state, cfg.facets));
  }

  /* ------------------------------------------------------------- feature --- */

  var boardFilter = {
    id: "boardFilter",
    surface: "board",

    config: function (ctx) {
      return ctx.profile.board;
    },

    apply: function (ctx, cfg) {
      var id = board.rapidViewId();
      if (!id) return; // not a rapid board URL

      var state = stateFor(id);
      var anchor = board.controlsAnchor();
      if (!anchor || !anchor.parentNode) return; // controls not rendered yet

      // The board data arrives asynchronously; when it does, ask the engine for
      // another pass rather than duplicating the render path here.
      var entry = board.index(id, function () {
        JiraMod.engine.scan();
      });

      // Look the root up fresh on every render: Jira replaces the whole board
      // subtree when it re-draws, so a root captured in a click handler would
      // soon point at a detached tree.
      var rerender = function () {
        applyFilter(board.root() || ctx.root, bar, cfg, state, entry);
        refreshLabels(bar, cfg, state);
      };

      var bar = document.querySelector("." + CLS.bar);
      if (!bar || !bar.isConnected) {
        bar = buildBar(cfg, state, function () {
          rerender();
        });
        anchor.parentNode.insertBefore(bar, anchor.nextSibling);
        anchor.classList.add(CLS.tight);
        bindOutsideClick();
      }

      refreshOptions(bar, cfg, state, entry, board.cards(ctx.root), rerender);
      rerender();
    },

    revert: function (root) {
      var bar = document.querySelector("." + CLS.bar);
      if (bar) bar.remove();
      var anchor = board.controlsAnchor();
      if (anchor) anchor.classList.remove(CLS.tight);
      board.cards(root).forEach(function (card) {
        card.classList.remove(CLS.cardHidden);
      });
      board.swimlanes(root).forEach(function (lane) {
        lane.classList.remove(CLS.laneHidden);
      });
    }
  };

  JiraMod.features.register(boardFilter);
  JiraMod.boardFilter = { FACETS: FACETS, matches: matches, stateFor: stateFor };
})(window);
