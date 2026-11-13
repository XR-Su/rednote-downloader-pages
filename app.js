// static/backend-client.js
var origin = "https://rednote-downloader-346472-13-1300255149.sh.run.tcloudbase.com";
function backendMediaUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && /^\/api\/media\/[a-f0-9]{36}$/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}
async function apiFetch(value, options) {
  const url = new URL(value, origin);
  if (url.origin !== origin || !/^\/api\/(?:parse|download|media\/[a-f0-9]{36})$/.test(url.pathname)) throw new Error("\u8BF7\u6C42\u5730\u5740\u4E0D\u53D7\u652F\u6301\u3002");
  return fetch(url, { ...options, credentials: "omit" });
}

// public/static-app.js
function filenameFromDisposition(header, fallback) {
  let filename;
  const utf8 = header?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      filename = decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ""));
    } catch {
    }
  }
  if (!filename) filename = header?.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)?.slice(1).find(Boolean)?.trim();
  return (filename || fallback).replace(/[\\/\u0000-\u001f\u007f]/g, "_");
}
function selectedAssets(assets, ids) {
  return assets.filter((asset) => ids.has(asset.id));
}
function downloadUrl(url, fallback = false) {
  const result = new URL(url, "http://localhost");
  result.searchParams.set("download", "1");
  if (fallback) result.searchParams.set("size", "fallback");
  return result.origin === "http://localhost" ? result.pathname + result.search : result.href;
}
function remainingFailures(previous, attempted, failed) {
  const ids = new Set(attempted.map((asset) => asset.id));
  return [...previous.filter((item) => !ids.has(item.asset.id)), ...failed];
}
function isAppleMobile(device = navigator) {
  return /iPhone|iPad|iPod/i.test(device.userAgent || "") || device.platform === "MacIntel" && device.maxTouchPoints > 1;
}
function originalUrl(url) {
  const result = new URL(url, "http://localhost");
  for (const key of ["download", "preview", "size"]) result.searchParams.delete(key);
  return result.origin === "http://localhost" ? result.pathname + result.search : result.href;
}
var AlbumQueue = class {
  constructor(assets) {
    this.assets = [...assets];
    this.index = 0;
    this.current = null;
  }
  async prepare(fetcher = apiFetch) {
    this.current = null;
    const asset = this.assets[this.index];
    if (!asset) throw new Error("\u672C\u6B21\u7D20\u6750\u5DF2\u5904\u7406\u5B8C\u6BD5\u3002");
    const response = await fetcher(downloadUrl(originalUrl(asset.url)));
    if (!response.ok) throw await responseError(response);
    const blob = await response.blob();
    if (!blob.size || !/^(image\/|video\/)/i.test(blob.type)) throw new Error("\u672A\u6536\u5230\u6709\u6548\u7684\u56FE\u7247\u6216\u89C6\u9891\u539F\u6587\u4EF6\u3002");
    const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), `${asset.id}.${asset.kind === "image" ? "jpg" : "mp4"}`);
    this.current = new File([blob], filename, { type: blob.type });
    return this.current;
  }
  canShare(device, secure) {
    if (!secure || !this.current || typeof device.share !== "function" || typeof device.canShare !== "function") return false;
    try {
      return device.canShare({ files: [this.current] });
    } catch {
      return false;
    }
  }
  share(device, secure) {
    if (!this.canShare(device, secure)) throw new Error("\u6B64\u6D4F\u89C8\u5668\u6216\u6587\u4EF6\u683C\u5F0F\u65E0\u6CD5\u4F7F\u7528\u7CFB\u7EDF\u5206\u4EAB\uFF0C\u8BF7\u6253\u5F00\u539F\u6587\u4EF6\u4FDD\u5B58\u3002");
    return device.share({ files: [this.current] });
  }
  next() {
    this.current = null;
    this.index++;
    return this.index < this.assets.length;
  }
};
async function responseError(response) {
  let data;
  try {
    data = await response.json();
  } catch {
  }
  const error = new Error(data?.error || `\u8BF7\u6C42\u672A\u6210\u529F\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002`);
  error.failures = Array.isArray(data?.failures) ? data.failures : [];
  return error;
}
async function downloadZip(ids, title, fetcher = apiFetch) {
  const response = await fetcher("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, title })
  });
  if (!response.ok) throw await responseError(response);
  if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/zip")) throw new Error("\u670D\u52A1\u672A\u8FD4\u56DE ZIP \u6587\u4EF6\uFF0C\u8BF7\u91CD\u8BD5\u6216\u6539\u7528\u9010\u4E2A\u539F\u6587\u4EF6\u3002");
  const succeeded = response.headers.get("X-Download-Succeeded");
  const failed = response.headers.get("X-Download-Failed");
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), `${title || "\u5C0F\u7EA2\u4E66\u6536\u85CF"}.zip`),
    succeeded: succeeded === null ? null : Number(succeeded),
    failed: failed === null ? null : Number(failed)
  };
}
async function downloadSequential(assets, { fetcher = apiFetch, save, onProgress = () => {
}, fallback = false }) {
  const succeeded = [];
  const failed = [];
  for (const [index, asset] of assets.entries()) {
    onProgress({ completed: index, total: assets.length, asset });
    try {
      const response = await fetcher(downloadUrl(asset.url, fallback));
      if (!response.ok) throw await responseError(response);
      if (response.headers.get("Content-Type")?.includes("application/json")) throw new Error("\u670D\u52A1\u8FD4\u56DE\u4E86\u9519\u8BEF\u4FE1\u606F\uFF0C\u672A\u6536\u5230\u539F\u6587\u4EF6\u3002");
      const blob = await response.blob();
      if (!blob.size) throw new Error("\u6536\u5230\u7684\u6587\u4EF6\u4E3A\u7A7A\u3002");
      const defaultName = `${asset.label || asset.id}.${asset.kind === "image" ? "jpg" : "mp4"}`;
      await save(blob, filenameFromDisposition(response.headers.get("Content-Disposition"), defaultName), asset);
      succeeded.push(asset);
    } catch (error) {
      failed.push({ asset, error: error.message || "\u7F51\u7EDC\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u8BD5\u3002" });
    }
    onProgress({ completed: index + 1, total: assets.length, asset });
  }
  return { succeeded, failed };
}
if (typeof document !== "undefined") init();
function init() {
  const $ = (id) => document.getElementById(id);
  let note = null;
  let selected = /* @__PURE__ */ new Set();
  let busy = false;
  let failedIds = [];
  let failedItems = [];
  let directFailures = false;
  let previewTrigger = null;
  let albumQueue = null;
  const objectUrls = /* @__PURE__ */ new Map();
  const typeNames = { image: "\u56FE\u7247", live: "\u5B9E\u51B5\u89C6\u9891", video: "\u89C6\u9891" };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function releaseUrls() {
    for (const [url, timer] of objectUrls) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    objectUrls.clear();
  }
  function updateControls() {
    const assets = note?.assets || [];
    const count = selectedAssets(assets, selected).length;
    document.querySelectorAll("[data-lock], #asset-grid input, #asset-grid button").forEach((control) => {
      control.disabled = busy;
    });
    $("download-button").disabled = busy || count === 0;
    $("select-all").disabled = busy || assets.length === 0;
    $("select-none").disabled = busy || count === 0;
    $("select-all").checked = assets.length > 0 && count === assets.length;
    $("select-all").indeterminate = count > 0 && count < assets.length;
    $("selection-count").textContent = `\u5DF2\u9009 ${count} / ${assets.length} \u9879`;
    $("download-count").textContent = count ? `\u5DF2\u9009 ${count} \u9879\uFF0C\u51C6\u5907\u7559\u4E0B` : "\u8FD8\u6CA1\u6709\u9009\u62E9\u6587\u4EF6";
    $("parse-button").textContent = busy ? "\u5904\u7406\u4E2D\uFF0C\u8BF7\u7A0D\u5019\u2026" : "\u7C98\u8D34\u5E76\u89E3\u6790 \u2197";
    const album = document.querySelector("input[name=mode]:checked").value === "album";
    $("download-button").textContent = busy ? "\u5904\u7406\u4E2D\uFF0C\u8BF7\u7A0D\u5019\u2026" : `${album ? "\u51C6\u5907\u4FDD\u5B58\u5230\u76F8\u518C" : "\u4E0B\u8F7D\u6240\u9009\u6587\u4EF6"}${count ? `\uFF08${count}\uFF09` : ""} \u2193`;
    $("results-section").setAttribute("aria-busy", String(busy));
    $("small-download-button").hidden = !directFailures || document.querySelector("input[name=mode]:checked").value !== "direct" || !failedItems.some((item) => item.asset.kind === "image");
    document.querySelectorAll("#asset-grid video").forEach((video) => {
      video.controls = !busy;
      if (busy) video.pause();
    });
  }
  function setBusy(value) {
    busy = value;
    updateControls();
  }
  function resetFeedback() {
    releaseUrls();
    if (albumQueue) albumQueue.current = null;
    albumQueue = null;
    $("album-actions").hidden = true;
    $("album-open").removeAttribute("href");
    failedIds = [];
    failedItems = [];
    directFailures = false;
    $("download-feedback").hidden = true;
    $("download-status").textContent = "";
    $("download-progress").hidden = true;
    $("failure-list").replaceChildren();
    $("failure-list").hidden = true;
    $("retry-button").hidden = true;
    $("small-download-button").hidden = true;
    $("saved-links").hidden = true;
    $("fallback-links").replaceChildren();
  }
  function addFallback(url, filename) {
    const link = element("a", "", filename);
    link.href = url;
    link.download = filename;
    const item = element("li");
    item.append(link);
    $("fallback-links").append(item);
    $("saved-links").hidden = false;
  }
  async function saveBlob(blob, filename, asset) {
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    if (asset) {
      addFallback(downloadUrl(asset.url), filename);
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.delete(url);
      }, 1e3);
      objectUrls.set(url, timer);
      await new Promise((resolve) => setTimeout(resolve, 1100));
    } else {
      addFallback(url, filename);
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.delete(url);
        $("fallback-links").replaceChildren();
        $("fallback-help").textContent = "ZIP \u624B\u52A8\u4FDD\u5B58\u94FE\u63A5\u5DF2\u91CA\u653E\u4EE5\u8282\u7701\u5185\u5B58\u3002\u5982\u672A\u4FDD\u5B58\uFF0C\u8BF7\u518D\u6B21\u70B9\u51FB\u4E0B\u8F7D\u6240\u9009\u6587\u4EF6\u3002";
      }, 6e4);
      objectUrls.set(url, timer);
    }
  }
  function showFailures(failures) {
    $("failure-list").replaceChildren(...failures.map((item) => element("li", "", `${item.label || item.asset?.label || "\u6587\u4EF6"}\uFF1A${item.error || "\u83B7\u53D6\u5931\u8D25"}`)));
    $("failure-list").hidden = failures.length === 0;
  }
  function showPreview(asset, trigger) {
    previewTrigger = trigger;
    $("preview-title").textContent = `${asset.label || "\u56FE\u7247"} \xB7 \u9884\u89C8`;
    $("dialog-image").alt = `${asset.label || "\u56FE\u7247"}\u7684\u9884\u89C8\u56FE`;
    $("preview-error").hidden = true;
    $("dialog-image").hidden = false;
    $("dialog-image").src = asset.preview;
    $("preview-dialog").showModal();
  }
  function renderNote() {
    $("asset-grid").replaceChildren();
    $("empty-state").hidden = Boolean(note);
    $("note-content").hidden = !note;
    $("asset-count").textContent = note ? `${note.assets.length} \u9879\u7D20\u6750` : "\u7B49\u5F85\u89E3\u6790";
    if (!note) {
      updateControls();
      return;
    }
    $("note-title").textContent = note.title || "\u672A\u547D\u540D\u7B14\u8BB0";
    $("note-author").textContent = note.author ? `\u6765\u81EA ${note.author}` : "\u4F5C\u8005\u4FE1\u606F\u672A\u63D0\u4F9B";
    $("warnings").replaceChildren(...note.warnings.map((warning) => element("li", "", warning)));
    $("warnings").hidden = !note.warnings.length;
    if (!note.assets.length) $("asset-grid").append(element("p", "muted", "\u8FD9\u7BC7\u7B14\u8BB0\u6CA1\u6709\u89E3\u6790\u5230\u53EF\u4FDD\u5B58\u7684\u7D20\u6750\uFF0C\u53EF\u4EE5\u6362\u4E00\u6761\u94FE\u63A5\u8BD5\u8BD5\u3002"));
    note.assets.forEach((asset, index) => {
      const card = element("article", "asset-card");
      const visual = element("div", "asset-visual");
      const error = element("p", "media-error", asset.kind === "image" ? "\u9884\u89C8\u6682\u4E0D\u53EF\u7528\uFF0C\u53EF\u5C1D\u8BD5\u4E0B\u8F7D\u539F\u6587\u4EF6\u3002" : "\u6D4F\u89C8\u5668\u65E0\u6CD5\u64AD\u653E\u6B64\u9884\u89C8\uFF0C\u53EF\u80FD\u662F\u7F16\u7801\u3001\u7F51\u7EDC\u6216\u6D4F\u89C8\u5668\u517C\u5BB9\u6027\u95EE\u9898\u3002\u4ECD\u53EF\u5C1D\u8BD5\u4E0B\u8F7D\u539F\u6587\u4EF6\u3002");
      error.hidden = true;
      if (asset.kind === "image") {
        if (asset.preview) {
          const button = element("button", "preview-button");
          button.type = "button";
          button.setAttribute("aria-label", `\u653E\u5927\u9884\u89C8\uFF1A${asset.label || `\u56FE\u7247 ${index + 1}`}`);
          const image = element("img");
          image.src = asset.preview;
          image.alt = `${asset.label || "\u56FE\u7247"}\u7684\u7F29\u7565\u9884\u89C8`;
          image.loading = "lazy";
          image.addEventListener("error", () => {
            error.hidden = false;
          });
          button.append(image, element("span", "preview-label", "\u653E\u5927\u9884\u89C8"));
          button.addEventListener("click", () => showPreview(asset, button));
          visual.append(button);
        } else error.hidden = false;
      } else {
        const video = element("video");
        video.controls = true;
        video.preload = "none";
        video.playsInline = true;
        if (asset.preview) video.poster = asset.preview;
        video.src = asset.url;
        video.setAttribute("aria-label", `${asset.label || "\u89C6\u9891"}\u7684\u64AD\u653E\u9884\u89C8`);
        video.addEventListener("error", () => {
          error.hidden = false;
        });
        visual.append(video);
      }
      visual.append(error, element("span", "asset-type", asset.live && asset.kind === "image" ? "\u5B9E\u51B5\u7167\u7247" : typeNames[asset.kind]));
      const info = element("div", "asset-info");
      const label = element("label", "check-label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(asset.id);
      checkbox.value = asset.id;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(asset.id);
        else selected.delete(asset.id);
        updateControls();
      });
      label.append(checkbox, element("span", "", asset.label || `${typeNames[asset.kind]} ${index + 1}`));
      info.append(label, element("p", "asset-dimensions", asset.width && asset.height ? `${asset.width} \xD7 ${asset.height} \xB7 ${typeNames[asset.kind]}` : `\u5C3A\u5BF8\u672A\u77E5 \xB7 ${typeNames[asset.kind]}`));
      card.append(visual, info);
      $("asset-grid").append(card);
    });
    updateControls();
  }
  function syncSelection() {
    document.querySelectorAll("#asset-grid input").forEach((input) => {
      input.checked = selected.has(input.value);
    });
    updateControls();
  }
  $("clear-button").addEventListener("click", () => {
    $("share-text").value = "";
    $("share-text").focus();
  });
  $("parse-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const input = $("share-text");
    try {
      const clipboardText = input.value.trim() ? "" : await navigator.clipboard?.readText();
      if (clipboardText?.trim()) input.value = clipboardText.slice(0, input.maxLength);
    } catch {
    }
    const text = input.value.trim();
    if (!text) {
      $("parse-status").textContent = "";
      $("parse-error").textContent = "\u8BF7\u5148\u5728\u8F93\u5165\u6846\u4E2D\u7C98\u8D34\u5C0F\u7EA2\u4E66\u94FE\u63A5\u6216\u5206\u4EAB\u6587\u6848\u3002";
      $("parse-error").hidden = false;
      setBusy(false);
      input.focus();
      return;
    }
    resetFeedback();
    note = null;
    selected.clear();
    renderNote();
    $("parse-error").hidden = true;
    $("parse-status").textContent = "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\uFF0C\u6574\u7406\u53EF\u7528\u7D20\u6750\u2026";
    try {
      const response = await apiFetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(9e4) });
      if (!response.ok) throw await responseError(response);
      const data = await response.json();
      if (!Array.isArray(data.assets)) throw new Error("\u89E3\u6790\u7ED3\u679C\u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      const unusedLocalMedia = (value) => {
        if (typeof value !== "string") return null;
        const url = new URL(value, location.href);
        return url.origin === location.origin && url.pathname.startsWith("/api/media/") ? url.pathname + url.search : null;
      };
      const assets = data.assets.map((asset) => ({ ...asset, url: backendMediaUrl(asset.url), preview: backendMediaUrl(asset.preview) }));
      if (assets.some((asset) => !asset.url || !asset.id || !typeNames[asset.kind])) throw new Error("\u89E3\u6790\u7ED3\u679C\u5305\u542B\u65E0\u6548\u7D20\u6750\uFF0C\u8BF7\u91CD\u65B0\u89E3\u6790\u3002");
      note = { title: String(data.title || ""), author: String(data.author || ""), warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [], assets };
      selected = new Set(assets.map((asset) => asset.id));
      renderNote();
      $("parse-status").textContent = `\u89E3\u6790\u5B8C\u6210\uFF0C\u627E\u5230 ${assets.length} \u9879\u7D20\u6750${assets.length ? "\uFF0C\u5DF2\u9ED8\u8BA4\u5168\u9009\u3002" : "\u3002"}`;
    } catch (error) {
      note = null;
      selected.clear();
      renderNote();
      $("parse-status").textContent = "";
      $("parse-error").textContent = error.name === "TimeoutError" ? "\u89E3\u6790\u7B49\u5F85\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002" : error.message || "\u89E3\u6790\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002";
      $("parse-error").hidden = false;
    } finally {
      setBusy(false);
    }
  });
  $("select-all").addEventListener("change", (event) => {
    selected = new Set(event.target.checked ? note.assets.map((asset) => asset.id) : []);
    syncSelection();
  });
  $("select-none").addEventListener("click", () => {
    selected.clear();
    syncSelection();
  });
  function updateModeHelp() {
    const mode = document.querySelector("input[name=mode]:checked").value;
    $("mode-help").textContent = mode === "album" ? "\u9010\u9879\u51C6\u5907\u539F\u6587\u4EF6\uFF0C\u518D\u70B9\u51FB\u6253\u5F00\u7CFB\u7EDF\u5206\u4EAB\u83DC\u5355\uFF0C\u9009\u62E9\u300C\u5B58\u50A8\u56FE\u50CF\u300D\u6216\u300C\u5B58\u50A8\u89C6\u9891\u300D\u3002\u5B9E\u51B5\u7D20\u6750\u7684\u56FE\u7247\u4E0E\u89C6\u9891\u5206\u522B\u4FDD\u5B58\uFF0C\u4E0D\u5408\u6210\u4E3A Live Photo\u3002\u666E\u901A\u4E0B\u8F7D\u4E0E ZIP \u4F1A\u4FDD\u5B58\u5230\u300C\u6587\u4EF6\u300D\uFF0C\u7F51\u9875\u65E0\u6CD5\u786E\u8BA4\u662F\u5426\u5DF2\u5B58\u5165\u76F8\u518C\u3002" : mode === "direct" ? "\u6D4F\u89C8\u5668\u53EF\u80FD\u8BE2\u95EE\u662F\u5426\u5141\u8BB8\u591A\u6587\u4EF6\u4E0B\u8F7D\uFF0C\u8BF7\u9009\u62E9\u5141\u8BB8\u3002\u5DE5\u5177\u53EA\u80FD\u786E\u8BA4\u6587\u4EF6\u5DF2\u83B7\u53D6\u5E76\u53D1\u8D77\u4FDD\u5B58\uFF0C\u65E0\u6CD5\u786E\u8BA4\u6D4F\u89C8\u5668\u5DF2\u4FDD\u5B58\uFF1B\u4E0B\u65B9\u4F1A\u4FDD\u7559\u624B\u52A8\u94FE\u63A5\uFF08\u91CD\u65B0\u4ECE\u672C\u5730\u670D\u52A1\u83B7\u53D6\uFF09\u3002" : "ZIP \u4F1A\u5305\u542B\u83B7\u53D6\u6210\u529F\u7684\u6587\u4EF6\uFF1B\u672A\u6210\u529F\u7684\u9879\u76EE\u8BB0\u5F55\u5728\u300C\u4E0B\u8F7D\u5931\u8D25.txt\u300D\u4E2D\u3002";
  }
  document.querySelectorAll("input[name=mode]").forEach((input) => input.addEventListener("change", () => {
    if (albumQueue) resetFeedback();
    updateModeHelp();
    updateControls();
  }));
  async function prepareAlbum() {
    const queue = albumQueue;
    if (!queue || busy) return;
    setBusy(true);
    const asset = queue.assets[queue.index];
    $("album-actions").hidden = true;
    $("album-open").removeAttribute("href");
    $("download-status").textContent = `\u6B63\u5728\u51C6\u5907 ${queue.index + 1} / ${queue.assets.length}\uFF1A${asset.label || "\u539F\u6587\u4EF6"}\uFF0C\u8BF7\u4FDD\u6301\u9875\u9762\u6253\u5F00\u2026`;
    $("download-progress").hidden = false;
    $("download-progress").removeAttribute("value");
    $("album-share").hidden = true;
    $("album-retry").hidden = true;
    try {
      await queue.prepare();
      const supported = queue.canShare(navigator, window.isSecureContext);
      $("album-share").hidden = !supported;
      $("download-status").textContent = `${queue.index + 1} / ${queue.assets.length} \u5DF2\u51C6\u5907\uFF1A${queue.current.name}\u3002${supported ? "\u70B9\u51FB\u300C\u6253\u5F00\u5206\u4EAB\u83DC\u5355\u300D\uFF0C\u518D\u9009\u62E9\u300C\u5B58\u50A8\u56FE\u50CF\u300D\u6216\u300C\u5B58\u50A8\u89C6\u9891\u300D\u3002" : "\u5F53\u524D\u6D4F\u89C8\u5668\u6216\u6587\u4EF6\u683C\u5F0F\u65E0\u6CD5\u5206\u4EAB\uFF0C\u8BF7\u6253\u5F00\u539F\u6587\u4EF6\u4FDD\u5B58\u3002"}\u786E\u8BA4\u4FDD\u5B58\u540E\u518D\u7EE7\u7EED\u4E0B\u4E00\u9879\u3002`;
      $("album-help").textContent = `${!window.isSecureContext ? "\u7CFB\u7EDF\u6587\u4EF6\u5206\u4EAB\u9700\u8981\u901A\u8FC7 HTTPS \u8BBF\u95EE\u3002" : ""}\u82E5\u5206\u4EAB\u83DC\u5355\u6CA1\u6709\u5B58\u50A8\u9009\u9879\uFF0C\u53EF\u6253\u5F00\u539F\u6587\u4EF6\uFF1A\u56FE\u7247\u957F\u6309\u5C1D\u8BD5\u300C\u5B58\u50A8\u5230\u7167\u7247\u300D\uFF1B\u89C6\u9891\u4F7F\u7528\u7CFB\u7EDF\u5206\u4EAB\uFF0C\u6216\u4E0B\u8F7D\u5230\u300C\u6587\u4EF6\u300D\u540E\u518D\u5206\u4EAB\u4FDD\u5B58\u3002\u683C\u5F0F\u652F\u6301\u4EE5\u7CFB\u7EDF\u4E3A\u51C6\u3002\u6B64\u5165\u53E3\u4F7F\u7528\u539F\u6587\u4EF6\uFF0C\u4F1A\u91CD\u65B0\u83B7\u53D6\uFF1B\u94FE\u63A5\u8FC7\u671F\u65F6\u9700\u91CD\u65B0\u89E3\u6790\u3002`;
    } catch (error) {
      $("download-status").textContent = `${queue.index + 1} / ${queue.assets.length} \u83B7\u53D6\u5931\u8D25\uFF1A${error.message || "\u7F51\u7EDC\u8FDE\u63A5\u4E2D\u65AD"}\u3002\u53EF\u91CD\u8BD5\u5F53\u524D\u9879\u6216\u8DF3\u8FC7\u3002`;
      $("album-retry").hidden = false;
      $("album-help").textContent = "\u539F\u6587\u4EF6\u672A\u83B7\u53D6\u6210\u529F\uFF0C\u4E0D\u4F1A\u7528\u7F29\u7565\u9884\u89C8\u66FF\u4EE3\u3002";
    } finally {
      $("album-open").href = originalUrl(asset.url);
      $("album-open").hidden = !queue.current;
      $("album-next").hidden = queue.index + 1 >= queue.assets.length;
      $("album-next").textContent = queue.current ? "\u4E0B\u4E00\u9879" : "\u8DF3\u8FC7\uFF0C\u4E0B\u4E00\u9879";
      $("album-actions").hidden = false;
      $("download-progress").hidden = true;
      setBusy(false);
      (queue.current ? $("album-share").hidden ? $("album-open") : $("album-share") : $("album-retry")).focus();
    }
  }
  $("album-share").addEventListener("click", async () => {
    if (busy || !albumQueue?.current) return;
    const queue = albumQueue;
    try {
      const sharing = queue.share(navigator, window.isSecureContext);
      setBusy(true);
      await sharing;
      $("download-status").textContent = "\u5206\u4EAB\u83DC\u5355\u5DF2\u5173\u95ED\u3002\u8BF7\u5728\u300C\u7167\u7247\u300D\u4E2D\u786E\u8BA4\u4FDD\u5B58\u7ED3\u679C\uFF1B\u53EF\u518D\u6B21\u5206\u4EAB\u5F53\u524D\u6587\u4EF6\uFF0C\u6216\u7EE7\u7EED\u4E0B\u4E00\u9879\u3002";
    } catch (error) {
      $("download-status").textContent = error.name === "AbortError" ? "\u5206\u4EAB\u5DF2\u53D6\u6D88\uFF0C\u5F53\u524D\u539F\u6587\u4EF6\u4ECD\u4FDD\u7559\uFF0C\u53EF\u518D\u6B21\u6253\u5F00\u5206\u4EAB\u83DC\u5355\u3002" : `\u5206\u4EAB\u672A\u5B8C\u6210\uFF1A${error.message || "\u8BF7\u91CD\u8BD5\u6216\u6253\u5F00\u539F\u6587\u4EF6\u4FDD\u5B58\u3002"} \u5F53\u524D\u539F\u6587\u4EF6\u4ECD\u4FDD\u7559\u3002`;
    } finally {
      setBusy(false);
    }
  });
  $("album-retry").addEventListener("click", prepareAlbum);
  $("album-next").addEventListener("click", () => {
    if (busy || !albumQueue) return;
    if (albumQueue.next()) prepareAlbum();
  });
  $("album-end").addEventListener("click", () => {
    if (busy || !albumQueue) return;
    albumQueue.current = null;
    albumQueue = null;
    $("album-actions").hidden = true;
    $("album-open").removeAttribute("href");
    $("download-status").textContent = "\u672C\u6B21\u4FDD\u5B58\u6D41\u7A0B\u5DF2\u7ED3\u675F\u3002\u8BF7\u5728\u300C\u7167\u7247\u300D\u4E2D\u786E\u8BA4\u5B9E\u9645\u4FDD\u5B58\u7ED3\u679C\uFF1B\u9700\u8981\u65F6\u53EF\u91CD\u65B0\u9009\u62E9\u5E76\u51C6\u5907\u6587\u4EF6\u3002";
  });
  async function startDownload(retry = false, fallback = false) {
    if (busy || !note) return;
    const mode = document.querySelector("input[name=mode]:checked").value;
    if (fallback && (mode !== "direct" || !directFailures)) return;
    const assets = selectedAssets(note.assets, retry ? new Set(failedIds) : selected).filter((asset) => !fallback || asset.kind === "image");
    if (!assets.length) return;
    if (mode === "album") {
      resetFeedback();
      albumQueue = new AlbumQueue(assets);
      $("download-feedback").hidden = false;
      await prepareAlbum();
      return;
    }
    const previousFailures = fallback ? failedItems : [];
    resetFeedback();
    setBusy(true);
    $("download-feedback").hidden = false;
    $("download-progress").hidden = false;
    $("download-progress").removeAttribute("value");
    $("download-status").textContent = mode === "zip" ? `\u6B63\u5728\u83B7\u53D6\u5E76\u6253\u5305 ${assets.length} \u9879\u7D20\u6750\uFF0C\u89C6\u9891\u8F83\u5927\u65F6\u53EF\u80FD\u9700\u8981\u51E0\u5206\u949F\uFF0C\u8BF7\u4FDD\u6301\u9875\u9762\u6253\u5F00\u2026` : fallback ? "\u6B63\u5728\u83B7\u53D6\u5931\u8D25\u56FE\u7247\u7684\u6700\u5927\u53EF\u7528\u5C3A\u5BF8\u3002\u6D4F\u89C8\u5668\u53EF\u80FD\u9700\u8981\u4F60\u5141\u8BB8\u591A\u6587\u4EF6\u4E0B\u8F7D\u2026" : "\u6B63\u5728\u9010\u4E2A\u83B7\u53D6\u539F\u6587\u4EF6\u3002\u6D4F\u89C8\u5668\u53EF\u80FD\u9700\u8981\u4F60\u5141\u8BB8\u591A\u6587\u4EF6\u4E0B\u8F7D\u2026";
    try {
      if (mode === "zip") {
        const result = await downloadZip(assets.map((asset) => asset.id), note.title);
        $("fallback-help").textContent = "\u5DF2\u53D1\u8D77 ZIP \u4FDD\u5B58\u3002\u82E5\u6D4F\u89C8\u5668\u672A\u81EA\u52A8\u4FDD\u5B58\uFF0C\u8BF7\u5728 60 \u79D2\u5185\u70B9\u51FB\u4E0B\u65B9\u94FE\u63A5\uFF1B\u8FC7\u671F\u540E\u53EF\u91CD\u65B0\u4E0B\u8F7D\u3002";
        await saveBlob(result.blob, result.filename);
        const countsKnown = Number.isFinite(result.succeeded) && Number.isFinite(result.failed);
        $("download-status").textContent = countsKnown ? `\u6253\u5305\u5B8C\u6210\uFF1A${result.succeeded} \u9879\u83B7\u53D6\u6210\u529F\uFF0C${result.failed} \u9879\u5931\u8D25\u3002\u5DF2\u53D1\u8D77 ZIP \u4FDD\u5B58${result.failed ? "\uFF1B\u5931\u8D25\u539F\u56E0\u89C1\u538B\u7F29\u5305\u5185\u300C\u4E0B\u8F7D\u5931\u8D25.txt\u300D\uFF0C\u53EF\u4FDD\u7559\u5F53\u524D\u9009\u62E9\u91CD\u65B0\u5C1D\u8BD5" : ""}\u3002\u8BF7\u5728\u6D4F\u89C8\u5668\u4E0B\u8F7D\u5217\u8868\u786E\u8BA4\u4FDD\u5B58\u7ED3\u679C\u3002` : "ZIP \u5DF2\u83B7\u53D6\u5E76\u53D1\u8D77\u4FDD\u5B58\u3002\u8BF7\u67E5\u770B\u538B\u7F29\u5305\u5185\u5BB9\u53CA\u53EF\u80FD\u9644\u5E26\u7684\u300C\u4E0B\u8F7D\u5931\u8D25.txt\u300D\uFF0C\u5E76\u5728\u6D4F\u89C8\u5668\u4E0B\u8F7D\u5217\u8868\u786E\u8BA4\u4FDD\u5B58\u7ED3\u679C\u3002";
      } else {
        $("fallback-help").textContent = "\u4E0B\u65B9\u94FE\u63A5\u5BF9\u5E94\u672C\u6B21\u5DF2\u6210\u529F\u83B7\u53D6\u7684\u6587\u4EF6\u3002\u70B9\u51FB\u4F1A\u4ECE\u672C\u5730\u670D\u52A1\u91CD\u65B0\u83B7\u53D6\u5E76\u4FDD\u5B58\uFF0C\u4E0D\u4FDD\u7559\u5927\u6587\u4EF6\u5185\u5B58\uFF1B\u94FE\u63A5\u8FC7\u671F\u65F6\u8BF7\u91CD\u65B0\u89E3\u6790\u3002\u82E5\u6D4F\u89C8\u5668\u8BE2\u95EE\uFF0C\u8BF7\u5141\u8BB8\u591A\u6587\u4EF6\u4E0B\u8F7D\u3002";
        const result = await downloadSequential(assets, {
          fallback,
          save: (blob, filename, asset) => saveBlob(blob, filename, fallback ? { ...asset, url: downloadUrl(asset.url, true) } : asset),
          onProgress: ({ completed, total, asset }) => {
            $("download-progress").max = total;
            $("download-progress").value = completed;
            $("download-status").textContent = completed === total ? `\u5DF2\u5904\u7406 ${completed} / ${total} \u9879\uFF0C\u6B63\u5728\u6574\u7406\u7ED3\u679C\u2026` : `\u5DF2\u5904\u7406 ${completed} / ${total} \u9879\uFF0C\u6B63\u5728\u83B7\u53D6\uFF1A${asset.label || "\u539F\u6587\u4EF6"}\u2026`;
          }
        });
        failedItems = remainingFailures(previousFailures, assets, result.failed);
        failedIds = failedItems.map((item) => item.asset.id);
        directFailures = true;
        if (fallback || failedIds.length) {
          selected = new Set(failedIds);
          syncSelection();
        }
        showFailures(failedItems);
        $("retry-button").hidden = !failedIds.length;
        $("download-status").textContent = fallback ? `\u5DF2\u901A\u8FC7\u5C0F\u5C3A\u5BF8\u515C\u5E95\u4E0B\u8F7D ${result.succeeded.length} \u9879\u5E76\u53D1\u8D77\u4FDD\u5B58\uFF0C${result.failed.length} \u9879\u515C\u5E95\u5931\u8D25\uFF0C${failedIds.length} \u9879\u4ECD\u672A\u5B8C\u6210\u3002${failedIds.length ? "\u5DF2\u4EC5\u52FE\u9009\u5931\u8D25\u9879\u76EE\uFF0C\u53EF\u91CD\u8BD5\u3002" : ""}\u8BF7\u5728\u6D4F\u89C8\u5668\u4E0B\u8F7D\u5217\u8868\u786E\u8BA4\u5B9E\u9645\u4FDD\u5B58\u7ED3\u679C\u3002` : `\u5904\u7406\u5B8C\u6210\uFF1A${result.succeeded.length} \u9879\u83B7\u53D6\u6210\u529F\u5E76\u5DF2\u53D1\u8D77\u4FDD\u5B58\uFF0C${result.failed.length} \u9879\u5931\u8D25\u3002${failedIds.length ? "\u5DF2\u4EC5\u52FE\u9009\u5931\u8D25\u9879\u76EE\uFF0C\u53EF\u91CD\u8BD5\u3002" : ""}\u8BF7\u5728\u6D4F\u89C8\u5668\u4E0B\u8F7D\u5217\u8868\u786E\u8BA4\u5B9E\u9645\u4FDD\u5B58\u7ED3\u679C\u3002`;
      }
    } catch (error) {
      failedItems = remainingFailures(previousFailures, assets, assets.map((asset) => ({ asset, error: error.message || "\u7F51\u7EDC\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u8BD5\u3002" })));
      failedIds = failedItems.map((item) => item.asset.id);
      directFailures = mode === "direct";
      selected = new Set(failedIds);
      syncSelection();
      $("retry-button").hidden = false;
      $("download-status").textContent = `\u4E0B\u8F7D\u672A\u5B8C\u6210\uFF1A${error.message || "\u7F51\u7EDC\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u8BD5\u3002"} \u6240\u9009\u9879\u76EE\u5DF2\u4FDD\u7559\uFF0C\u53EF\u91CD\u8BD5\u6216\u5207\u6362\u4E0B\u8F7D\u65B9\u5F0F\u3002`;
      showFailures(mode === "direct" ? failedItems : error.failures || []);
    } finally {
      $("download-progress").hidden = true;
      setBusy(false);
    }
  }
  $("download-button").addEventListener("click", () => startDownload());
  $("retry-button").addEventListener("click", () => startDownload(true));
  $("small-download-button").addEventListener("click", () => startDownload(true, true));
  $("close-preview").addEventListener("click", () => $("preview-dialog").close());
  $("preview-dialog").addEventListener("close", () => {
    $("dialog-image").removeAttribute("src");
    previewTrigger?.focus();
  });
  $("dialog-image").addEventListener("error", () => {
    $("dialog-image").hidden = true;
    $("preview-error").hidden = false;
  });
  window.addEventListener("pagehide", releaseUrls);
  if (isAppleMobile()) document.querySelector("input[name=mode][value=album]").checked = true;
  updateModeHelp();
  updateControls();
}
export {
  AlbumQueue,
  downloadSequential,
  downloadUrl,
  downloadZip,
  filenameFromDisposition,
  isAppleMobile,
  originalUrl,
  remainingFailures,
  selectedAssets
};
