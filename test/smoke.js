/* Offline smoke test: loads the content-script files into a stubbed global and
 * exercises the pure logic — profile resolution, recipe matching, feature
 * gating, AI prompt building/validation, and the board index + filter rules.
 * No browser involved: run with `node test/smoke.js`. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const FILES = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"))
  .content_scripts[0].js;

const sandbox = {
  console,
  MutationObserver: class { observe() {} disconnect() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
  chrome: {
    storage: { sync: { get() {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} }
  },
  location: { hostname: "insight.fsoft.com.vn", search: "?rapidView=644" },
  URLSearchParams,
  fetch: () => new Promise(() => {}), // never resolves: index stays "loading"
  setTimeout,
  clearTimeout
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
}

const JiraMod = sandbox.JiraMod;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

// --- tiny DOM stubs -------------------------------------------------------
function fakeForm(labels) {
  const groups = labels.map(text => ({
    querySelector: sel => (sel === "label"
      ? { cloneNode: () => ({ querySelectorAll: () => [], textContent: text }) }
      : null)
  }));
  return { querySelectorAll: sel => (sel === ".field-group" ? groups : []) };
}
function fakeCard(key, summary, classes = []) {
  return {
    dataset: { issueKey: key },
    classList: { contains: c => classes.includes(c) },
    querySelector: sel => (sel === ".ghx-summary"
      ? { getAttribute: () => summary, textContent: summary }
      : null)
  };
}

console.log("\n[profile resolution]");
const fsoft = JiraMod.profiles.forHost("insight.fsoft.com.vn");
const fci = JiraMod.profiles.forHost("jira.fci.vn");
check("fsoft host resolves", fsoft && fsoft.id === "fsoft");
check("fci host resolves", fci && fci.id === "fci");
check("unknown host -> null", JiraMod.profiles.forHost("jira.example.com") === null);
check("case-insensitive host", JiraMod.profiles.forHost("JIRA.FCI.VN") !== null);

console.log("\n[profile shape]");
check("fsoft: transition dialog only",
  fsoft.dialogs.map(d => d.id).join() === "transition", fsoft.dialogs.map(d => d.id));
check("fci: transition+edit+create",
  fci.dialogs.map(d => d.id).join() === "transition,edit,create", fci.dialogs.map(d => d.id));
check("fsoft keeps legacy hide behaviour", fsoft.hideOptional.skipIfNoRequired === false);
check("fci guards empty dialogs", fci.hideOptional.skipIfNoRequired === true);
check("fsoft has bug-resolve recipe", fsoft.recipes.length === 1 && fsoft.recipes[0].id === "bug-resolve");
check("fci has no recipe", fci.recipes.length === 0);
check("fci enables the board filter", !!fci.board && fci.board.facets.length === 5);
check("fsoft leaves the board filter off", fsoft.board === null);
check("every dialog spec has a submit selector",
  JiraMod.profiles.all().every(p => p.dialogs.every(d => !!d.submitSelector)));

console.log("\n[recipe matching]");
const bugForm = fakeForm(["Summary", "Resolution", "Defect Origin", "Defect Type"]);
const plainForm = fakeForm(["Summary", "Comment"]);
check("bug form matches recipe",
  JiraMod.profiles.recipeFor(fsoft, bugForm, "transition") !== null);
check("plain transition form does NOT match",
  JiraMod.profiles.recipeFor(fsoft, plainForm, "transition") === null);
check("fci never matches a recipe",
  JiraMod.profiles.recipeFor(fci, bugForm, "edit") === null);

console.log("\n[feature registry]");
const dialogFeatures = JiraMod.features.bySurface("dialog");
const boardFeatures = JiraMod.features.bySurface("board");
check("dialog pipeline order",
  dialogFeatures.map(f => f.id).join() === "hideOptional,autoFill,groupBlock,pairLayout,defaultButtons,aiBar",
  dialogFeatures.map(f => f.id));
check("board surface has the filter",
  boardFeatures.map(f => f.id).join() === "boardFilter", boardFeatures.map(f => f.id));
check("every feature declares a surface",
  JiraMod.features.all().every(f => f.surface === "dialog" || f.surface === "board"));
check("unknown surface -> nothing", JiraMod.features.bySurface("nope").length === 0);

console.log("\n[feature gating]");
const fciDialogCtx = { form: bugForm, profile: fci, recipe: null, dialog: fci.dialogs[0] };
const fsoftDialogCtx = { form: bugForm, profile: fsoft, recipe: fsoft.recipes[0], dialog: fsoft.dialogs[0] };
check("fci dialog: only hideOptional is configured",
  dialogFeatures.filter(f => f.config(fciDialogCtx)).map(f => f.id).join() === "hideOptional",
  dialogFeatures.filter(f => f.config(fciDialogCtx)).map(f => f.id));
check("fsoft bug resolve: all six configured",
  dialogFeatures.filter(f => f.config(fsoftDialogCtx)).length === 6);
check("board filter on for fci", !!boardFeatures[0].config({ profile: fci }));
check("board filter off for fsoft", boardFeatures[0].config({ profile: fsoft }) === null);

console.log("\n[board index]");
// Shapes taken from a real allData.json response.
const payload = {
  entityData: {
    types: { "10001": { typeName: "Story" }, "10101": { typeName: "Sub-task" } },
    priorities: { "1": { priorityName: "Highest" }, "2": { priorityName: "Low" } },
    statuses: { "1": { statusName: "To Do" }, "3": { statusName: "In Progress" } },
    epics: { "247244": { epicField: { epicKey: "SDC-599", text: "E1 — Alert Pipeline" } } }
  },
  issuesData: {
    issues: [
      { key: "SDC-609", summary: "Xem sơ đồ quan hệ CI", typeId: "10001", priorityId: "2",
        statusId: "1", assigneeName: "Lý Hoàng Long 93", epicId: "247244", done: false },
      { key: "SDC-652", summary: "Rundeck plugin", typeId: "10101", priorityId: "1",
        statusId: "3", done: true }
    ]
  }
};
const index = JiraMod.board.buildIndex(payload);
check("maps type via entityData", index["SDC-609"].type === "Story");
check("maps priority via entityData", index["SDC-609"].priority === "Low");
check("maps status via entityData", index["SDC-609"].status === "To Do");
check("maps epic text", index["SDC-609"].epic === "E1 — Alert Pipeline");
check("keeps assignee name", index["SDC-609"].assignee === "Lý Hoàng Long 93");
check("labels missing assignee", index["SDC-652"].assignee === JiraMod.board.UNASSIGNED);
check("labels missing epic", index["SDC-652"].epic === JiraMod.board.NO_EPIC);
check("carries the done flag", index["SDC-652"].done === true && index["SDC-609"].done === false);
check("rapidViewId comes from the URL", JiraMod.board.rapidViewId() === "644");

console.log("\n[board filter rules]");
const { matches } = JiraMod.boardFilter;
const FACETS = ["assignee", "type", "priority", "status", "epic"];
const card609 = fakeCard("SDC-609", "Xem sơ đồ quan hệ CI");
const card652 = fakeCard("SDC-652", "Rundeck plugin", ["ghx-done"]);
const blank = () => ({ text: "", selected: {}, hideDone: false });

check("no filter -> everything passes",
  matches(card609, index["SDC-609"], blank(), FACETS));

let s = blank(); s.text = "rundeck";
check("text matches summary", matches(card652, index["SDC-652"], s, FACETS));
check("text excludes others", !matches(card609, index["SDC-609"], s, FACETS));
s = blank(); s.text = "sdc-609";
check("text matches the issue key", matches(card609, index["SDC-609"], s, FACETS));

s = blank(); s.selected = { assignee: { "Lý Hoàng Long 93": true } };
check("facet keeps a selected value", matches(card609, index["SDC-609"], s, FACETS));
check("facet drops the rest", !matches(card652, index["SDC-652"], s, FACETS));

s = blank(); s.selected = { type: { Story: true }, priority: { Highest: true } };
check("facets combine with AND", !matches(card609, index["SDC-609"], s, FACETS));
s = blank(); s.selected = { type: { Story: true, "Sub-task": true } };
check("values inside one facet combine with OR",
  matches(card609, index["SDC-609"], s, FACETS) && matches(card652, index["SDC-652"], s, FACETS));

s = blank(); s.hideDone = true;
check("hideDone drops done issues", !matches(card652, index["SDC-652"], s, FACETS));
check("hideDone keeps the others", matches(card609, index["SDC-609"], s, FACETS));
check("hideDone falls back to the card class when unindexed",
  !matches(card652, undefined, s, FACETS));

s = blank(); s.selected = { assignee: { "Ai Đó": true } };
check("unindexed card is never hidden by a facet (fail open)",
  matches(fakeCard("SDC-999", "Mới thêm"), undefined, s, FACETS));
s = blank(); s.text = "khong-ton-tai";
check("but text search still applies to unindexed cards",
  !matches(fakeCard("SDC-999", "Mới thêm"), undefined, s, FACETS));

console.log("\n[ai prompt]");
const spec = fsoft.recipes[0].ai;
const data = {
  summary: "Nút Save không hoạt động",
  description: "Bấm Save không lưu được dữ liệu.",
  fields: spec.fields.map(f => ({
    key: f.key, type: f.type,
    selected: f.key === "resolution" ? "Fixed" : "",
    options: f.type === "select" ? ["Fixed", "Won't Fix"] : []
  }))
};
const msgs = JiraMod.ai.buildMessages(spec, data);
const sys = msgs[0].content, usr = msgs[1].content;
check("system names all 6 keys", spec.fields.every(f => sys.includes('"' + f.key + '"')));
check("system carries the text-field examples",
  sys.includes("Design thiếu mô tả") && sys.includes("Check và fix"));
check("user lists valid options", usr.includes("- resolution: Fixed | Won't Fix"));
check("user reports current selection", usr.includes("resolution=Fixed"));
check("user marks unselected fields", usr.includes("defectOrigin=(chưa chọn)"));
check("repair pass appends 2 messages",
  JiraMod.ai.buildMessages(spec, data, { prevRaw: "{}", error: "x" }).length === 4);

console.log("\n[ai validation]");
const good = {
  resolution: "Fixed", defectOrigin: "Coding", defectType: "Cod_Coding Standard",
  causeCategory: "CAR_Carelessness", directCause: "Thiếu validate input",
  correctionAction: "Bổ sung validate"
};
check("accepts a complete answer",
  JiraMod.ai.validate(spec, good).directCause === "Thiếu validate input");
check("selects may be blank (best-effort)",
  Object.keys(JiraMod.ai.validate(spec, { directCause: "a", correctionAction: "b" })).join() === "directCause,correctionAction");
check("rejects a missing text field",
  throws(() => JiraMod.ai.validate(spec, { directCause: "a" })));
check("rejects over-long text",
  throws(() => JiraMod.ai.validate(spec, { directCause: "x".repeat(201), correctionAction: "b" })));
check("drops keys the spec does not declare",
  JiraMod.ai.validate(spec, Object.assign({ evil: "x" }, good)).evil === undefined);
check("extractJson strips code fences",
  JiraMod.ai.extractJson('```json\n{"a":1}\n```').a === 1);

console.log("\n[error messages]");
check("auth error is actionable", /đăng nhập/.test(JiraMod.ai.toUserMessage({ code: "auth" })));
check("unknown code falls back", /adapter/.test(JiraMod.ai.toUserMessage({})));

console.log(failed ? "\n" + failed + " CHECK(S) FAILED\n" : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
