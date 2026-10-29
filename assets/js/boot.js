"use strict";

// Зарежда се преди приложението, за да не остава празен екран при липсващ скрипт.
(function () {
  const state = { errors: [] };
  function show(problem) {
    const main = document.getElementById("main");
    if (!main) { document.addEventListener("DOMContentLoaded", () => show(problem), { once: true }); return; }
    if (main.children.length && !main.querySelector(".loading") && !main.querySelector(".startup-error")) return;
    const box = document.createElement("section"); box.className = "panel startup-error"; box.setAttribute("role", "alert");
    const title = document.createElement("h1"); title.textContent = "Зареждането прекъсна";
    const text = document.createElement("p"); text.textContent = "Възможно е част от файловете да са останали от стара версия или да не са заредени. Презареди с Ctrl+F5. При обновяване копирай всички кодови файлове от един и същ пакет.";
    const details = document.createElement("p"); details.className = "what";
    details.textContent = `Код: ${problem.code}${problem.file ? " · " + problem.file : ""}${problem.line ? ":" + problem.line : ""}${problem.kind ? " · " + problem.kind : ""}`;
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn btn-primary"; retry.textContent = "Презареди страницата"; retry.addEventListener("click", () => location.reload());
    box.append(title, text, details, retry); main.replaceChildren(box);
  }
  state.fail = (code, file = "", line = 0, kind = "") => {
    const problem = { code, file: String(file).split("?")[0].split("/").pop().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80), line: Number(line) || 0,
      kind: ["ReferenceError", "TypeError", "SyntaxError", "RangeError"].includes(kind) ? kind : "" };
    state.errors.push(problem); show(state.errors[0]);
  };
  window.TP24_BOOT = state;
  window.addEventListener("error", (event) => {
    // Библиотеката за графиката е по избор: без нея сайтът работи с опростена графика.
    if (event.target?.tagName === "SCRIPT") { if (!event.target.hasAttribute("data-optional")) state.fail("script_missing", event.target.src); }
    else if (event.error) state.fail("javascript_error", event.filename, event.lineno, event.error.name);
  }, true);
  window.addEventListener("unhandledrejection", (event) => state.fail("startup_failed", "app.js", 0, event.reason?.name));
})();
