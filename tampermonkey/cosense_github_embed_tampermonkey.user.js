// ==UserScript==
// @name         Cosense Zenn-style GitHub File Embed
// @namespace    https://github.com/
// @version      1.0.0
// @description  Embed standalone public GitHub text-file URLs in Cosense with a Zenn-like card.
// @author       Onely7
// @match        https://scrapbox.io/*
// @match        https://cosense.io/*
// @match        https://cosen.se/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const CLEANUP_KEY = "__cosenseZennGithubEmbedCleanup";
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_RENDER_LINES = 500;
  const REQUEST_TIMEOUT_MS = 15000;
  const RENDER_DELAY_MS = 40;
  const MISSING_LINK_GRACE_MS = 800;

  if (typeof window[CLEANUP_KEY] === "function") {
    window[CLEANUP_KEY]();
  }

  GM_addStyle(`
    .github-file-embed {
      --github-embed-border: #d6e3ed;
      --github-embed-header-bg: #f6f8fa;
      --github-embed-link: #0f83fd;
      --github-embed-muted: #65717b;
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      margin: 0.45em 0 0.7em;
      overflow: hidden;
      color: #24292f;
      background-color: #fff;
      border: 1px solid var(--github-embed-border);
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.6;
    }

    .github-file-embed-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      box-sizing: border-box;
      padding: 0.7rem 1rem;
      background-color: var(--github-embed-header-bg);
      border-bottom: 1px solid var(--github-embed-border);
    }

    .github-file-embed-logo {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      color: var(--github-embed-muted);
    }

    .github-file-embed-meta { min-width: 0; }

    .github-file-embed-title {
      display: block;
      color: var(--github-embed-link) !important;
      font-size: 1em;
      font-weight: 700;
      line-height: 1.35;
      overflow-wrap: anywhere;
      text-decoration: none !important;
    }

    .github-file-embed-title:hover {
      color: #1283fd !important;
      text-decoration: underline !important;
    }

    .github-file-embed-subtitle {
      color: var(--github-embed-muted);
      font-size: 0.9em;
      line-height: 1.35;
    }

    .github-file-embed-body {
      max-width: 100%;
      max-height: 36rem;
      overflow: auto;
      background-color: #fff;
    }

    .github-file-embed-row {
      display: grid;
      grid-template-columns: 4.2em minmax(max-content, 1fr);
      min-width: max-content;
      min-height: 1.65em;
    }

    .github-file-embed-row:hover { background-color: #f6f8fa; }

    .github-file-embed-line-number {
      position: sticky;
      left: 0;
      z-index: 1;
      box-sizing: border-box;
      padding: 0 0.75em 0 0.5em;
      color: #8f9faa !important;
      background-color: #fff;
      border-right: 1px solid #edf2f7;
      text-align: right;
      text-decoration: none !important;
      user-select: none;
    }

    .github-file-embed-row:hover .github-file-embed-line-number {
      color: #65717b !important;
      background-color: #f6f8fa;
    }

    .github-file-embed-code {
      display: block;
      box-sizing: border-box;
      min-height: 1.65em;
      padding: 0 0.95em;
      color: #24292f;
      background-color: transparent;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace,
        'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
      font-size: 0.92em;
      white-space: pre;
      tab-size: 4;
    }

    .github-file-embed-code.is-markdown-heading {
      color: #0550ae;
      font-weight: 600;
    }

    .github-file-embed-footer,
    .github-file-embed-error {
      padding: 0.45rem 1rem;
      color: var(--github-embed-muted);
      background-color: var(--github-embed-header-bg);
      border-top: 1px solid var(--github-embed-border);
      font-size: 0.85em;
    }

    .github-file-embed-error {
      color: #9a6700;
      background-color: #fff8c5;
    }

    /*
     * 埋め込み本体は Cosense が頻繁に再描画する .text の外側へ置く。
     * これにより、URL 行の再描画でカードが消える現象を避ける。
     */
    .github-file-embed-host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    .line.github-file-embed-line:not(.cursor-line) .github-file-embed-source-link {
      display: none !important;
    }

    .line.github-file-embed-line.cursor-line > .github-file-embed-host {
      display: none !important;
    }

    .github-file-embed-loading {
      padding: 0.65rem 1rem;
      color: var(--github-embed-muted);
      background-color: var(--github-embed-header-bg);
    }

    @media screen and (max-width: 767px) {
      .github-file-embed-header { padding: 0.6rem 0.75rem; }
      .github-file-embed-logo { width: 24px; height: 24px; }
      .github-file-embed-row { grid-template-columns: 3.5em minmax(max-content, 1fr); }
      .github-file-embed-code { font-size: 0.86em; }
    }
  `);

  const fileCache = new Map();
  const resolvedTextCache = new Map();

  /*
   * URL が一時的に見つからなくなった行ごとの削除タイマー。
   * WeakMap を使い、行要素が破棄された後に不要な参照を保持しない。
   */
  const missingCleanupTimers = new WeakMap();

  /*
   * Cosense の編集用 #text-input で監視するイベント。
   * DOM の再描画を待たず、編集中の埋め込みを取り除く。
   */
  const EDITOR_INPUT_EVENTS = ["beforeinput", "input", "compositionend"];

  let observer = null;
  let renderTimer = null;

  const normalizeText = (text) =>
    String(text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const safeDecode = (text) => {
    try {
      return decodeURIComponent(text);
    } catch (_) {
      return text;
    }
  };

  const parseLineRange = (hash) => {
    if (!hash) return null;
    const match = hash.match(/^#L(\d+)(?:-L(\d+))?$/i);
    if (!match) return false;

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      return false;
    if (start < 1 || end < start) return false;
    return { start, end };
  };

  const knownBinaryExtension = (path) =>
    /\.(?:7z|avi|bmp|bz2|class|dmg|docx?|eot|exe|flac|gif|gz|ico|jar|jpe?g|m4a|mkv|mov|mp3|mp4|otf|pdf|png|pptx?|rar|so|tar|tiff?|ttf|wav|webm|webp|woff2?|xlsx?|xz|zip)$/i.test(
      path,
    );

  const parseGithubFileUrl = (input) => {
    let url;
    try {
      url = new URL(input);
    } catch (_) {
      return null;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const range = parseLineRange(url.hash);
    if (range === false) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    let owner;
    let repo;
    let ref;
    let pathParts;
    let fetchUrl;
    let githubFileUrl;

    if (host === "github.com") {
      if (parts.length < 5) return null;
      if (parts[2] !== "blob" && parts[2] !== "raw") return null;

      [owner, repo] = parts;
      ref = parts[3];
      pathParts = parts.slice(4);

      const tail = parts.slice(3).join("/");
      fetchUrl = `https://github.com/${owner}/${repo}/raw/${tail}`;
      githubFileUrl = `https://github.com/${owner}/${repo}/blob/${tail}`;
    } else if (host === "raw.githubusercontent.com") {
      if (parts.length < 4) return null;

      [owner, repo, ref] = parts;
      pathParts = parts.slice(3);
      fetchUrl = url.toString().replace(url.hash, "");
      githubFileUrl = `https://github.com/${owner}/${repo}/blob/${parts.slice(2).join("/")}`;
    } else {
      return null;
    }

    const path = pathParts.map(safeDecode).join("/");
    if (!owner || !repo || !ref || !path || knownBinaryExtension(path))
      return null;

    const displayRef = safeDecode(ref);
    return {
      originalUrl: url.toString(),
      fetchUrl,
      githubFileUrl,
      owner: safeDecode(owner),
      repo: safeDecode(repo),
      path,
      displayRef: /^[0-9a-f]{40}$/i.test(displayRef)
        ? displayRef.slice(0, 7)
        : displayRef,
      range,
    };
  };

  const parseHeaders = (rawHeaders) => {
    const headers = new Map();
    String(rawHeaders || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const index = line.indexOf(":");
        if (index <= 0) return;
        headers.set(
          line.slice(0, index).trim().toLowerCase(),
          line.slice(index + 1).trim(),
        );
      });
    return headers;
  };

  const looksBinary = (bytes) => {
    const sampleLength = Math.min(bytes.length, 8192);
    let controlCount = 0;
    for (let i = 0; i < sampleLength; i += 1) {
      const byte = bytes[i];
      if (byte === 0) return true;
      if (byte < 7 || (byte > 13 && byte < 32)) controlCount += 1;
    }
    return sampleLength > 0 && controlCount / sampleLength > 0.03;
  };

  const requestArrayBuffer = (url) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: REQUEST_TIMEOUT_MS,
        anonymous: true,
        headers: {
          Accept: "text/plain, text/*;q=0.9, */*;q=0.1",
        },
        onload: (response) => resolve(response),
        onerror: () => reject(new Error("GitHub request failed")),
        ontimeout: () => reject(new Error("GitHub request timed out")),
        onabort: () => reject(new Error("GitHub request was aborted")),
      });
    });

  const fetchTextFile = (source) => {
    if (fileCache.has(source.fetchUrl)) return fileCache.get(source.fetchUrl);

    const promise = (async () => {
      const response = await requestArrayBuffer(source.fetchUrl);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`GitHub returned HTTP ${response.status}`);
      }

      const headers = parseHeaders(response.responseHeaders);
      const contentType = (headers.get("content-type") || "").toLowerCase();
      const contentLength = Number(headers.get("content-length") || 0);

      if (/^(?:image|audio|video|font)\//.test(contentType)) {
        throw new Error("The linked file is not a text file");
      }
      if (
        /application\/(?:pdf|zip|gzip|x-rar|x-7z-compressed)/.test(contentType)
      ) {
        throw new Error("The linked file is not a text file");
      }
      if (/text\/html/.test(contentType)) {
        throw new Error("GitHub did not return a raw text file");
      }
      if (contentLength > MAX_FILE_BYTES) {
        throw new Error("The linked file is too large to embed");
      }

      const buffer = response.response;
      if (!buffer || typeof buffer.byteLength !== "number") {
        throw new Error("GitHub returned an unexpected response");
      }
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new Error("The linked file is too large to embed");
      }

      const bytes = new Uint8Array(buffer);
      if (looksBinary(bytes)) {
        throw new Error("The linked file appears to be binary");
      }

      let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const replacementCount = (text.match(/\uFFFD/g) || []).length;
      if (replacementCount > Math.max(4, text.length * 0.005)) {
        throw new Error("The linked file is not valid UTF-8 text");
      }

      const normalizedText = text
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n");
      resolvedTextCache.set(source.fetchUrl, normalizedText);
      return normalizedText;
    })();

    fileCache.set(source.fetchUrl, promise);
    promise.catch(() => fileCache.delete(source.fetchUrl));
    return promise;
  };

  const createGithubLogo = () => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    const path = document.createElementNS(namespace, "path");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("github-file-embed-logo");
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
      "d",
      "M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.63 5.47 7.7.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.51-2.01.37-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.22 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.01 0-.89.31-1.62.82-2.19-.08-.21-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.53 7.53 0 0 1 8 3.96c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.95.08 2.16.51.57.82 1.3.82 2.19 0 3.11-1.87 3.8-3.65 4.01.29.25.54.74.54 1.51 0 1.09-.01 1.97-.01 2.24 0 .22.15.47.55.39A8.04 8.04 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z",
    );
    svg.appendChild(path);
    return svg;
  };

  const makeExternalLink = (href, className) => {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = className;
    return link;
  };

  const buildEmbed = (source, text) => {
    let lines = text === "" ? [] : text.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    const totalLines = lines.length;
    const requestedStart = source.range ? source.range.start : 1;
    const requestedEnd = source.range ? source.range.end : totalLines;
    if (totalLines > 0 && requestedStart > totalLines) {
      throw new Error("The requested start line is outside the file");
    }

    const actualStart = totalLines === 0 ? 0 : requestedStart;
    const actualEnd = totalLines === 0 ? 0 : Math.min(requestedEnd, totalLines);
    const renderEnd =
      actualStart === 0
        ? 0
        : Math.min(actualEnd, actualStart + MAX_RENDER_LINES - 1);
    const truncated = renderEnd < actualEnd;

    const card = document.createElement("section");
    card.className = "github-file-embed";
    card.dataset.sourceUrl = source.originalUrl;

    const header = document.createElement("div");
    header.className = "github-file-embed-header";
    header.appendChild(createGithubLogo());

    const meta = document.createElement("div");
    meta.className = "github-file-embed-meta";
    const title = makeExternalLink(
      source.originalUrl,
      "github-file-embed-title",
    );
    title.textContent = `${source.owner}/${source.repo}/${source.path}`;

    const subtitle = document.createElement("div");
    subtitle.className = "github-file-embed-subtitle";
    if (source.range && source.range.start === source.range.end) {
      subtitle.textContent = `Line ${actualStart} in ${source.displayRef}`;
    } else if (source.range) {
      subtitle.textContent = `Lines ${actualStart} to ${actualEnd} in ${source.displayRef}`;
    } else if (truncated) {
      subtitle.textContent = `First ${renderEnd} of ${totalLines} lines in ${source.displayRef}`;
    } else {
      subtitle.textContent = `${totalLines} ${totalLines === 1 ? "line" : "lines"} in ${source.displayRef}`;
    }

    meta.append(title, subtitle);
    header.appendChild(meta);
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "github-file-embed-body";
    const isMarkdown = /\.(?:md|markdown|mdx)$/i.test(source.path);
    const lineLinkBase = isMarkdown
      ? `${source.githubFileUrl}?plain=1`
      : source.githubFileUrl;

    if (actualStart === 0) {
      const empty = document.createElement("div");
      empty.className = "github-file-embed-footer";
      empty.textContent = "This file is empty.";
      body.appendChild(empty);
    } else {
      for (
        let lineNumber = actualStart;
        lineNumber <= renderEnd;
        lineNumber += 1
      ) {
        const row = document.createElement("div");
        row.className = "github-file-embed-row";

        const numberLink = makeExternalLink(
          `${lineLinkBase}#L${lineNumber}`,
          "github-file-embed-line-number",
        );
        numberLink.textContent = String(lineNumber);

        const code = document.createElement("span");
        code.className = "github-file-embed-code";
        code.textContent = lines[lineNumber - 1] || "";
        if (isMarkdown && /^\s*#{1,6}\s/.test(code.textContent)) {
          code.classList.add("is-markdown-heading");
        }

        row.append(numberLink, code);
        body.appendChild(row);
      }
    }

    card.appendChild(body);
    if (truncated) {
      const footer = document.createElement("div");
      footer.className = "github-file-embed-footer";
      footer.textContent = `Only the first ${MAX_RENDER_LINES} selected lines are shown. Open GitHub to view the rest.`;
      card.appendChild(footer);
    }
    return card;
  };

  const buildError = (message) => {
    const card = document.createElement("section");
    card.className = "github-file-embed github-file-embed-error";
    card.textContent = `GitHub embed: ${message}`;
    return card;
  };

  const buildLoading = () => {
    const card = document.createElement("section");
    card.className = "github-file-embed github-file-embed-loading";
    card.textContent = "Loading GitHub file...";
    return card;
  };

  const getDirectEmbedHost = (line) =>
    Array.from(line.children).find((element) =>
      element.classList.contains("github-file-embed-host"),
    ) || null;

  const ensureEmbedHost = (line) => {
    const existing = getDirectEmbedHost(line);
    if (existing) return existing;

    const host = document.createElement("div");
    host.className = "github-file-embed-host";

    /*
     * .text の内側は Cosense の再描画対象なので、そこへカードを入れない。
     * .text の直後、かつ .line の直下へホストを置く。
     */
    const directText = Array.from(line.children).find((element) =>
      element.classList.contains("text"),
    );

    if (directText) {
      directText.insertAdjacentElement("afterend", host);
    } else {
      line.appendChild(host);
    }

    return host;
  };

  const setEmbedCard = (line, card) => {
    const host = ensureEmbedHost(line);
    host.replaceChildren(card);
  };

  const cleanupLine = (line) => {
    const timerId = missingCleanupTimers.get(line);

    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      missingCleanupTimers.delete(line);
    }

    line.classList.remove("github-file-embed-line");
    delete line.dataset.githubFileEmbedUrl;
    delete line.dataset.githubFileEmbedState;
    delete line.dataset.githubFileEmbedToken;
    delete line.dataset.githubFileEmbedMissingSince;

    getDirectEmbedHost(line)?.remove();

    line
      .querySelectorAll(".github-file-embed-source-link")
      .forEach((element) =>
        element.classList.remove("github-file-embed-source-link"),
      );
  };

  const findStandaloneGithubLink = (line) => {
    const candidates = [];
    line.querySelectorAll("a[href]").forEach((anchor) => {
      if (anchor.closest(".github-file-embed-host")) return;

      const parsed =
        parseGithubFileUrl(anchor.href) ||
        parseGithubFileUrl(normalizeText(anchor.textContent));
      if (parsed) candidates.push({ anchor, parsed });
    });
    if (candidates.length !== 1) return null;

    const [{ anchor, parsed }] = candidates;
    const clone = line.cloneNode(true);
    clone
      .querySelectorAll(
        [
          ".github-file-embed-host",
          ".github-file-embed",
          ".indent-mark",
          ".cursor",
          ".line-number",
          ".line-gutter",
          ".button",
          ".user-icon",
          ".timestamp",
          "textarea",
          "input",
        ].join(","),
      )
      .forEach((element) => element.remove());

    const lineText = normalizeText(clone.textContent);
    const anchorText = normalizeText(anchor.textContent);
    const hrefText = normalizeText(anchor.getAttribute("href"));
    if (lineText !== anchorText && lineText !== hrefText) return null;
    return { anchor, parsed };
  };

  /*
   * URL が再び見つかった場合は、予約していたカード削除を取り消す。
   */
  const cancelMissingCleanup = (line) => {
    const timerId = missingCleanupTimers.get(line);

    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      missingCleanupTimers.delete(line);
    }

    delete line.dataset.githubFileEmbedMissingSince;
  };

  /*
   * URL が消えた行について、猶予時間後にもう一度確認する。
   *
   * Cosense の一時的な DOM 再描画で URL が見えなくなっただけなら、
   * URL が復活しているためカードを維持する。
   *
   * URL が本当に削除された場合は、追加の DOM 変更がなくても
   * このタイマーによってカードを削除する。
   */
  const scheduleMissingCleanup = (line) => {
    if (missingCleanupTimers.has(line)) {
      return;
    }

    line.dataset.githubFileEmbedMissingSince = String(Date.now());

    const timerId = window.setTimeout(() => {
      missingCleanupTimers.delete(line);

      if (!line.isConnected) {
        return;
      }

      const current = findStandaloneGithubLink(line);

      if (current) {
        delete line.dataset.githubFileEmbedMissingSince;
        return;
      }

      cleanupLine(line);
    }, MISSING_LINK_GRACE_MS);

    missingCleanupTimers.set(line, timerId);
  };

  const isCurrentRequest = (line, source, token) =>
    line.isConnected &&
    line.dataset.githubFileEmbedUrl === source.originalUrl &&
    line.dataset.githubFileEmbedToken === token;

  const finishRender = (line, source, token, text) => {
    if (!isCurrentRequest(line, source, token)) return;

    const current = findStandaloneGithubLink(line);
    if (!current || current.parsed.originalUrl !== source.originalUrl) {
      cleanupLine(line);
      return;
    }

    current.anchor.classList.add("github-file-embed-source-link");
    setEmbedCard(line, buildEmbed(source, text));
    line.classList.add("github-file-embed-line");
    line.dataset.githubFileEmbedState = "ready";
  };

  const failRender = (line, source, token, error) => {
    if (!isCurrentRequest(line, source, token)) return;

    const current = findStandaloneGithubLink(line);
    if (current) {
      current.anchor.classList.add("github-file-embed-source-link");
      setEmbedCard(
        line,
        buildError(error instanceof Error ? error.message : String(error)),
      );
      line.classList.add("github-file-embed-line");
    }

    line.dataset.githubFileEmbedState = "failed";
    console.warn("[Cosense GitHub embed]", source.originalUrl, error);
  };

  const renderLine = (line, found) => {
    const { anchor, parsed: source } = found;
    const existingHost = getDirectEmbedHost(line);
    const existingCard = existingHost?.querySelector(".github-file-embed");
    const sameSource = line.dataset.githubFileEmbedUrl === source.originalUrl;
    const state = line.dataset.githubFileEmbedState;

    if (sameSource && state === "loading" && existingCard) return;
    if (sameSource && (state === "ready" || state === "failed") && existingCard)
      return;

    /*
     * Cosense が .text を再描画してカードだけ消した場合は、ready のままでも
     * ここへ入り、取得済みテキストから同期的にカードを復元する。
     */
    cleanupLine(line);

    const token = `${Date.now()}-${Math.random()}`;
    line.dataset.githubFileEmbedUrl = source.originalUrl;
    line.dataset.githubFileEmbedState = "loading";
    line.dataset.githubFileEmbedToken = token;
    line.classList.add("github-file-embed-line");
    anchor.classList.add("github-file-embed-source-link");

    if (resolvedTextCache.has(source.fetchUrl)) {
      finishRender(line, source, token, resolvedTextCache.get(source.fetchUrl));
      return;
    }

    setEmbedCard(line, buildLoading());

    fetchTextFile(source)
      .then((text) => finishRender(line, source, token, text))
      .catch((error) => failRender(line, source, token, error));
  };

  const renderAll = () => {
    document.querySelectorAll("#editor .line").forEach((line) => {
      /*
       * 編集中の行では埋め込みを作成・保持しない。
       *
       * Cosense はカーソルがある行とない行で DOM の表現を切り替えるため、
       * 編集中の古いリンク DOM を埋め込み判定の情報源として使わない。
       */
      if (line.classList.contains("cursor-line")) {
        cancelMissingCleanup(line);

        if (
          line.classList.contains("github-file-embed-line") ||
          getDirectEmbedHost(line)
        ) {
          cleanupLine(line);
        }

        return;
      }

      const found = findStandaloneGithubLink(line);

      if (!found) {
        if (
          line.classList.contains("github-file-embed-line") ||
          getDirectEmbedHost(line)
        ) {
          scheduleMissingCleanup(line);
        }

        return;
      }

      cancelMissingCleanup(line);
      renderLine(line, found);
    });
  };

  /*
   * Cosense では実際の文字入力が #text-input を経由する。
   *
   * URL 行を編集した時点で埋め込みを取り除き、
   * 古いリンク DOM が残っていてもカードが居残らないようにする。
   */
  const handleEditorInput = (event) => {
    const target = event.target;

    if (!(target instanceof Element) || target.id !== "text-input") {
      return;
    }

    const line = document.querySelector("#editor .line.cursor-line");

    if (!line) {
      return;
    }

    const hasEmbed =
      line.classList.contains("github-file-embed-line") ||
      Boolean(getDirectEmbedHost(line));

    if (!hasEmbed) {
      return;
    }

    cleanupLine(line);

    /*
     * Cosense 側の入力処理と再描画が終わった後に再走査する。
     * URL が有効なままでも、編集中は renderAll 側で再生成しない。
     */
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scheduleRender();
      });
    });
  };

  const scheduleRender = () => {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderAll, RENDER_DELAY_MS);
  };

  const mutationIsInsideEmbed = (mutation) => {
    const element =
      mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target.parentElement;

    return Boolean(element?.closest?.(".github-file-embed-host"));
  };

  EDITOR_INPUT_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, handleEditorInput, true);
  });

  observer = new MutationObserver((mutations) => {
    /* 自分で追加したカード内の変更では再描画を予約しない。 */
    if (mutations.every(mutationIsInsideEmbed)) return;
    scheduleRender();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,

    /* cursor-line の付与・解除も検出する。 */
    attributes: true,
    attributeFilter: ["class"],
  });

  scheduleRender();
  window.setTimeout(scheduleRender, 500);
  window.setTimeout(scheduleRender, 1500);

  window[CLEANUP_KEY] = () => {
    window.clearTimeout(renderTimer);

    EDITOR_INPUT_EVENTS.forEach((eventName) => {
      document.removeEventListener(eventName, handleEditorInput, true);
    });

    if (observer) {
      observer.disconnect();
    }

    document.querySelectorAll("#editor .line").forEach((line) => {
      if (
        line.classList.contains("github-file-embed-line") ||
        getDirectEmbedHost(line)
      ) {
        cleanupLine(line);
      }
    });

    delete window[CLEANUP_KEY];
  };
})();
