// Copies the designs and settings a browser keeps for the web app's old address into this one.
// docs.solidcraft.io/app-transfer.html (from tangency-labs/solidcraft, packaging/web/transfer)
// reads them in a frame, which works because the two addresses are one site to the browser's
// storage partitioning. Only OLD_ORIGIN's frame is heard, nothing is sent anywhere else, and
// nothing that exists here is ever overwritten.
"use strict";
(() => {
  const OWN_ORIGIN = "https://app.solidcraft.io";
  const OLD_ORIGIN = "https://docs.solidcraft.io";
  const OLD_PAGE = `${OLD_ORIGIN}/app-transfer.html`;
  const PROTOCOL = 1;
  /** solidcraft_io::MAX_DESIGN_BYTES: the largest design the app opens. */
  const MAX_FILE_BYTES = 256 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
  const MAX_FILES = 5000;
  const MAX_SETTING_CHARS = 8 * 1024 * 1024;
  const MAX_NAME_BYTES = 255;
  const FRAME_TIMEOUT_MS = 20000;
  const HELLO_TIMEOUT_MS = 8000;
  const REQUEST_TIMEOUT_MS = 120000;
  /** apps/solidcraft-web/src/files.rs: the app's autosave. It's never written here by name. */
  const AUTOSAVES = ["recovery.sc", "recovery.solidcraft", "recovery.solvecraft"];
  const RESERVED = new Set([...AUTOSAVES, "recovery.json"]);
  /** Stored under the first name, the old name counting as already having it. */
  const PREFS_KEYS = ["solidcraft.prefs", "solvecraft.prefs"];
  const OTHER_SETTINGS = ["solidcraft.webgl", "egui_memory_ron"];

  const $ = (id) => document.getElementById(id);
  const utf8 = (text) => new TextEncoder().encode(text).length;

  /** A file name as it is, if it's safe to store: no folders, nothing the app reserves. */
  function safeName(name) {
    if (typeof name !== "string" || name.trim() === "" || name !== name.trim()) return null;
    if (name === "." || name === ".." || /[/\\\u0000-\u001f\u007f]/.test(name)) return null;
    if (utf8(name) > MAX_NAME_BYTES || RESERVED.has(name) || name.endsWith(".crswap")) return null;
    return name;
  }

  /** `stem` + `tail`, cut to fit a file name, with whatever a name can't hold replaced. */
  function fitted(stem, tail) {
    let cleaned = stem.replace(/[/\\\u0000-\u001f\u007f]/g, "-").replace(/^[.\s-]+/, "").trim();
    while (utf8(cleaned + tail) > MAX_NAME_BYTES) cleaned = Array.from(cleaned).slice(0, -1).join("");
    return `${cleaned || "Untitled"}${tail}`;
  }

  /** `name` split at its extension. */
  function parts(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  }

  /** What a listed file is called here, or null when it won't be taken. */
  function wantedName(file) {
    if (!file.autosave) return safeName(file.name);
    if (!AUTOSAVES.includes(file.name)) return null;
    const stem = typeof file.autosaveName === "string" && file.autosaveName ? file.autosaveName : "Untitled";
    return fitted(stem, ` (unsaved work from the old address)${parts(file.name)[1]}`);
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** The bytes stored as `name`, or null when nothing has that name. Another kind of entry counts as taken. */
  async function storedBytes(root, name) {
    let handle;
    try {
      handle = await root.getFileHandle(name);
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      return new Uint8Array(0);
    }
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  /**
   * Where `bytes` go: `wanted` if nothing has that name, else a clear new name. A file that is
   * already here with these bytes needs no second copy, so bringing designs over again adds nothing.
   */
  async function place(root, wanted, bytes) {
    const [stem, ext] = parts(wanted);
    for (let i = 1; i < 1000; i++) {
      const name = i === 1 ? wanted : fitted(stem, ` (from the old address${i === 2 ? "" : ` ${i - 1}`})${ext}`);
      const stored = await storedBytes(root, name);
      if (stored === null) return { name, present: false };
      if (sameBytes(stored, bytes)) return { name, present: true };
    }
    throw new Error("too many designs have this name");
  }

  /** Write a new file and read it back; a file that didn't arrive whole is taken away again. */
  async function write(root, name, bytes) {
    const handle = await root.getFileHandle(name, { create: true });
    try {
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      const back = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (!sameBytes(back, bytes)) throw new Error("the stored copy differs");
    } catch (error) {
      await root.removeEntry(name).catch(() => {});
      throw error;
    }
  }

  function showFallback(title, why) {
    $("status").hidden = true;
    $("fallback-title").textContent = title;
    $("fallback-why").textContent = why;
    $("fallback").hidden = false;
  }

  /** The frame's requests: `ask` posts only to OLD_ORIGIN and hears only that frame. */
  function connect() {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      // Storage and scripts, nothing else: no popups, navigating this page or downloads.
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.title = "Reads your designs at the old address";
      const pending = new Map();
      let nextId = 1;
      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow || event.origin !== OLD_ORIGIN) return;
        const reply = event.data;
        if (!reply || reply.solidcraftTransfer !== PROTOCOL || !pending.has(reply.id)) return;
        const { resolve: done, reject: failed, timer } = pending.get(reply.id);
        pending.delete(reply.id);
        clearTimeout(timer);
        if (reply.ok) done(reply);
        else failed(new Error(String(reply.error)));
      });
      const ask = (op, args = {}, waitMs = REQUEST_TIMEOUT_MS) =>
        new Promise((done, failed) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            failed(new Error("the old address did not answer"));
          }, waitMs);
          pending.set(id, { resolve: done, reject: failed, timer });
          frame.contentWindow.postMessage({ solidcraftTransfer: PROTOCOL, id, op, ...args }, OLD_ORIGIN);
        });
      const timeout = setTimeout(() => reject(new Error("the old address did not load")), FRAME_TIMEOUT_MS);
      frame.addEventListener("load", () => {
        clearTimeout(timeout);
        resolve(ask);
      });
      frame.src = OLD_PAGE;
      document.body.append(frame);
    });
  }

  const sizeText = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

  /** Keep what the frame listed that this page will take; the rest is named as left behind. */
  function accept(files) {
    const taken = [];
    const refused = [];
    let total = 0;
    for (const file of files.slice(0, MAX_FILES)) {
      const shown = typeof file?.name === "string" ? file.name : "(unnamed)";
      if (!file || !Number.isSafeInteger(file.size) || file.size < 0) {
        refused.push({ shown, why: "it has no readable size" });
        continue;
      }
      const wanted = wantedName(file);
      if (wanted === null) refused.push({ shown, why: "its name can't be stored safely" });
      else if (file.size > MAX_FILE_BYTES) refused.push({ shown: wanted, why: "it's larger than a design can be" });
      else if (total + file.size > MAX_TOTAL_BYTES) refused.push({ shown: wanted, why: "this is more than one copy can take" });
      else {
        total += file.size;
        taken.push({ source: file.name, wanted, size: file.size, format: Number.isSafeInteger(file.format) ? file.format : null });
      }
    }
    return { taken, refused };
  }

  function outcome(text) {
    const item = document.createElement("li");
    item.textContent = text;
    $("outcome").append(item);
  }

  /** Each setting only where this address has none: nothing here is replaced. */
  function copySettings(settings) {
    const copied = [];
    const local = window.localStorage;
    const write = (key, value) => {
      if (typeof value !== "string" || value.length > MAX_SETTING_CHARS) return false;
      local.setItem(key, value);
      return true;
    };
    const prefs = PREFS_KEYS.map((key) => settings[key]).find((value) => typeof value === "string");
    if (prefs !== undefined && PREFS_KEYS.every((key) => local.getItem(key) === null) && write(PREFS_KEYS[0], prefs)) copied.push("preferences");
    for (const key of OTHER_SETTINGS) {
      if (typeof settings[key] === "string" && local.getItem(key) === null && write(key, settings[key])) {
        copied.push(key === "egui_memory_ron" ? "window layout" : "renderer choice");
      }
    }
    const hadAny = prefs !== undefined || OTHER_SETTINGS.some((key) => typeof settings[key] === "string");
    if (copied.length > 0) return `Settings copied: ${copied.join(", ")}.`;
    return hadAny ? "Settings were left alone, because this address already has its own." : "";
  }

  async function bring(ask, taken) {
    $("bring").disabled = true;
    const say = (text) => {
      $("status").textContent = text;
    };
    let failed = 0;
    let root = null;
    try {
      root = await navigator.storage.getDirectory();
      if (typeof FileSystemFileHandle.prototype.createWritable !== "function") throw new Error("no writable files");
    } catch {
      showFallback("This browser can't store files here", "This browser can't write to the app's file storage from this page, so the designs were not copied.");
      return;
    }
    for (const [i, file] of taken.entries()) {
      say(`Copying ${i + 1} of ${taken.length}: ${file.wanted}`);
      try {
        const { bytes } = await ask("read", { name: file.source });
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > MAX_FILE_BYTES) throw new Error("it isn't a file this page can take");
        const data = new Uint8Array(bytes);
        const { name, present } = await place(root, file.wanted, data);
        if (present) {
          outcome(`${file.wanted}: already here, not copied again${name === file.wanted ? "" : ` (as ${name})`}.`);
        } else {
          await write(root, name, data);
          outcome(name === file.wanted ? `${name}: copied.` : `${file.wanted}: copied as ${name}, because a different design here has that name.`);
        }
      } catch (error) {
        failed++;
        const why = error?.name === "QuotaExceededError" ? "the browser is out of storage space" : (error?.message ?? String(error));
        outcome(`${file.wanted}: NOT copied (${why}). The original is still at the old address.`);
      }
    }
    try {
      $("settings-outcome").textContent = copySettings((await ask("settings")).settings ?? {});
    } catch (error) {
      $("settings-outcome").textContent = `Settings were not copied: ${error?.message ?? error}.`;
    }
    say(failed === 0 ? "" : `${failed} of ${taken.length} could not be copied.`);
    $("result").hidden = false;
    $("bring").hidden = true;
  }

  async function start() {
    // Nothing happens in someone else's frame, whatever they lay over it.
    if (window.top !== window) {
      document.body.textContent = "This page only works when it's opened on its own.";
      return;
    }
    if (window.location.origin !== OWN_ORIGIN) {
      showFallback("This page only works at app.solidcraft.io", "The old address only hands designs to app.solidcraft.io.");
      return;
    }
    let ask, listed;
    try {
      ask = await connect();
      // A missing page or one that refuses this one loads like any other, and then never answers.
      await ask("hello", {}, HELLO_TIMEOUT_MS);
      listed = await ask("list");
    } catch (error) {
      showFallback("The old address can't be reached from here", `This browser didn't let this page read the old address's storage (${error?.message ?? error}), so nothing has been copied. Whatever you saved at the old address is still there.`);
      return;
    }
    const { taken, refused } = accept(Array.isArray(listed.files) ? listed.files : []);
    for (const file of refused) outcome(`${file.shown}: left at the old address, because ${file.why}.`);
    if (taken.length === 0) {
      showFallback(
        "No designs found from here",
        "Nothing was found at the old address from this page. Some browsers (Safari may be one) keep a page's storage from other addresses out of reach, so anything you saved there may still be there. The page at the old address shows what it holds.",
      );
      if (refused.length > 0) $("result").hidden = false;
      return;
    }
    taken.sort((a, b) => a.wanted.localeCompare(b.wanted));
    const reads = Number.parseInt(document.documentElement.dataset.readsFormat ?? "", 10);
    for (const file of taken) {
      const row = $("rows").insertRow();
      const nameCell = row.insertCell();
      nameCell.textContent = file.wanted;
      if (Number.isSafeInteger(reads) && file.format !== null && file.format > reads) {
        const warning = document.createElement("span");
        warning.className = "warn";
        warning.textContent = `Saved by a newer build (format ${file.format}; this release reads up to ${reads}). It may not open here: see below.`;
        nameCell.append(warning);
      }
      const sizeCell = row.insertCell();
      sizeCell.className = "size";
      sizeCell.textContent = sizeText(file.size);
    }
    $("table").hidden = false;
    $("status").textContent = taken.length === 1 ? "1 design found at the old address." : `${taken.length} designs found at the old address.`;
    $("settings-note").hidden = false;
    $("bring").hidden = false;
    $("bring").addEventListener("click", () => bring(ask, taken), { once: true });
  }

  start();
})();
