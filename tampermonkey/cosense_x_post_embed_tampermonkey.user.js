// ==UserScript==
// @name         Cosense Zenn-style X Post Embed (Static)
// @namespace    https://x.com/
// @version      1.1.0
// @description  Render standalone X/Twitter post URLs in Cosense as static Zenn-like cards without iframes.
// @author       Onely7
// @homepageURL  https://github.com/Onely7/cosense-zenn-style
// @downloadURL  https://raw.githubusercontent.com/Onely7/cosense-zenn-style/main/tampermonkey/cosense_x_post_embed_tampermonkey.user.js
// @updateURL    https://raw.githubusercontent.com/Onely7/cosense-zenn-style/main/tampermonkey/cosense_x_post_embed_tampermonkey.user.js
// @match        https://scrapbox.io/*
// @match        https://cosense.io/*
// @match        https://cosen.se/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      cdn.syndication.twimg.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CLEANUP_KEY = "__cosenseStaticXPostEmbedCleanup";
  const API_ORIGIN = "https://cdn.syndication.twimg.com";
  const REQUEST_TIMEOUT_MS = 15000;
  const RENDER_DELAY_MS = 50;
  const MISSING_LINK_GRACE_MS = 800;

  const API_FEATURES = [
    "tfw_timeline_list:",
    "tfw_follower_count_sunset:true",
    "tfw_tweet_edit_backend:on",
    "tfw_refsrc_session:on",
    "tfw_fosnr_soft_interventions_enabled:on",
    "tfw_show_birdwatch_pivots_enabled:on",
    "tfw_show_business_verified_badge:on",
    "tfw_duplicate_scribes_to_settings:on",
    "tfw_use_profile_image_shape_enabled:on",
    "tfw_show_blue_verified_badge:on",
    "tfw_legacy_timeline_sunset:true",
    "tfw_show_gov_verified_badge:on",
    "tfw_show_business_affiliate_badge:on",
    "tfw_tweet_edit_frontend:on",
  ].join(";");

  if (typeof window[CLEANUP_KEY] === "function") {
    window[CLEANUP_KEY]();
  }

  GM_addStyle(`
    /*
     * カードの配色。Cosense のダーク系テーマでは暗い配色にする。
     * Cosense Zenn Style の UserCSS を使っているときは、その配色（--zs-*）に合わせる。
     *
     * カードの幅は、UserCSS で --zs-x-embed-width を指定すると変えられる（初期値 550px。本文の幅より広くはならない）。
     */
    .x-static-embed-host {
      --x-text: #0f1419;
      --x-muted: #65717b;
      --x-border: #d6e3ed;
      --x-link: #0f83fd;
      --x-hover: #1283fd;
      --x-bg: #fff;
      --x-bg-subtle: #fbfcfd;
      --x-fill: #edf2f7;
      --x-panel: #f6f8fa;
      --x-warning-text: #9a6700;
      --x-warning-bg: #fff8c5;
      --x-warning-border: #e6d477;
      display: block;
      box-sizing: border-box;
      width: min(100%, var(--zs-x-embed-width, 550px));
      min-width: 0;
      margin: 0.65em auto 0.9em;
    }

    :root:is([data-project-theme="default-dark"], [data-project-theme="paper-dark-dark"], [data-project-theme="hacker1"], [data-project-theme="hacker2"]) .x-static-embed-host {
      --x-text: var(--zs-text, rgba(255, 255, 255, 0.87));
      --x-muted: var(--zs-text-muted, rgba(255, 255, 255, 0.6));
      --x-border: var(--zs-border, rgba(255, 255, 255, 0.16));
      --x-link: var(--zs-accent, #3ea8ff);
      --x-hover: #6cbcff;
      --x-bg: var(--zs-surface, #22272e);
      --x-bg-subtle: color-mix(in srgb, var(--x-bg), #fff 3%);
      --x-fill: rgba(255, 255, 255, 0.07);
      --x-panel: color-mix(in srgb, var(--x-bg), #fff 5%);
      --x-warning-text: #e3b341;
      --x-warning-bg: rgba(187, 128, 9, 0.15);
      --x-warning-border: rgba(187, 128, 9, 0.4);
    }

    .x-static-card {
      box-sizing: border-box;
      width: 100%;
      overflow: hidden;
      color: var(--x-text);
      background: var(--x-bg);
      border: 1px solid var(--x-border);
      border-radius: 14px;
      font-family:
        -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
        sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
      font-size: 15px;
      line-height: 1.45;
    }

    .x-static-section {
      box-sizing: border-box;
      padding: 16px 18px 14px;
    }

    .x-static-section.is-parent {
      padding-bottom: 13px;
      background: var(--x-bg-subtle);
    }

    .x-static-thread-divider {
      height: 1px;
      margin: 0 18px;
      background: var(--x-border);
    }

    .x-static-reply-context {
      margin: 0 0 10px 46px;
      color: var(--x-muted);
      font-size: 0.86em;
    }

    .x-static-reply-context a {
      color: var(--x-link) !important;
      text-decoration: none !important;
    }

    .x-static-header {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }

    .x-static-avatar {
      display: block;
      width: 40px;
      height: 40px;
      object-fit: cover;
      background: var(--x-fill);
      border-radius: 50%;
    }

    .x-static-author {
      min-width: 0;
    }

    .x-static-author-name-row {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 4px;
    }

    .x-static-author-name {
      min-width: 0;
      overflow: hidden;
      color: var(--x-text) !important;
      font-weight: 700;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-decoration: none !important;
    }

    .x-static-author-name:hover {
      text-decoration: underline !important;
    }

    .x-static-verified {
      display: inline-grid;
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
      place-items: center;
      color: #fff;
      background: #1d9bf0;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
    }

    .x-static-author-handle {
      overflow: hidden;
      color: var(--x-muted);
      font-size: 0.9em;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .x-static-logo {
      align-self: start;
      color: var(--x-text) !important;
      font-size: 23px;
      font-weight: 700;
      line-height: 1;
      text-decoration: none !important;
    }

    .x-static-text {
      margin-top: 12px;
      overflow-wrap: anywhere;
      color: var(--x-text);
      font-size: 1.08em;
      line-height: 1.48;
      white-space: pre-wrap;
    }

    .x-static-text a {
      color: var(--x-link) !important;
      text-decoration: none !important;
    }

    .x-static-text a:hover {
      color: var(--x-hover) !important;
      text-decoration: underline !important;
    }

    .x-static-media {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2px;
      margin-top: 12px;
      overflow: hidden;
      background: var(--x-fill);
      border: 1px solid var(--x-border);
      border-radius: 12px;
    }

    .x-static-media[data-count="1"] {
      grid-template-columns: minmax(0, 1fr);
    }

    .x-static-media-item {
      position: relative;
      display: block;
      min-height: 150px;
      overflow: hidden;
      background: var(--x-fill);
      text-decoration: none !important;
    }

    .x-static-media[data-count="3"] .x-static-media-item:first-child {
      grid-row: span 2;
    }

    .x-static-media-image {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 150px;
      max-height: 440px;
      object-fit: cover;
    }

    .x-static-media[data-count="1"] .x-static-media-image {
      height: auto;
      max-height: 520px;
      object-fit: contain;
      background: #000;
    }

    .x-static-play {
      position: absolute;
      top: 50%;
      left: 50%;
      display: grid;
      width: 58px;
      height: 58px;
      place-items: center;
      color: #fff;
      background: rgba(29, 155, 240, 0.96);
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      font-size: 25px;
      line-height: 1;
      transform: translate(-50%, -50%);
    }

    .x-static-sensitive {
      margin-top: 12px;
      padding: 14px;
      color: var(--x-muted);
      background: var(--x-panel);
      border: 1px solid var(--x-border);
      border-radius: 12px;
      text-align: center;
    }

    .x-static-quote {
      margin-top: 12px;
      overflow: hidden;
      border: 1px solid var(--x-border);
      border-radius: 12px;
    }

    .x-static-quote .x-static-section {
      padding: 12px 14px;
    }

    .x-static-quote .x-static-header {
      grid-template-columns: 30px minmax(0, 1fr) auto;
      gap: 8px;
    }

    .x-static-quote .x-static-avatar {
      width: 30px;
      height: 30px;
    }

    .x-static-quote .x-static-logo {
      font-size: 18px;
    }

    .x-static-quote .x-static-text {
      margin-top: 9px;
      font-size: 0.96em;
    }

    .x-static-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-top: 12px;
      color: var(--x-muted);
      font-size: 0.9em;
    }

    .x-static-meta a {
      color: var(--x-muted) !important;
      text-decoration: none !important;
    }

    .x-static-meta a:hover {
      color: var(--x-link) !important;
      text-decoration: underline !important;
    }

    .x-static-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 11px;
      padding-top: 10px;
      color: var(--x-muted);
      border-top: 1px solid var(--x-border);
      font-size: 0.86em;
    }

    .x-static-stat strong {
      color: var(--x-text);
      font-weight: 650;
    }

    .x-static-open {
      display: block;
      box-sizing: border-box;
      margin-top: 11px;
      padding: 8px 12px;
      color: var(--x-link) !important;
      background: var(--x-bg);
      border: 1px solid var(--x-border);
      border-radius: 999px;
      font-weight: 650;
      text-align: center;
      text-decoration: none !important;
    }

    .x-static-open:hover {
      color: var(--x-hover) !important;
      background: var(--x-panel);
    }

    .x-static-loading,
    .x-static-error {
      box-sizing: border-box;
      width: 100%;
      padding: 0.8rem 1rem;
      color: var(--x-muted);
      background: var(--x-panel);
      border: 1px solid var(--x-border);
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.6;
    }

    .x-static-loading::before {
      display: inline-block;
      width: 1em;
      height: 1em;
      margin-right: 0.55em;
      border: 2px solid var(--x-border);
      border-top-color: var(--x-link);
      border-radius: 50%;
      vertical-align: -0.12em;
      content: "";
      animation: x-static-spin 0.8s linear infinite;
    }

    .x-static-error {
      color: var(--x-warning-text);
      background: var(--x-warning-bg);
      border-color: var(--x-warning-border);
    }

    @keyframes x-static-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .line.x-static-embed-line.x-static-ready:not(.cursor-line)
    .x-static-source-link {
      display: none !important;
    }

    .line.x-static-embed-line.cursor-line > .x-static-embed-host {
      display: none !important;
    }

    @media screen and (max-width: 767px) {
      .x-static-section {
        padding: 14px;
      }

      .x-static-media-item,
      .x-static-media-image {
        min-height: 120px;
      }
    }
  `);

  const requestCache = new Map();
  const resolvedCache = new Map();

  /*
   * URLが一時的に見つからなくなった行ごとの削除タイマー。
   * WeakMapなので、行要素が破棄された後に不要な参照を保持し続けない。
   */
  const missingCleanupTimers = new WeakMap();

  /*
   * Cosenseの編集用 #text-input で監視するイベント。
   * DOMの再描画を待たず、編集中の埋め込みを取り除く。
   */
  const EDITOR_INPUT_EVENTS = ["beforeinput", "input", "compositionend"];

  let observer = null;
  let renderTimer = null;

  const normalizeText = (value) =>
    String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const parsePostUrl = (input) => {
    let url;

    try {
      url = new URL(input);
    } catch (_) {
      return null;
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    if (!["x.com", "twitter.com", "mobile.twitter.com"].includes(hostname)) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);

    let id = null;
    let screenName = "";

    if (parts.length >= 3 && /^(?:status|statuses)$/i.test(parts[1])) {
      screenName = parts[0];
      id = parts[2];
    } else if (
      parts.length >= 3 &&
      parts[0].toLowerCase() === "i" &&
      parts[1].toLowerCase() === "status"
    ) {
      id = parts[2];
    } else if (
      parts.length >= 4 &&
      parts[0].toLowerCase() === "i" &&
      parts[1].toLowerCase() === "web" &&
      parts[2].toLowerCase() === "status"
    ) {
      id = parts[3];
    }

    if (!/^\d+$/.test(id || "") || id.length > 40) {
      return null;
    }

    const conversation =
      url.searchParams.get("conversation") === "none" ? "none" : "all";

    const canonicalUrl = screenName
      ? `https://x.com/${screenName}/status/${id}`
      : `https://x.com/i/status/${id}`;

    return {
      id,
      screenName,
      originalUrl: url.toString(),
      canonicalUrl,
      conversation,
      key: `${id}|${conversation}`,
    };
  };

  const getToken = (id) =>
    ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

  const buildApiUrl = (id) => {
    const url = new URL(`${API_ORIGIN}/tweet-result`);

    url.searchParams.set("id", id);
    url.searchParams.set("lang", "ja");
    url.searchParams.set("features", API_FEATURES);
    url.searchParams.set("token", getToken(id));

    return url.toString();
  };

  const requestJson = (url) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "json",
        timeout: REQUEST_TIMEOUT_MS,
        anonymous: true,
        headers: {
          Accept: "application/json",
        },
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`X returned HTTP ${response.status}`));
            return;
          }

          let data = response.response;

          if (!data && response.responseText) {
            try {
              data = JSON.parse(response.responseText);
            } catch (_) {
              reject(new Error("X returned invalid JSON"));
              return;
            }
          }

          resolve(data);
        },
        onerror: () => reject(new Error("X request failed")),
        ontimeout: () => reject(new Error("X request timed out")),
        onabort: () => reject(new Error("X request was aborted")),
      });
    });

  const fetchTweet = (id) => {
    if (resolvedCache.has(id)) {
      return Promise.resolve(resolvedCache.get(id));
    }

    if (requestCache.has(id)) {
      return requestCache.get(id);
    }

    const promise = requestJson(buildApiUrl(id)).then((data) => {
      if (
        !data ||
        (typeof data === "object" && Object.keys(data).length === 0)
      ) {
        throw new Error("The post does not exist or is unavailable");
      }

      if (data.__typename === "TweetTombstone") {
        throw new Error("The post is private or unavailable");
      }

      if (data.__typename && data.__typename !== "Tweet") {
        throw new Error("X returned an unsupported post response");
      }

      resolvedCache.set(id, data);

      return data;
    });

    requestCache.set(id, promise);

    promise.catch(() => {
      requestCache.delete(id);
    });

    return promise;
  };

  const makeExternalLink = (href, className = "") => {
    const link = document.createElement("a");

    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = className;

    return link;
  };

  const formatCount = (value) => {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return new Intl.NumberFormat("ja-JP", {
      notation: number >= 1000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(number);
  };

  const formatDate = (value) => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const tweetUrl = (tweet) => {
    const screenName = tweet?.user?.screen_name;
    const id = tweet?.id_str;

    if (!id) {
      return "https://x.com/";
    }

    return screenName
      ? `https://x.com/${screenName}/status/${id}`
      : `https://x.com/i/status/${id}`;
  };

  const userUrl = (user) =>
    user?.screen_name ? `https://x.com/${user.screen_name}` : "https://x.com/";

  const isVerified = (user) =>
    Boolean(
      user?.is_blue_verified ||
      user?.verified ||
      user?.verified_type ||
      user?.business_account,
    );

  const createVerifiedBadge = () => {
    const badge = document.createElement("span");

    badge.className = "x-static-verified";
    badge.textContent = "✓";
    badge.title = "Verified account";

    return badge;
  };

  const getAvatarUrl = (user) =>
    user?.profile_image_url_https || user?.profile_image_url || "";

  const HTML_REFERENCES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
  };

  /*
   * X の本文では & < > が文字参照（&amp; など）になっている。
   * また、URL やメンションの位置（indices）と表示範囲（display_text_range）は、
   * 絵文字なども 1 文字と数えた文字数で示される。
   *
   * 文字参照を元の文字に戻した本文を 1 文字ずつの配列（chars）にし、
   * 文字参照のままの本文での位置を、chars での位置へ変換する表（offsets）を作る。
   */
  const decodeTweetText = (text) => {
    const source = Array.from(String(text || ""));
    const chars = [];
    const offsets = new Array(source.length + 1);

    for (let index = 0; index < source.length; ) {
      offsets[index] = chars.length;

      const reference =
        source[index] === "&"
          ? /^&(amp|lt|gt|quot|#39);/.exec(
              source.slice(index, index + 6).join(""),
            )
          : null;

      if (reference) {
        for (let offset = 1; offset < reference[0].length; offset += 1) {
          offsets[index + offset] = chars.length;
        }

        chars.push(HTML_REFERENCES[reference[1]]);
        index += reference[0].length;
      } else {
        chars.push(source[index]);
        index += 1;
      }
    }

    offsets[source.length] = chars.length;

    return { chars, offsets };
  };

  const collectTextEntities = (tweet, hasVisualMedia) => {
    const entities = tweet?.entities || {};
    const items = [];

    /*
     * surface は、本文中でそのエンティティが占める文字列。
     * 位置の数え方（文字参照のままか、元の文字に戻した後か）の判定に使う。
     */
    const push = (entity, type, href, label, surface) => {
      const indices = entity?.indices;

      if (!Array.isArray(indices) || indices.length !== 2) {
        return;
      }

      const start = Number(indices[0]);
      const end = Number(indices[1]);

      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
        return;
      }

      items.push({ start, end, type, href, label, surface });
    };

    (entities.urls || []).forEach((entity) => {
      push(
        entity,
        "link",
        entity.expanded_url || entity.url,
        entity.display_url || entity.expanded_url || entity.url,
        entity.url,
      );
    });

    (entities.user_mentions || []).forEach((entity) => {
      push(
        entity,
        "link",
        `https://x.com/${entity.screen_name}`,
        `@${entity.screen_name}`,
        `@${entity.screen_name}`,
      );
    });

    (entities.hashtags || []).forEach((entity) => {
      push(
        entity,
        "link",
        `https://x.com/hashtag/${encodeURIComponent(entity.text)}`,
        `#${entity.text}`,
        `#${entity.text}`,
      );
    });

    (entities.symbols || []).forEach((entity) => {
      push(
        entity,
        "link",
        `https://x.com/search?q=%24${encodeURIComponent(entity.text)}`,
        `$${entity.text}`,
        `$${entity.text}`,
      );
    });

    (entities.media || []).forEach((entity) => {
      push(
        entity,
        hasVisualMedia ? "remove" : "link",
        entity.expanded_url || entity.url,
        entity.display_url || entity.expanded_url || entity.url,
        entity.url,
      );
    });

    return items;
  };

  const renderTweetText = (tweet) => {
    const container = document.createElement("div");

    container.className = "x-static-text";

    const { chars, offsets } = decodeTweetText(tweet?.text);

    const hasVisualMedia = Boolean(
      (Array.isArray(tweet?.photos) && tweet.photos.length) ||
      (Array.isArray(tweet?.mediaDetails) && tweet.mediaDetails.length) ||
      tweet?.video,
    );

    const entities = collectTextEntities(tweet, hasVisualMedia);

    /*
     * 位置が文字参照のままの本文で数えたものか、元の文字に戻した本文で数えたものかを、
     * エンティティの位置にその文字列があるかどうかで判定する。
     */
    const fromEncoded = (index) => offsets[Math.min(index, offsets.length - 1)];
    const fromDecoded = (index) => Math.min(index, chars.length);

    const countMatches = (toPosition) =>
      entities.filter(
        (entity) =>
          chars
            .slice(toPosition(entity.start), toPosition(entity.end))
            .join("")
            .toLowerCase() === String(entity.surface || "").toLowerCase(),
      ).length;

    const toPosition =
      countMatches(fromEncoded) > countMatches(fromDecoded)
        ? fromEncoded
        : fromDecoded;

    const range = Array.isArray(tweet?.display_text_range)
      ? tweet.display_text_range
      : [0, chars.length];

    const start = toPosition(Math.max(0, Number(range[0]) || 0));

    const end = Math.max(
      start,
      toPosition(Math.max(0, Number(range[1]) || chars.length)),
    );

    const visible = entities
      .map((entity) => ({
        ...entity,
        start: Math.max(toPosition(entity.start), start) - start,
        end: Math.min(toPosition(entity.end), end) - start,
      }))
      .filter((entity) => entity.end > entity.start)
      .sort((a, b) => a.start - b.start || b.end - a.end);

    const visibleChars = chars.slice(start, end);

    let cursor = 0;

    const appendText = (from, to) => {
      if (to > from) {
        container.appendChild(
          document.createTextNode(visibleChars.slice(from, to).join("")),
        );
      }
    };

    visible.forEach((entity) => {
      if (entity.start < cursor) {
        return;
      }

      appendText(cursor, entity.start);

      if (entity.type === "link") {
        const link = makeExternalLink(entity.href);

        link.textContent = entity.label;
        container.appendChild(link);
      }

      cursor = entity.end;
    });

    appendText(cursor, visibleChars.length);

    // 画像の URL を取り除いた後に残る、末尾の空白や改行を消す
    const last = container.lastChild;

    if (last?.nodeType === Node.TEXT_NODE) {
      last.textContent = last.textContent.trimEnd();
    }

    if (tweet?.note_tweet) {
      const suffix = document.createElement("span");

      suffix.appendChild(document.createTextNode("… "));

      const more = makeExternalLink(tweetUrl(tweet));

      more.textContent = "全文をXで読む";
      suffix.appendChild(more);
      container.appendChild(suffix);
    }

    return container;
  };

  const getMediaItems = (tweet) => {
    const items = [];
    const seen = new Set();

    const add = (item) => {
      if (!item.src || seen.has(item.src)) {
        return;
      }

      seen.add(item.src);
      items.push(item);
    };

    (tweet?.photos || []).forEach((photo) => {
      add({
        type: "photo",
        src: photo.url,
        href: photo.expandedUrl || tweetUrl(tweet),
        alt: "",
      });
    });

    (tweet?.mediaDetails || []).forEach((media) => {
      const type = media.type === "photo" ? "photo" : "video";

      const src = media.media_url_https || media.media_url || media.url;

      add({
        type,
        src,
        href: media.expanded_url || media.url || tweetUrl(tweet),
        alt: media.ext_alt_text || "",
      });
    });

    if (tweet?.video) {
      add({
        type: "video",
        src:
          tweet.video.poster ||
          tweet.video.posterUrl ||
          tweet.video.thumbnail_url ||
          tweet.video.thumbnailUrl ||
          "",
        href: tweetUrl(tweet),
        alt: "",
      });
    }

    return items.slice(0, 4);
  };

  const buildMedia = (tweet) => {
    if (tweet?.possibly_sensitive) {
      const sensitive = document.createElement("div");

      sensitive.className = "x-static-sensitive";

      const link = makeExternalLink(tweetUrl(tweet));

      link.textContent = "センシティブな可能性があるメディアをXで表示";

      sensitive.appendChild(link);

      return sensitive;
    }

    const items = getMediaItems(tweet);

    if (!items.length) {
      return null;
    }

    const gallery = document.createElement("div");

    gallery.className = "x-static-media";
    gallery.dataset.count = String(items.length);

    items.forEach((item) => {
      const link = makeExternalLink(item.href, "x-static-media-item");

      const image = document.createElement("img");

      image.className = "x-static-media-image";
      image.src = item.src;
      image.alt = item.alt;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";

      image.addEventListener(
        "error",
        () => {
          link.remove();

          if (!gallery.children.length) {
            gallery.remove();
          }
        },
        { once: true },
      );

      link.appendChild(image);

      if (item.type === "video") {
        const play = document.createElement("span");

        play.className = "x-static-play";
        play.textContent = "▶";
        play.setAttribute("aria-label", "Open video on X");

        link.appendChild(play);
      }

      gallery.appendChild(link);
    });

    return gallery;
  };

  const buildHeader = (tweet) => {
    const header = document.createElement("div");

    header.className = "x-static-header";

    const profile = makeExternalLink(userUrl(tweet?.user));

    const avatar = document.createElement("img");

    avatar.className = "x-static-avatar";
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.referrerPolicy = "no-referrer";

    const avatarUrl = getAvatarUrl(tweet?.user);

    if (avatarUrl) {
      avatar.src = avatarUrl;
    }

    profile.appendChild(avatar);
    header.appendChild(profile);

    const author = document.createElement("div");

    author.className = "x-static-author";

    const nameRow = document.createElement("div");

    nameRow.className = "x-static-author-name-row";

    const name = makeExternalLink(userUrl(tweet?.user), "x-static-author-name");

    name.textContent =
      tweet?.user?.name || tweet?.user?.screen_name || "X user";

    nameRow.appendChild(name);

    if (isVerified(tweet?.user)) {
      nameRow.appendChild(createVerifiedBadge());
    }

    const handle = document.createElement("div");

    handle.className = "x-static-author-handle";
    handle.textContent = tweet?.user?.screen_name
      ? `@${tweet.user.screen_name}`
      : "";

    author.append(nameRow, handle);
    header.appendChild(author);

    const logo = makeExternalLink(tweetUrl(tweet), "x-static-logo");

    logo.textContent = "𝕏";
    logo.setAttribute("aria-label", "Open on X");

    header.appendChild(logo);

    return header;
  };

  const buildStats = (tweet) => {
    const values = [
      ["返信", tweet?.reply_count ?? tweet?.conversation_count],
      ["リポスト", tweet?.retweet_count],
      ["いいね", tweet?.favorite_count],
    ].filter(([, value]) => Number.isFinite(Number(value)));

    if (!values.length) {
      return null;
    }

    const stats = document.createElement("div");

    stats.className = "x-static-stats";

    values.forEach(([label, value]) => {
      const stat = document.createElement("span");

      stat.className = "x-static-stat";

      const strong = document.createElement("strong");

      /*
       * class を付けておくと、Cosense が class のない strong（[[太字]]）に付ける
       * 背景色と余白が当たらない。
       */
      strong.className = "x-static-stat-value";
      strong.textContent = formatCount(value);

      stat.append(strong, document.createTextNode(` ${label}`));

      stats.appendChild(stat);
    });

    return stats;
  };

  const buildTweetSection = (tweet, options = {}) => {
    const section = document.createElement("section");

    section.className = `x-static-section${options.parent ? " is-parent" : ""}`;

    if (options.parent) {
      const context = document.createElement("div");

      context.className = "x-static-reply-context";
      context.textContent = "返信元のポスト";

      section.appendChild(context);
    } else if (tweet?.in_reply_to_screen_name) {
      const context = document.createElement("div");

      context.className = "x-static-reply-context";
      context.appendChild(document.createTextNode("返信先: "));

      const target = makeExternalLink(
        `https://x.com/${tweet.in_reply_to_screen_name}`,
      );

      target.textContent = `@${tweet.in_reply_to_screen_name}`;

      context.appendChild(target);
      section.appendChild(context);
    }

    section.appendChild(buildHeader(tweet));
    section.appendChild(renderTweetText(tweet));

    const media = buildMedia(tweet);

    if (media) {
      section.appendChild(media);
    }

    if (tweet?.quoted_tweet && options.depth !== "quote") {
      const quote = document.createElement("div");

      quote.className = "x-static-quote";

      quote.appendChild(
        buildTweetSection(tweet.quoted_tweet, { depth: "quote" }),
      );

      section.appendChild(quote);
    }

    const meta = document.createElement("div");

    meta.className = "x-static-meta";

    const dateLink = makeExternalLink(tweetUrl(tweet));

    dateLink.textContent = formatDate(tweet?.created_at) || "Xで表示";

    meta.appendChild(dateLink);

    if (tweet?.isEdited) {
      meta.appendChild(document.createTextNode("· 編集済み"));
    }

    section.appendChild(meta);

    if (!options.parent && options.depth !== "quote") {
      const stats = buildStats(tweet);

      if (stats) {
        section.appendChild(stats);
      }

      const open = makeExternalLink(tweetUrl(tweet), "x-static-open");

      open.textContent = "Xでポストを開く";

      section.appendChild(open);
    }

    return section;
  };

  const buildCard = (source, tweet) => {
    const card = document.createElement("article");

    card.className = "x-static-card";

    if (source.conversation !== "none" && tweet?.parent) {
      card.appendChild(buildTweetSection(tweet.parent, { parent: true }));

      const divider = document.createElement("div");

      divider.className = "x-static-thread-divider";

      card.appendChild(divider);
    }

    card.appendChild(buildTweetSection(tweet));

    return card;
  };

  /*
   * 返信のデータに含まれる返信元のポストは簡略版で、長文（note_tweet）かどうかが分からない。
   * そのため返信元のポストも取得し、取得できたときはそちらを使う。
   */
  const withParent = async (source, tweet) => {
    const parentId = tweet?.parent?.id_str;

    if (source.conversation === "none" || !/^\d+$/.test(parentId || "")) {
      return tweet;
    }

    const parent = await fetchTweet(parentId).catch(() => null);

    return parent ? { ...tweet, parent } : tweet;
  };

  const buildMessage = (className, text) => {
    const element = document.createElement("div");

    element.className = className;
    element.textContent = text;

    return element;
  };

  const getDirectHost = (line) =>
    Array.from(line.children).find((element) =>
      element.classList.contains("x-static-embed-host"),
    ) || null;

  const ensureHost = (line) => {
    const existing = getDirectHost(line);

    if (existing) {
      return existing;
    }

    const host = document.createElement("div");

    host.className = "x-static-embed-host";

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

  const setHostContent = (line, content) => {
    const host = ensureHost(line);

    host.replaceChildren(content);

    return host;
  };

  const cleanupLine = (line) => {
    const timerId = missingCleanupTimers.get(line);

    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      missingCleanupTimers.delete(line);
    }

    line.classList.remove("x-static-embed-line", "x-static-ready");

    delete line.dataset.xStaticEmbedKey;
    delete line.dataset.xStaticEmbedState;
    delete line.dataset.xStaticEmbedToken;
    delete line.dataset.xStaticEmbedMissingSince;

    getDirectHost(line)?.remove();

    line.querySelectorAll(".x-static-source-link").forEach((element) => {
      element.classList.remove("x-static-source-link");
    });
  };

  const findStandalonePostLink = (line) => {
    const candidates = [];

    line.querySelectorAll("a[href]").forEach((anchor) => {
      if (anchor.closest(".x-static-embed-host")) {
        return;
      }

      const parsed =
        parsePostUrl(anchor.href) ||
        parsePostUrl(normalizeText(anchor.textContent));

      if (parsed) {
        candidates.push({ anchor, parsed });
      }
    });

    if (candidates.length !== 1) {
      return null;
    }

    const [{ anchor, parsed }] = candidates;
    const clone = line.cloneNode(true);

    clone
      .querySelectorAll(
        [
          ".x-static-embed-host",
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
      .forEach((element) => {
        element.remove();
      });

    const lineText = normalizeText(clone.textContent);

    const anchorText = normalizeText(anchor.textContent);

    const hrefText = normalizeText(anchor.getAttribute("href"));

    if (lineText !== anchorText && lineText !== hrefText) {
      return null;
    }

    return { anchor, parsed };
  };

  /*
   * URLが再び見つかった場合は、
   * 予約していたカード削除を取り消す。
   */
  const cancelMissingCleanup = (line) => {
    const timerId = missingCleanupTimers.get(line);

    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      missingCleanupTimers.delete(line);
    }

    delete line.dataset.xStaticEmbedMissingSince;
  };

  /*
   * URLが消えた行について、猶予時間後にもう一度確認する。
   *
   * Cosenseの一時的なDOM再描画でURLが見えなくなっただけなら、
   * URLが復活しているためカードを維持する。
   *
   * URLが本当に削除された場合は、追加のDOM変更がなくても
   * このタイマーによってカードを削除する。
   */
  const scheduleMissingCleanup = (line) => {
    if (missingCleanupTimers.has(line)) {
      return;
    }

    line.dataset.xStaticEmbedMissingSince = String(Date.now());

    const timerId = window.setTimeout(() => {
      missingCleanupTimers.delete(line);

      if (!line.isConnected) {
        return;
      }

      const current = findStandalonePostLink(line);

      if (current) {
        delete line.dataset.xStaticEmbedMissingSince;
        return;
      }

      cleanupLine(line);
    }, MISSING_LINK_GRACE_MS);

    missingCleanupTimers.set(line, timerId);
  };

  const isCurrentRequest = (line, source, token) =>
    line.isConnected &&
    line.dataset.xStaticEmbedKey === source.key &&
    line.dataset.xStaticEmbedToken === token;

  const finishRender = (line, source, token, tweet) => {
    if (!isCurrentRequest(line, source, token)) {
      return;
    }

    const current = findStandalonePostLink(line);

    if (!current || current.parsed.key !== source.key) {
      cleanupLine(line);
      return;
    }

    current.anchor.classList.add("x-static-source-link");

    setHostContent(line, buildCard(source, tweet));

    line.classList.add("x-static-embed-line", "x-static-ready");

    line.dataset.xStaticEmbedState = "ready";
  };

  const failRender = (line, source, token, error) => {
    if (!isCurrentRequest(line, source, token)) {
      return;
    }

    setHostContent(
      line,
      buildMessage(
        "x-static-error",
        `X embed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );

    line.classList.add("x-static-embed-line");

    line.classList.remove("x-static-ready");

    line.dataset.xStaticEmbedState = "failed";

    console.warn("[Cosense static X embed]", source.originalUrl, error);
  };

  const renderLine = (line, found) => {
    const { anchor, parsed: source } = found;

    const host = getDirectHost(line);

    const sameSource = line.dataset.xStaticEmbedKey === source.key;

    const state = line.dataset.xStaticEmbedState;

    if (
      sameSource &&
      state === "ready" &&
      host?.querySelector(".x-static-card")
    ) {
      return;
    }

    if (sameSource && state === "loading" && host) {
      return;
    }

    cleanupLine(line);

    const token = `${Date.now()}-${Math.random()}`;

    line.dataset.xStaticEmbedKey = source.key;

    line.dataset.xStaticEmbedState = "loading";

    line.dataset.xStaticEmbedToken = token;

    line.classList.add("x-static-embed-line");

    anchor.classList.add("x-static-source-link");

    setHostContent(line, buildMessage("x-static-loading", "Loading X post..."));

    fetchTweet(source.id)
      .then((tweet) => withParent(source, tweet))
      .then((tweet) => {
        finishRender(line, source, token, tweet);
      })
      .catch((error) => {
        failRender(line, source, token, error);
      });
  };

  const renderAll = () => {
    document.querySelectorAll("#editor .line").forEach((line) => {
      /*
       * 編集中の行では埋め込みを作成・保持しない。
       *
       * Cosenseはカーソルがある行とない行で
       * DOMの表現を切り替えるため、編集中の古いリンクDOMを
       * 埋め込み判定の情報源として使わない。
       */
      if (line.classList.contains("cursor-line")) {
        cancelMissingCleanup(line);

        if (
          line.classList.contains("x-static-embed-line") ||
          getDirectHost(line)
        ) {
          cleanupLine(line);
        }

        return;
      }

      const found = findStandalonePostLink(line);

      if (!found) {
        if (
          line.classList.contains("x-static-embed-line") ||
          getDirectHost(line)
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
   * Cosenseでは実際の文字入力が #text-input を経由する。
   *
   * URL行を編集した時点で埋め込みを取り除き、
   * 古いリンクDOMが残っていてもカードが居残らないようにする。
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
      line.classList.contains("x-static-embed-line") ||
      Boolean(getDirectHost(line));

    if (!hasEmbed) {
      return;
    }

    cleanupLine(line);

    /*
     * Cosense側の入力処理と再描画が終わった後に再走査する。
     *
     * URLが有効なままでも、編集中はrenderAll側で
     * 埋め込みを再生成しない。
     */
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scheduleRender();
      });
    });
  };

  const scheduleRender = () => {
    window.clearTimeout(renderTimer);

    renderTimer = window.setTimeout(renderAll, RENDER_DELAY_MS);
  };

  const mutationIsInsideEmbed = (mutation) => {
    const element =
      mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target.parentElement;

    return Boolean(element?.closest?.(".x-static-embed-host"));
  };

  EDITOR_INPUT_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, handleEditorInput, true);
  });

  observer = new MutationObserver((mutations) => {
    if (mutations.every(mutationIsInsideEmbed)) {
      return;
    }

    scheduleRender();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,

    /*
     * cursor-lineの付与・解除も検出する。
     * 監視対象をclass属性だけに限定する。
     */
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
        line.classList.contains("x-static-embed-line") ||
        getDirectHost(line)
      ) {
        cleanupLine(line);
      }
    });

    delete window[CLEANUP_KEY];
  };
})();
