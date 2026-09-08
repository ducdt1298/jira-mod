/*
 * Jira Mod — entry point
 *
 * Loaded last, after the core and every profile has registered itself. Picks
 * the profile that owns this hostname and hands it to the engine. An unknown
 * host is left completely alone.
 */
(function (root) {
  "use strict";

  var JiraMod = root.JiraMod;
  var profile = JiraMod.profiles.forHost(location.hostname);
  if (!profile) return;

  JiraMod.engine.boot(profile);
})(window);
