/*
 * Jira Mod — feature registry
 *
 * Every enhancement is a small object that answers the same three questions:
 *
 *   config(ctx) -> cfg|null   does this context want the feature? (its config,
 *                             or null to sit this one out)
 *   apply(ctx, cfg)           make it so — must be IDEMPOTENT, it re-runs on
 *                             every DOM mutation
 *   revert(root)              undo it, leaving no trace
 *
 * plus a `surface` saying WHERE it lives:
 *
 *   "dialog"  one transition / edit / create form  (ctx.form)
 *   "board"   one agile board                      (ctx.root)
 *
 * The engine walks the features of each surface and lets every one gate itself
 * on the active profile. That is why no site name appears anywhere in the
 * logic: a feature is skipped simply because the profile did not configure it.
 * Features themselves live in src/features/.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod || (root.JiraMod = {});

  var registry = [];

  function register(feature) {
    registry.push(feature);
  }

  function bySurface(surface) {
    return registry.filter(function (f) {
      return f.surface === surface;
    });
  }

  JiraMod.features = {
    register: register,
    bySurface: bySurface,
    all: function () {
      return registry.slice();
    }
  };
})(window);
