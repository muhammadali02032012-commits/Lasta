(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEY_TOKEN = "lasta_token";
  const draftKey = (u) => "lasta_draft_" + u;

  const read = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
    catch { return fallback; }
  };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---------- Brauzer xotirasi (server kerak emas) ----------
  // Akkaunt va rastalar faqat shu brauzerda, shu qurilmada saqlanadi.
  async function sha256(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(text)));
  }
  const fail = (status, message) => { throw { status, message }; };

  async function api(method, url, body) {
    const users = read("lasta_users", {});

    if (url === "/api/register" || url === "/api/login") {
      const name = String(body.username || "").trim().toLowerCase();
      const h = await sha256(String(body.password || ""));
      if (url === "/api/register") {
        if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(name)) fail(400, "Nom 3\u201324 belgidan iborat bo'lsin: harf, raqam, nuqta, pastki chiziq yoki tire.");
        if (String(body.password || "").length < 6) fail(400, "Parol kamida 6 belgidan iborat bo'lsin.");
        if (users[name]) fail(409, "Bu nom band. Boshqa nom tanlang.");
        users[name] = h;
        write("lasta_users", users);
      } else {
        if (!users[name]) fail(401, "Bunday akkaunt topilmadi. Avval ro'yxatdan o'ting.");
        if (users[name] !== h) fail(401, "Parol noto'g'ri. Qayta urinib ko'ring.");
      }
      return { token: name, username: name };
    }

    const me = localStorage.getItem(KEY_TOKEN);
    if (!me || !users[me]) fail(401, "Qaytadan kiring.");
    if (method === "GET" && url === "/api/stalls") return { username: me, stalls: read("lasta_data_" + me, []) };
    if (method === "PUT" && url === "/api/stalls") { write("lasta_data_" + me, body.stalls); return { ok: true }; }
    return { ok: true };
  }

  let toastTimer;
  function toast(text) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // Rastalar serverga ketma-ket, avtomatik saqlanadi
  let saveChain = Promise.resolve();
  function saveStalls() {
    const snapshot = stalls.slice();
    saveChain = saveChain
      .then(() => api("PUT", "/api/stalls", { stalls: snapshot }))
      .catch((err) => {
        if (err.status === 401) return logout();
        toast("Saqlab bo'lmadi. Internet va server holatini tekshiring.");
      });
  }

  // ---------- Kun / tun rejimi ----------
  const KEY_THEME = "lasta_theme";
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll(".theme-toggle").forEach((b) => {
      b.textContent = theme === "dark" ? "\u2600" : "\u263E"; // ☀ / ☾
      b.setAttribute("aria-label", theme === "dark" ? "Kun rejimiga o'tish" : "Tun rejimiga o'tish");
    });
  }
  let theme = localStorage.getItem(KEY_THEME) ||
    (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
  document.querySelectorAll(".theme-toggle").forEach((b) => {
    b.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      localStorage.setItem(KEY_THEME, theme); // tanlov avtomatik saqlanadi
      applyTheme(theme);
    });
  });

  let currentUser = null;
  let selectedId = null;
  let stalls = [];
  let mode = "login";

  // ---------- Boshlang'ich oyna ----------
  function start() {
    setTimeout(() => {
      $("splash").classList.add("leaving");
      showScreen();
      setTimeout(() => $("splash").remove(), 1000);
    }, 1600);
  }

  async function showScreen() {
    if (!localStorage.getItem(KEY_TOKEN)) return showAuth();
    try {
      const data = await api("GET", "/api/stalls");
      openApp(data.username, data.stalls);
    } catch (err) {
      if (err.status === 401) localStorage.removeItem(KEY_TOKEN);
      showAuth(err.offline ? "Server bilan aloqa yo'q. Sayt server orqali ochilganini tekshiring." : "");
    }
  }
  function showAuth(msg) {
    $("auth").hidden = false;
    $("app").hidden = true;
    $("authError").textContent = msg || "";
  }

  // ---------- Kirish / ro'yxatdan o'tish ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.mode;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      $("authSubmit").textContent = mode === "login" ? "Kirish" : "Ro'yxatdan o'tish";
      $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
      $("authError").textContent = "";
    });
  });

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("username").value.trim().toLowerCase();
    const pass = $("password").value;
    $("authSubmit").disabled = true;
    $("authError").textContent = "";
    try {
      const auth = await api("POST", mode === "login" ? "/api/login" : "/api/register", { username: name, password: pass });
      localStorage.setItem(KEY_TOKEN, auth.token);
      const data = await api("GET", "/api/stalls");
      let list = data.stalls;

      $("authForm").reset();
      openApp(auth.username, list);
    } catch (err) {
      $("authError").textContent = err.offline
        ? "Server bilan aloqa yo'q. Sayt server orqali ochilganini tekshiring."
        : (err.message || "Xatolik yuz berdi.");
    } finally {
      $("authSubmit").disabled = false;
    }
  });

  // ---------- Asosiy sahifa ----------
  function openApp(user, list) {
    currentUser = user;
    stalls = list;
    selectedId = null;
    closeDrawer();
    $("accountName").textContent = user;
    $("avatar").textContent = user.charAt(0);
    $("auth").hidden = true;
    $("app").hidden = false;
    render();
  }

  const fmtDate = (ts) => {
    const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
  };

  function select(id) {
    selectedId = id;
    closeDrawer();
    render();
    window.scrollTo({ top: 0 });
  }

  function render() {
    if (selectedId !== null && !stalls.some((s) => s.id === selectedId)) selectedId = null;
    $("app").classList.toggle("has-selection", selectedId !== null);
    $("empty").hidden = stalls.length > 0;
    $("listWrap").hidden = stalls.length === 0;

    const list = $("stallList");
    list.innerHTML = "";
    stalls.forEach((s) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stall-item" + (s.id === selectedId ? " active" : "");
      if (s.id === selectedId) btn.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.className = "stall-name";
      name.textContent = s.name;
      btn.appendChild(name);
      if (s.info) {
        const snip = document.createElement("span");
        snip.className = "stall-snippet";
        snip.textContent = s.info;
        btn.appendChild(snip);
      }
      btn.addEventListener("click", () => select(s.id));
      li.appendChild(btn);
      list.appendChild(li);
    });

    const cur = stalls.find((s) => s.id === selectedId);
    $("detail").hidden = !cur;
    if (cur) {
      $("detailName").textContent = cur.name;
      $("detailDate").textContent = "Qo'shilgan sana: " + fmtDate(cur.id);
      $("detailInfo").textContent = cur.info || "Ma'lumot kiritilmagan.";
      $("detailInfo").classList.toggle("muted", !cur.info);
    }
  }

  // ---------- Rasta sahifasi va uch chiziqli menyu ----------
  function closeDrawer() {
    $("listWrap").classList.remove("open");
    $("scrim").hidden = true;
    $("menuBtn").setAttribute("aria-expanded", "false");
  }
  $("menuBtn").addEventListener("click", () => {
    const open = !$("listWrap").classList.contains("open");
    $("listWrap").classList.toggle("open", open);
    $("scrim").hidden = !open;
    $("menuBtn").setAttribute("aria-expanded", String(open));
  });
  $("scrim").addEventListener("click", closeDrawer);
  $("homeBtn").addEventListener("click", () => select(null));
  $("closeDetail").addEventListener("click", () => select(null));
  $("deleteStall").addEventListener("click", () => {
    if (!confirm("Bu rasta o'chirilsinmi?")) return;
    stalls = stalls.filter((x) => x.id !== selectedId);
    saveStalls(); // avtomatik saqlash
    selectedId = null;
    render();
  });
  window.addEventListener("resize", () => { if (window.innerWidth >= 800) closeDrawer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // ---------- Akkaunt menyusi ----------
  $("accountBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("accountMenu").hidden;
    $("accountMenu").hidden = !open;
    $("accountBtn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => {
    $("accountMenu").hidden = true;
    $("accountBtn").setAttribute("aria-expanded", "false");
  });
  function logout() {
    localStorage.removeItem(KEY_TOKEN);
    currentUser = null;
    selectedId = null;
    stalls = [];
    closeDrawer();
    $("app").classList.remove("has-selection");
    $("accountMenu").hidden = true;
    showAuth();
  }
  $("logoutBtn").addEventListener("click", async () => {
    try { await api("POST", "/api/logout"); } catch { /* baribir chiqamiz */ }
    logout();
  });

  // ---------- Rasta qo'shish oynasi ----------
  function openModal() {
    const draft = read(draftKey(currentUser), { name: "", info: "" });
    $("stallName").value = draft.name;
    $("stallInfo").value = draft.info;
    $("modal").hidden = false;
    $("stallName").focus();
  }
  function closeModal() { $("modal").hidden = true; }

  $("addBtn").addEventListener("click", openModal);
  $("cancelBtn").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });

  // Yozayotganda qoralama avtomatik saqlanadi
  const saveDraft = () => write(draftKey(currentUser), { name: $("stallName").value, info: $("stallInfo").value });
  $("stallName").addEventListener("input", saveDraft);
  $("stallInfo").addEventListener("input", saveDraft);

  $("stallForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("stallName").value.trim();
    if (!name) return;
    stalls.unshift({ id: Date.now(), name, info: $("stallInfo").value.trim() });
    saveStalls(); // avtomatik saqlash
    localStorage.removeItem(draftKey(currentUser));
    closeModal();
    render();
  });

  start();
})();
