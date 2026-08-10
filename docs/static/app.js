/**
 * Subrails docs site behavior, vanilla JS, no dependencies:
 * - light/dark theme toggle, persisted in localStorage
 * - copy buttons on code blocks
 */
(function () {
  "use strict";

  var STORAGE_KEY = "subrails.docs.theme";
  var root = document.documentElement;

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
  }

  var stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  applyTheme(stored === "dark" || stored === "light" ? stored : "light");

  var toggle = document.querySelector(".theme-toggle");
  if (toggle !== null) {
    var updateLabel = function () {
      toggle.textContent = root.getAttribute("data-theme") === "light" ? "DARK" : "LIGHT";
    };
    updateLabel();
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (error) {
        // Non-fatal: the site still works without persistence.
      }
      updateLabel();
    });
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    var button = target.closest(".codeblock-copy");
    if (button === null) {
      return;
    }
    var block = button.closest(".codeblock");
    var code = block === null ? null : block.querySelector("code");
    if (code === null) {
      return;
    }
    var text = code.textContent ?? "";
    var done = function () {
      var original = button.textContent;
      button.textContent = "copied";
      window.setTimeout(function () {
        button.textContent = original;
      }, 1600);
    };
    if (typeof navigator.clipboard !== "undefined" && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  });
})();
