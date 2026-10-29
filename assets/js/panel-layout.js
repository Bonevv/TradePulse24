"use strict";

/* Подредбата е лична настройка на браузъра. Местим самите панели, без копия на формите и графиките.
   Бутоните за местене се показват само след „Подреди панелите“, за да не пречат при четене на сигналите.
   Версия 2: в 5.0 сигналите са първи по подразбиране, затова старата подредба (графиката отгоре) не се взема. */
const PanelLayout = (() => {
  const KEY = "tradepulse24-panels-v2";
  let saved = {}, drag = null, page = "dashboard";
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw?.version === 2 && raw.pages && typeof raw.pages === "object") saved = raw.pages;
  } catch (_) { /* Подредбата по подразбиране остава достъпна. */ }
  const items = (board) => [...board.children].filter((node) => node.matches("[data-panel-key]"));
  const notify = (message) => {
    let live = document.getElementById("panel-announcement");
    if (!live) { live = document.createElement("span"); live.id = "panel-announcement"; live.className = "sr-only"; live.setAttribute("role", "status"); document.body.append(live); }
    live.textContent = message;
  };
  function store(board) {
    saved[board.dataset.layoutStorage] = items(board).map((node) => node.dataset.panelKey);
    const keys = Object.keys(saved);
    if (keys.length > 80) for (const key of keys.slice(0, keys.length - 80)) delete saved[key];
    try { localStorage.setItem(KEY, JSON.stringify({ version: 2, pages: saved })); }
    catch (_) { notify("Панелите са преместени, но браузърът не позволи запазване на подредбата."); }
  }
  function buttons(board) {
    const list = items(board);
    list.forEach((item, index) => {
      for (const button of item.querySelectorAll(":scope > .panel-tools [data-panel-move], :scope > .panel > .panel-tools [data-panel-move]"))
        button.disabled = button.dataset.panelMove === "up" ? index === 0 : index === list.length - 1;
      const grip = item.querySelector(":scope > .panel-tools [data-panel-grip], :scope > .panel > .panel-tools [data-panel-grip]");
      if (grip) grip.draggable = list.length > 1 && editing();
    });
  }
  function tools(item) {
    const host = item.classList.contains("workspace-item") ? item.querySelector(":scope > .panel") || item : item;
    if (host.querySelector(":scope > .panel-tools")) return;
    const title = item.dataset.panelLabel || host.querySelector("h2,h3,h4,.kicker,summary")?.textContent?.trim() || "Панел";
    item.dataset.panelLabel = title;
    const toolbar = document.createElement("div"); toolbar.className = "panel-tools";
    const grip = document.createElement("button"); grip.type = "button"; grip.dataset.panelGrip = "";
    grip.className = "panel-grip"; grip.textContent = "⠿ Мести"; grip.title = "Премести с мишката или със стрелките нагоре и надолу";
    grip.setAttribute("aria-label", "Премести: " + title);
    toolbar.append(grip);
    for (const [move, symbol, label] of [["up", "↑", "Нагоре"], ["down", "↓", "Надолу"]]) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.panelMove = move;
      button.textContent = symbol; button.title = label; button.setAttribute("aria-label", label + ": " + title); toolbar.append(button);
    }
    host.prepend(toolbar);
  }
  function boardSetup(board, name) {
    board.dataset.panelBoard = name;
    board.dataset.layoutStorage = page + ":" + name;
    const list = items(board), order = saved[board.dataset.layoutStorage];
    if (Array.isArray(order)) {
      const ranked = new Map(order.filter((key) => typeof key === "string").map((key, i) => [key, i]));
      const sorted = list.slice().sort((a, b) => (ranked.get(a.dataset.panelKey) ?? 10000 + list.indexOf(a)) - (ranked.get(b.dataset.panelKey) ?? 10000 + list.indexOf(b)));
      // Не местим несвързани заглавия и форми в автоматично откритите групи.
      const slots = list.map((node) => { const mark = document.createComment("panel"); node.before(mark); return mark; });
      sorted.forEach((node, i) => slots[i].replaceWith(node));
    }
    items(board).forEach(tools); buttons(board);
  }
  function mount(root, view = page) {
    page = view;
    if (["signal", "pair"].includes(view) && !root.querySelector(':scope > [data-panel-board="page"]')) {
      const panels = [...root.querySelectorAll(".panel")].filter((panel) => !panel.parentElement.closest(".panel"));
      if (panels.length) {
        const board = document.createElement("div"); board.className = "workspace-grid"; board.dataset.panelBoard = "page";
        // Редът е като в страницата: първо сигналът и решението за вход, графиката след тях.
        panels.forEach((panel, index) => {
          const wrapper = document.createElement("div"), full = panel.id === "mc-panel" || panel.classList.contains("entry-now") || panel.classList.contains("panel-full");
          wrapper.className = "workspace-item workspace-" + (full ? "full" : "half");
          const label = panel.querySelector(".kicker,h2,h3")?.textContent?.trim() || "Панел " + (index + 1);
          wrapper.dataset.panelKey = panel.id === "mc-panel" ? "chart" : label.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-");
          wrapper.dataset.panelLabel = label; wrapper.append(panel); board.append(wrapper);
        });
        root.querySelectorAll(".detail-grid,.grid-2").forEach((grid) => { if (!grid.querySelector(".panel") && !grid.textContent.trim()) grid.remove(); });
        root.append(board);
      }
    }
    const explicit = [...root.querySelectorAll("[data-panel-board]")];
    explicit.forEach((board) => boardSetup(board, board.dataset.panelBoard));
    const parents = new Map();
    for (const panel of root.querySelectorAll(".panel, .mc-side > .mc-box")) {
      if (panel.closest("[data-panel-key]") || panel.parentElement.closest(".panel") && !panel.matches(".mc-side > .mc-box")) continue;
      const parent = panel.parentElement;
      if (parent.hasAttribute("data-panel-board")) continue;
      if (!parents.has(parent)) parents.set(parent, []);
      parents.get(parent).push(panel);
    }
    let index = 0;
    for (const [parent, list] of parents) {
      if (list.length < 2) continue;
      const name = "section-" + index++;
      list.forEach((panel, i) => { panel.dataset.panelKey = "panel-" + i; });
      boardSetup(parent, name);
    }
    if ((root.dataset?.panelBoard || root.querySelector("[data-panel-board]")) && !root.querySelector(".layout-toolbar")) {
      const toolbar = document.createElement("div"); toolbar.className = "layout-toolbar";
      const hint = document.createElement("span"); hint.className = "layout-hint"; hint.textContent = "Мести панелите от „Мести“ или със стрелките. Редът се пази в този браузър.";
      const reset = document.createElement("button"); reset.type = "button"; reset.className = "tiny-btn layout-reset"; reset.dataset.panelReset = ""; reset.textContent = "Върни подредбата";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "tiny-btn"; edit.dataset.panelEdit = "";
      toolbar.append(hint, reset, edit);
      const heading = root.querySelector(":scope > .page-heading, :scope > .detail-head");
      if (heading) heading.after(toolbar); else root.prepend(toolbar);
    }
    sync();
  }
  // Режимът за подреждане е общ за всички страници, докато е отворен сайтът.
  const editing = () => document.body.classList.contains("panels-editing");
  function sync() {
    const on = editing();
    for (const button of document.querySelectorAll("[data-panel-edit]")) { button.textContent = on ? "Готово" : "⠿ Подреди панелите"; button.setAttribute("aria-pressed", String(on)); }
    for (const grip of document.querySelectorAll("[data-panel-grip]")) grip.draggable = on && grip.closest("[data-panel-board]") && items(grip.closest("[data-panel-board]")).length > 1;
  }
  function moved(item, board) {
    store(board); buttons(board);
    notify(item.dataset.panelLabel + ": позиция " + (items(board).indexOf(item) + 1));
    document.dispatchEvent(new Event("panels:moved"));
  }
  function move(item, direction) {
    const board = item.parentElement, list = items(board), index = list.indexOf(item), target = list[index + direction];
    if (!target) return;
    if (direction < 0) target.before(item); else target.after(item);
    moved(item, board);
  }
  const panelOf = (target) => target.closest("[data-panel-key]");
  function finish() {
    drag?.item.classList.remove("panel-dragging");
    document.querySelectorAll(".panel-drop-before,.panel-drop-after").forEach((node) => node.classList.remove("panel-drop-before", "panel-drop-after"));
    drag = null;
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-panel-edit]")) {
      document.body.classList.toggle("panels-editing");
      sync(); notify(editing() ? "Подреждане на панелите: местенето е включено." : "Подредбата е запазена."); return;
    }
    const reset = event.target.closest("[data-panel-reset]");
    if (reset) {
      for (const key of Object.keys(saved)) if (key.startsWith(page + ":")) delete saved[key];
      try { localStorage.setItem(KEY, JSON.stringify({ version: 2, pages: saved })); } catch (_) { /* Само текущата сесия. */ }
      render(); notify("Началната подредба е върната."); return;
    }
    const button = event.target.closest("[data-panel-move]");
    if (button) { const item = panelOf(button); if (item) { move(item, button.dataset.panelMove === "up" ? -1 : 1); item.querySelector("[data-panel-grip]")?.focus({ preventScroll: true }); } }
  });
  document.addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-panel-grip]") || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); const item = panelOf(event.target); if (item) move(item, event.key === "ArrowUp" ? -1 : 1);
  });
  document.addEventListener("dragstart", (event) => {
    const grip = event.target.closest("[data-panel-grip]");
    if (!grip) return;
    const item = panelOf(grip); if (!item) return;
    drag = { item, board: item.parentElement }; item.classList.add("panel-dragging");
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.dataset.panelKey);
  });
  function dropTarget(target) {
    let item = panelOf(target);
    while (item && item.parentElement !== drag?.board) item = item.parentElement.closest("[data-panel-key]");
    return item && item !== drag.item ? item : null;
  }
  document.addEventListener("dragover", (event) => {
    if (!drag) return;
    const target = dropTarget(event.target); if (!target) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    const after = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    document.querySelectorAll(".panel-drop-before,.panel-drop-after").forEach((node) => node.classList.remove("panel-drop-before", "panel-drop-after"));
    target.classList.add(after ? "panel-drop-after" : "panel-drop-before");
  });
  document.addEventListener("drop", (event) => {
    if (!drag) return;
    const target = dropTarget(event.target); if (!target) { finish(); return; }
    event.preventDefault(); const { item, board } = drag;
    if (target.classList.contains("panel-drop-after")) target.after(item); else target.before(item);
    moved(item, board); finish(); item.querySelector("[data-panel-grip]")?.focus({ preventScroll: true });
  });
  document.addEventListener("dragend", finish);
  return { mount, key: KEY };
})();

function movablePanel(key, label, html, span = "full") {
  return `<div class="workspace-item workspace-${esc(span)}" data-panel-key="${esc(key)}" data-panel-label="${esc(label)}">${html}</div>`;
}
