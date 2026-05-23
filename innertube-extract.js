// Runs in the page MAIN world via chrome.scripting.executeScript.
// Uses YouTube InnerTube APIs to fetch captions/transcripts reliably.
(function () {
  const PANEL_IDENTIFIER = 'engagement-panel-searchable-transcript';

  function toPlainText(runs) {
    if (!Array.isArray(runs)) return '';
    return runs.map((r) => r?.text || '').join('').trim();
  }

  function parseTimestampToSeconds(ts) {
    const t = String(ts || '').trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
    const parts = t.split(':').map((p) => p.trim());
    if (parts.length < 2 || parts.length > 3) return null;
    const [hStr, mStr, sStr] = parts.length === 3 ? parts : ['0', parts[0], parts[1]];
    const secParts = sStr.split('.');
    const s = Number(secParts[0]);
    const ms = Number((secParts[1] || '0').padEnd(3, '0').slice(0, 3));
    const h = Number(hStr);
    const m = Number(mStr);
    if (![h, m, s, ms].every((n) => Number.isFinite(n))) return null;
    return h * 3600 + m * 60 + s + ms / 1000;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForYtcfg(maxMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      if (window.ytcfg?.get?.('INNERTUBE_API_KEY') && window.ytcfg?.get?.('INNERTUBE_CONTEXT')) {
        return true;
      }
      await sleep(200);
    }
    return !!(window.ytcfg?.get?.('INNERTUBE_API_KEY') && window.ytcfg?.get?.('INNERTUBE_CONTEXT'));
  }

  function scrapeInnertubeConfigFromScripts() {
    const out = { apiKey: null, context: null, clientName: '1', clientVersion: '2.20240401.00.00' };
    const scripts = Array.from(document.scripts || []);

    for (const script of scripts) {
      const txt = script.textContent || '';
      if (!txt.includes('INNERTUBE_API_KEY') && !txt.includes('INNERTUBE_CONTEXT')) continue;

      const keyMatch = txt.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
      if (keyMatch && !out.apiKey) out.apiKey = keyMatch[1];

      const clientNameMatch = txt.match(/"INNERTUBE_CLIENT_NAME"\s*:\s*(\d+)/);
      if (clientNameMatch) out.clientName = String(clientNameMatch[1]);

      const clientVersionMatch = txt.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
      if (clientVersionMatch) out.clientVersion = clientVersionMatch[1];

      const contextMatch = txt.match(/"INNERTUBE_CONTEXT"\s*:\s*(\{)/);
      if (contextMatch && contextMatch.index != null && !out.context) {
        const jsonStr = extractBalancedJson(txt, contextMatch.index + contextMatch[0].length - 1);
        if (jsonStr) {
          try {
            out.context = JSON.parse(jsonStr);
          } catch {
            // ignore
          }
        }
      }
    }

    return out.apiKey && out.context ? out : null;
  }

  function extractBalancedJson(text, startIndex) {
    if (!text || text[startIndex] !== '{') return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(startIndex, i + 1);
      }
    }

    return null;
  }

  function getInnertubeConfig() {
    const ytcfg = window.ytcfg;
    if (ytcfg?.get) {
      const apiKey = ytcfg.get('INNERTUBE_API_KEY');
      const context = ytcfg.get('INNERTUBE_CONTEXT');
      if (apiKey && context) {
        return {
          apiKey,
          context,
          clientName: String(ytcfg.get('INNERTUBE_CLIENT_NAME') || '1'),
          clientVersion: String(ytcfg.get('INNERTUBE_CLIENT_VERSION') || '2.20240401.00.00'),
        };
      }
    }

    return scrapeInnertubeConfigFromScripts();
  }

  function getCookieValue(name) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function buildAuthorizationHeader() {
    const sapisid =
      getCookieValue('SAPISID') ||
      getCookieValue('__Secure-3PAPISID') ||
      getCookieValue('APISID');
    if (!sapisid || !globalThis.crypto?.subtle) return null;

    const timestamp = Math.floor(Date.now() / 1000);
    const origin = 'https://www.youtube.com';
    const input = `${timestamp} ${sapisid} ${origin}`;
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `SAPISIDHASH ${timestamp}_${hash}`;
  }

  async function innertubePost(endpoint, payload) {
    await waitForYtcfg();
    const config = getInnertubeConfig();
    if (!config?.apiKey || !config?.context) {
      throw new Error('INNERTUBE config not available');
    }

    const headers = {
      'content-type': 'application/json',
      'x-youtube-client-name': config.clientName,
      'x-youtube-client-version': config.clientVersion,
    };

    const auth = await buildAuthorizationHeader();
    if (auth) headers.authorization = auth;

    const ytcfg = window.ytcfg;
    const visitorData = ytcfg?.get?.('VISITOR_DATA');
    if (visitorData) headers['x-goog-visitor-id'] = visitorData;
    headers['x-origin'] = 'https://www.youtube.com';

    const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${encodeURIComponent(config.apiKey)}`;
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: config.context, ...payload }),
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json) {
      const apiMsg = json?.error?.message;
      throw new Error(`${endpoint} failed: ${resp.status}${apiMsg ? ` (${apiMsg})` : ''}`.trim());
    }
    if (json.error) {
      throw new Error(`${endpoint} error: ${json.error.message || 'unknown'}`);
    }
    return json;
  }

  function getVideoId() {
    try {
      return new URLSearchParams(window.location.search).get('v');
    } catch {
      return null;
    }
  }

  function normalizePlayerResponse(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw?.playerResponse || raw;
  }

  function deepFindTranscriptParams(obj, depth = 0, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || depth > 14) return null;
    if (seen.has(obj)) return null;
    seen.add(obj);

    if (obj.getTranscriptEndpoint?.params) return obj.getTranscriptEndpoint.params;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = deepFindTranscriptParams(item, depth + 1, seen);
        if (found) return found;
      }
      return null;
    }

    for (const key of Object.keys(obj)) {
      const found = deepFindTranscriptParams(obj[key], depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function scrapeTranscriptParamsFromScripts() {
    const sources = [document.documentElement?.innerHTML || ''];
    for (const script of Array.from(document.scripts || [])) {
      sources.push(script.textContent || '');
    }

    for (const txt of sources) {
      const match = txt.match(/"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  function extractTranscriptParamsFromPanels(data) {
    const panels = data?.engagementPanels || [];
    for (const panel of panels) {
      const renderer = panel?.engagementPanelSectionListRenderer;
      if (!renderer) continue;

      const panelId = renderer.panelIdentifier || renderer.targetId || '';
      const isTranscriptPanel =
        panelId === PANEL_IDENTIFIER || String(panelId).includes('transcript');
      if (!isTranscriptPanel) continue;

      const endpoint =
        renderer.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint ||
        renderer.header?.engagementPanelTitleHeaderRenderer?.menu?.menuRenderer?.items
          ?.map((item) => item?.menuServiceItemRenderer?.serviceEndpoint?.getTranscriptEndpoint)
          .find(Boolean) ||
        null;

      if (endpoint?.params) return endpoint.params;
    }
    return null;
  }

  async function findTranscriptParams(playerResponse) {
    const candidates = [];

    const push = (value) => {
      if (value && !candidates.includes(value)) candidates.push(value);
    };

    push(scrapeTranscriptParamsFromScripts());
    push(deepFindTranscriptParams(playerResponse));
    push(deepFindTranscriptParams(window.ytInitialPlayerResponse));
    push(extractTranscriptParamsFromPanels(playerResponse));
    push(extractTranscriptParamsFromPanels(window.ytInitialPlayerResponse));
    push(deepFindTranscriptParams(window.ytInitialData));
    push(extractTranscriptParamsFromPanels(window.ytInitialData));

    const videoId = getVideoId();
    if (videoId) {
      try {
        const nextData = await innertubePost('next', {
          videoId,
          racyCheckOk: false,
          contentCheckOk: false,
        });
        push(deepFindTranscriptParams(nextData));
        push(extractTranscriptParamsFromPanels(nextData));
      } catch (e) {
        console.warn('SubtideX: InnerTube next() failed:', e);
      }
    }

    return candidates;
  }

  async function getPlayerResponse() {
    const fromWindow =
      normalizePlayerResponse(window.ytInitialPlayerResponse) ||
      normalizePlayerResponse(window.ytplayer?.config?.args?.player_response) ||
      normalizePlayerResponse(window.ytplayer?.config);

    if (fromWindow?.videoDetails || fromWindow?.captions) {
      return fromWindow;
    }

    const videoId = getVideoId();
    if (!videoId) throw new Error('No video ID on page');
    return innertubePost('player', { videoId, racyCheckOk: false, contentCheckOk: false });
  }

  function normalizeCaptionBody(rawBody) {
    return (rawBody || '').trim().replace(/^\)\]\}'\s*\n?/, '');
  }

  function parseWebVtt(vttText) {
    const lines = (vttText || '').replace(/\r\n/g, '\n').split('\n');
    const subtitles = [];
    let i = 0;

    while (i < lines.length && lines[i].trim() !== '') i++;
    while (i < lines.length && lines[i].trim() === '') i++;

    while (i < lines.length) {
      if (lines[i] && !lines[i].includes('-->') && lines[i + 1]?.includes('-->')) i++;

      const timingLine = (lines[i] || '').trim();
      if (!timingLine.includes('-->')) {
        i++;
        continue;
      }

      const [startRaw, endRawWithSettings] = timingLine.split('-->').map((s) => s.trim());
      const endRaw = (endRawWithSettings || '').split(/\s+/)[0];
      const start = parseTimestampToSeconds(startRaw);
      const end = parseTimestampToSeconds(endRaw);

      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }
      while (i < lines.length && lines[i].trim() === '') i++;

      if (start == null || end == null) continue;
      const text = textLines.join('\n').trim();
      if (!text) continue;
      subtitles.push({ start, duration: Math.max(0, end - start), text });
    }

    return subtitles;
  }

  function parseCaptionBody(body) {
    const normalized = normalizeCaptionBody(body);
    if (!normalized) return null;

    if (normalized.startsWith('WEBVTT')) {
      const vttSubs = parseWebVtt(normalized);
      if (vttSubs.length > 0) return vttSubs;
    }

    try {
      const json = JSON.parse(normalized);
      if (json && Array.isArray(json.events)) {
        const subtitles = json.events
          .filter((event) => event && event.segs && event.tStartMs !== undefined)
          .map((event) => ({
            start: event.tStartMs / 1000,
            duration: (event.dDurationMs || 0) / 1000,
            text: (event.segs || []).map((seg) => seg.utf8 || '').join('').trim(),
          }))
          .filter((subtitle) => subtitle.text);
        if (subtitles.length > 0) return subtitles;
      }
    } catch {
      // Not JSON
    }

    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(normalized, 'text/xml');
      if (xml.getElementsByTagName('parsererror').length > 0) {
        throw new Error('XML parsererror');
      }

      const subtitles = [];
      const textElements = xml.getElementsByTagName('text');
      for (let i = 0; i < textElements.length; i++) {
        const element = textElements[i];
        const start = parseFloat(element.getAttribute('start') || '0');
        const duration = parseFloat(element.getAttribute('dur') || '0');
        const text = (element.textContent || '').trim();
        if (text) subtitles.push({ start, duration, text });
      }

      if (subtitles.length === 0) {
        const pElements = xml.getElementsByTagName('p');
        for (let i = 0; i < pElements.length; i++) {
          const element = pElements[i];
          const tMs = Number(element.getAttribute('t'));
          const dMs = Number(element.getAttribute('d'));
          const start = Number.isFinite(tMs) ? tMs / 1000 : null;
          const duration = Number.isFinite(dMs) ? dMs / 1000 : 0;
          if (start == null) continue;
          const text = (element.textContent || '').trim();
          if (!text) continue;
          subtitles.push({ start, duration, text });
        }
      }

      if (subtitles.length > 0) return subtitles;
    } catch {
      // Not XML
    }

    return null;
  }

  function requiresPoToken(url) {
    return String(url || '').includes('exp=xpe');
  }

  async function fetchCaptionTrackUrl(url) {
    if (requiresPoToken(url)) return null;

    const candidates = [];
    try {
      const urlObj = new URL(url);
      if (!urlObj.searchParams.has('fmt') && !urlObj.searchParams.has('format')) {
        urlObj.searchParams.set('fmt', 'json3');
        candidates.push(urlObj.toString());
        urlObj.searchParams.set('fmt', 'srv3');
        candidates.push(urlObj.toString());
        urlObj.searchParams.set('fmt', 'vtt');
        candidates.push(urlObj.toString());
      } else {
        candidates.push(urlObj.toString());
      }
    } catch {
      candidates.push(url);
    }

    for (const candidate of candidates) {
      try {
        const resp = await fetch(candidate, {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow',
        });
        if (!resp.ok) continue;
        const text = await resp.text();
        if (!text.trim()) continue;
        const subtitles = parseCaptionBody(text);
        if (subtitles?.length) return subtitles;
      } catch {
        // Try next format
      }
    }

    return null;
  }

  async function fetchFromCaptionTracks(playerResponse) {
    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return null;

    const sorted = [...tracks].sort((a, b) => {
      const aAsr = a.kind === 'asr' ? 1 : 0;
      const bAsr = b.kind === 'asr' ? 1 : 0;
      if (aAsr !== bAsr) return aAsr - bAsr;
      const aEn = a.languageCode === 'en' ? 0 : 1;
      const bEn = b.languageCode === 'en' ? 0 : 1;
      return aEn - bEn;
    });

    for (const track of sorted) {
      const baseUrl = track.baseUrl || track.url;
      if (!baseUrl || requiresPoToken(baseUrl)) continue;
      const cleanUrl = baseUrl.replace(/&fmt=srv3\b/, '');
      const subtitles = await fetchCaptionTrackUrl(cleanUrl);
      if (subtitles?.length) return subtitles;
    }

    return null;
  }

  function parseTranscriptSegmentRenderer(renderer) {
    if (!renderer || renderer.transcriptSectionHeaderRenderer) return null;

    const segment = renderer.transcriptSegmentRenderer || renderer;
    if (!segment || segment.transcriptSectionHeaderRenderer) return null;

    let start = null;
    if (Number.isFinite(Number(segment.startMs))) {
      start = Number(segment.startMs) / 1000;
    } else if (Number.isFinite(Number(segment.startTimeMs))) {
      start = Number(segment.startTimeMs) / 1000;
    } else {
      start = parseTimestampToSeconds(segment.startTimeText?.simpleText);
    }

    const text =
      toPlainText(segment.snippet?.runs) ||
      segment.snippet?.simpleText ||
      segment.cue?.simpleText ||
      toPlainText(segment.cue?.runs) ||
      '';

    if (start == null || !text.trim()) return null;
    return { start, text: text.trim() };
  }

  function parseGetTranscriptResponse(json) {
    const actions = json?.actions || [];
    const segments = [];

    for (const action of actions) {
      const transcriptRenderer = action?.updateEngagementPanelAction?.content?.transcriptRenderer;
      if (!transcriptRenderer) continue;

      const segmentLists = [
        transcriptRenderer.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer,
        transcriptRenderer.body?.transcriptSegmentListRenderer,
        transcriptRenderer.content?.transcriptSegmentListRenderer,
      ].filter(Boolean);

      for (const list of segmentLists) {
        const initialSegments = list.initialSegments || list.segments || [];
        for (const item of initialSegments) {
          const parsed = parseTranscriptSegmentRenderer(item);
          if (parsed) segments.push(parsed);
        }
      }

      const cueGroups = transcriptRenderer.body?.transcriptBodyRenderer?.cueGroups || [];
      for (const group of cueGroups) {
        const cueGroup = group?.transcriptCueGroupRenderer;
        if (!cueGroup) continue;
        const start = parseTimestampToSeconds(cueGroup.formattedStartOffset?.simpleText);
        const cues = cueGroup.cues || [];
        const cue = cues[0]?.transcriptCueRenderer?.cue;
        const text =
          cue?.simpleText ||
          toPlainText(cue?.runs) ||
          toPlainText(cues[0]?.transcriptCueRenderer?.cue?.runs) ||
          '';
        if (start != null && text.trim()) {
          segments.push({ start, text: text.trim() });
        }
      }
    }

    return segments;
  }

  function segmentsToSubtitles(segments) {
    const subtitles = [];
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      const next = segments[i + 1];
      subtitles.push({
        start: current.start,
        duration: next ? Math.max(0, next.start - current.start) : 0,
        text: current.text,
      });
    }
    return subtitles;
  }

  async function fetchViaGetTranscript(playerResponse) {
    const videoId = getVideoId();
    const paramsList = await findTranscriptParams(playerResponse);
    if (!paramsList.length) return null;

    let lastError = null;
    for (const params of paramsList) {
      try {
        const payload = { params };
        if (videoId) payload.externalVideoId = videoId;

        const json = await innertubePost('get_transcript', payload);
        const segments = parseGetTranscriptResponse(json);
        if (segments.length) return segmentsToSubtitles(segments);
        lastError = new Error('get_transcript returned no segments');
      } catch (e) {
        lastError = e;
        console.warn('SubtideX: get_transcript attempt failed:', e);
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  function queryShadowAll(root, selector) {
    const out = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      try {
        if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(selector)) out.push(node);
        if (node.shadowRoot) stack.push(node.shadowRoot);
        const children = node.children ? Array.from(node.children) : [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      } catch {
        // ignore
      }
    }
    return out;
  }

  function clickPlayerCaptionsButton() {
    const player = document.getElementById('movie_player');
    if (!player) return false;

    const buttons = queryShadowAll(player, '.ytp-subtitles-button, .ytp-caption-button');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const pressed = btn.getAttribute('aria-pressed');
      if (pressed === 'true') return true;
      btn.click();
      return true;
    }
    return false;
  }

  function setPlayerCaptionTrack(playerResponse) {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.setOption !== 'function') return false;

    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const track = tracks[0];
    if (!track) return false;

    try {
      player.setOption('captions', 'track', {
        languageCode: track.languageCode,
        kind: track.kind || '',
        name: track.name?.simpleText || track.name?.runs?.[0]?.text || '',
      });
      return true;
    } catch (e) {
      console.warn('SubtideX: setOption captions failed:', e);
      return false;
    }
  }

  async function extractFromVideoTextTracks(playerResponse, maxMs = 4000) {
    const video = document.querySelector('video');
    if (!video) return null;

    setPlayerCaptionTrack(playerResponse);
    clickPlayerCaptionsButton();
    await sleep(600);

    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const textTracks = video.textTracks;
      if (textTracks?.length) {
        for (let i = 0; i < textTracks.length; i++) {
          const track = textTracks[i];
          if (track.kind === 'metadata') continue;
          try {
            if (track.mode === 'disabled') track.mode = 'hidden';
          } catch {
            // ignore
          }

          const cues = track.cues;
          if (cues?.length > 0) {
            const subtitles = [];
            for (let j = 0; j < cues.length; j++) {
              const cue = cues[j];
              const text = (cue.text || '').replace(/<[^>]+>/g, '').trim();
              if (!text) continue;
              subtitles.push({
                start: cue.startTime,
                duration: Math.max(0, cue.endTime - cue.startTime),
                text,
              });
            }
            if (subtitles.length > 0) return subtitles;
          }
        }
      }

      clickPlayerCaptionsButton();
      await sleep(300);
    }

    return null;
  }

  async function scrollTranscriptPanelToLoadAll(maxMs = 8000) {
    const containers = deepQueryAll(document, (el) => isTranscriptSegmentsContainer(el));
    if (!containers.length) {
      const fallback = getTranscriptScrollContainer();
      if (fallback) containers.push(fallback);
    }

    const started = Date.now();

    for (const container of containers) {
      if (typeof container.scrollTop !== 'number') continue;

      let lastCount = 0;
      let stablePasses = 0;

      while (Date.now() - started < maxMs) {
        container.scrollTop = container.scrollHeight;
        await sleep(150);

        const count = deepQueryAll(
          container,
          (el) =>
            el.classList?.contains('segment-text') ||
            (el.tagName || '').toLowerCase() === 'ytd-transcript-segment-renderer' ||
            (el.tagName || '').toLowerCase() === 'transcript-segment-view-model'
        ).length;

        if (count > lastCount) {
          lastCount = count;
          stablePasses = 0;
        } else {
          stablePasses++;
          if (stablePasses >= 3 && count > 0) break;
        }
      }
    }
  }

  function createTranscriptNetworkCapture() {
    let captured = null;
    const handlers = [];

    function tryCaptureJson(json) {
      if (captured) return;
      const segments = parseGetTranscriptResponse(json);
      if (segments.length) {
        captured = segmentsToSubtitles(segments);
      }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('/youtubei/v1/get_transcript')) {
          response
            .clone()
            .json()
            .then(tryCaptureJson)
            .catch(() => {});
        }
      } catch {
        // ignore
      }
      return response;
    };
    handlers.push(() => {
      window.fetch = originalFetch;
    });

    const xhrProto = XMLHttpRequest.prototype;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;
    xhrProto.open = function (method, url, ...rest) {
      this.__subtidexUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    xhrProto.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = this.__subtidexUrl || '';
          if (url.includes('/youtubei/v1/get_transcript') && this.responseText) {
            tryCaptureJson(JSON.parse(this.responseText));
          }
        } catch {
          // ignore
        }
      });
      return originalSend.apply(this, args);
    };
    handlers.push(() => {
      xhrProto.open = originalOpen;
      xhrProto.send = originalSend;
    });

    return {
      getCaptured: () => captured,
      cleanup: () => {
        for (const fn of handlers) {
          try {
            fn();
          } catch {
            // ignore
          }
        }
      },
    };
  }

  async function openTranscriptPanel() {
    const expand =
      document.querySelector('#expand') ||
      document.querySelector('tp-yt-paper-button#expand') ||
      document.querySelector('[aria-label="Show more"]') ||
      document.querySelector('[aria-label*="Show more"]');
    if (expand) {
      expand.click();
      await sleep(350);
    }

    const descTranscript = document.querySelector('ytd-video-description-transcript-section-renderer');
    if (descTranscript) {
      descTranscript.click();
      await sleep(500);
      return true;
    }

    const direct =
      document.querySelector('button[aria-label="Show transcript"]') ||
      document.querySelector('button[aria-label*="Show transcript"]') ||
      document.querySelector('button[aria-label*="Transcript"]') ||
      document.querySelector('button[aria-label*="bản ghi"]') ||
      document.querySelector('button[aria-label*="phụ đề"]') ||
      document.querySelector('button[aria-label*="字幕"]') ||
      document.querySelector('ytd-video-description-transcript-section-renderer button');

    if (direct) {
      direct.click();
      await sleep(500);
      return true;
    }

    for (const item of document.querySelectorAll('ytd-menu-service-item-renderer')) {
      const html = item.outerHTML || '';
      if (
        html.includes('searchable-transcript') ||
        html.includes('getTranscriptEndpoint') ||
        html.includes('engagement-panel-searchable-transcript')
      ) {
        item.click();
        await sleep(500);
        return true;
      }
    }

    const more =
      document.querySelector('button[aria-label="More actions"]') ||
      document.querySelector('button[aria-label*="More actions"]') ||
      document.querySelector('#button-shape button') ||
      document.querySelector('ytd-menu-renderer button');

    if (more) {
      more.click();
      await sleep(400);
      for (const item of document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item')) {
        const html = item.outerHTML || '';
        const text = (item.textContent || '').toLowerCase();
        if (
          html.includes('searchable-transcript') ||
          html.includes('getTranscriptEndpoint') ||
          text.includes('transcript') ||
          text.includes('transkript') ||
          text.includes('bản ghi') ||
          text.includes('phụ đề') ||
          text.includes('hiển thị') ||
          text.includes('字幕') ||
          text.includes('transcripción')
        ) {
          item.click();
          await sleep(500);
          return true;
        }
      }
    }

    return false;
  }

  async function reopenTranscriptPanel() {
    const closeBtn =
      document.querySelector('[target-id*="transcript"] #visibility-button button') ||
      document.querySelector('ytd-engagement-panel-section-list-renderer #visibility-button button') ||
      document.querySelector('[aria-label="Close transcript"]') ||
      document.querySelector('[aria-label*="Close transcript"]') ||
      document.querySelector('[aria-label*="Đóng"]');

    if (closeBtn) {
      closeBtn.click();
      await sleep(450);
    }

    return openTranscriptPanel();
  }

  async function captureTranscriptViaPanel() {
    let subs = bruteForceScrapeTranscript();
    if (subs?.length) {
      await scrollTranscriptPanelToLoadAll(8000);
      subs =
        scrapeTranscriptFromSegmentsContainer() ||
        scrapeTranscriptFromDom() ||
        bruteForceScrapeTranscript();
      if (subs?.length) return subs;
    }

    subs = scrapeTranscriptFromSegmentsContainer() || scrapeTranscriptFromDom();
    if (subs?.length) {
      await scrollTranscriptPanelToLoadAll(8000);
      subs = scrapeTranscriptFromSegmentsContainer() || scrapeTranscriptFromDom() || bruteForceScrapeTranscript();
      if (subs?.length) return subs;
    }

    const capture = createTranscriptNetworkCapture();
    try {
      await reopenTranscriptPanel();

      const started = Date.now();
      while (Date.now() - started < 15000) {
        const fromNetwork = capture.getCaptured();
        if (fromNetwork?.length) return fromNetwork;

        subs =
          scrapeTranscriptFromSegmentsContainer() ||
          scrapeTranscriptFromDom() ||
          bruteForceScrapeTranscript();
        if (subs?.length) {
          await scrollTranscriptPanelToLoadAll(8000);
          subs =
            scrapeTranscriptFromSegmentsContainer() ||
            scrapeTranscriptFromDom() ||
            bruteForceScrapeTranscript();
          if (subs?.length) return subs;
        }

        await sleep(200);
      }

      return (
        capture.getCaptured() ||
        scrapeTranscriptFromSegmentsContainer() ||
        scrapeTranscriptFromDom() ||
        bruteForceScrapeTranscript()
      );
    } finally {
      capture.cleanup();
    }
  }

  function* deepElementIterator(root) {
    const stack = [root || document.documentElement];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        if (node.shadowRoot) stack.push(node.shadowRoot);
        const children = node.children ? Array.from(node.children) : [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
      if (node.nodeType === Node.ELEMENT_NODE) yield node;
    }
  }

  function deepQueryAll(root, predicate) {
    const out = [];
    for (const el of deepElementIterator(root || document)) {
      try {
        if (predicate(el)) out.push(el);
      } catch {
        // ignore
      }
    }
    return out;
  }

  function findTranscriptPanelRoot() {
    const selectors = [
      'ytd-transcript-search-panel-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      '#engagement-panel-searchable-transcript',
      'ytd-transcript-renderer',
      '#panels ytd-engagement-panel-section-list-renderer',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    const byTargetId = deepQueryAll(document, (el) => {
      const tid = (el.getAttribute?.('target-id') || '').toLowerCase();
      return tid.includes('transcript');
    });
    if (byTargetId.length) return byTargetId[0];
    return document.querySelector('#panels') || null;
  }

  function collectTranscriptPanelCandidates() {
    const candidates = new Set();
    const add = (el) => {
      if (el && el.nodeType === Node.ELEMENT_NODE) candidates.add(el);
    };
    add(findTranscriptPanelRoot());
    add(document.querySelector('#panels'));
    deepQueryAll(document, (el) => (el.getAttribute?.('target-id') || '').toLowerCase().includes('transcript')).forEach(add);
    deepQueryAll(document, (el) => (el.tagName || '').toLowerCase().includes('transcript')).forEach(add);
    return Array.from(candidates);
  }

  function parseTranscriptPlainText(text) {
    if (!text) return [];
    const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    const segments = [];
    const TIME_ONLY = /^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/;
    const INLINE = /^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(transcript|bản ghi|phụ đề|字幕|show transcript|hiển thị)/i.test(line)) continue;
      const inline = line.match(INLINE);
      if (inline) {
        const start = parseTimestampToSeconds(inline[1]);
        if (start != null && inline[2].trim()) segments.push({ start, text: inline[2].trim() });
        continue;
      }
      if (TIME_ONLY.test(line) && lines[i + 1] && !TIME_ONLY.test(lines[i + 1])) {
        const start = parseTimestampToSeconds(line);
        if (start != null) segments.push({ start, text: lines[i + 1] });
        i++;
      }
    }
    return segments;
  }

  function scoreTranscriptPlainText(text) {
    const lines = (text || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return 0;
    let timestampLines = 0;
    for (const line of lines) {
      if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(\s|$)/.test(line)) timestampLines++;
    }
    return timestampLines;
  }

  function bruteForceScrapeTranscript() {
    let bestSegments = [];
    for (const root of collectTranscriptPanelCandidates()) {
      const text = root.innerText || root.textContent || '';
      if (scoreTranscriptPlainText(text) < 2) continue;
      const parsed = parseTranscriptPlainText(text);
      if (parsed.length > bestSegments.length) bestSegments = parsed;
    }
    return segmentsToSubtitleRows(bestSegments);
  }

  const TRANSCRIPT_TIMESTAMP_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

  function extractTimestampFromSegmentRow(row) {
    if (!row) return null;

    const tsCandidates = [
      row.querySelector?.('.segment-timestamp'),
      row.querySelector?.('[class*="segment-timestamp"]'),
      row.querySelector?.('button'),
    ].filter(Boolean);

    for (const el of tsCandidates) {
      const text = (el.textContent || '').trim();
      if (TRANSCRIPT_TIMESTAMP_RE.test(text)) return text;
    }

    const full = (row.textContent || '').trim();
    const inline = full.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+/);
    return inline?.[1] || null;
  }

  function isTranscriptSegmentsContainer(container) {
    if (!container || container.id !== 'segments-container') return false;
    return Boolean(
      container.closest('ytd-transcript-search-panel-renderer') ||
        container.closest('ytd-transcript-renderer') ||
        container.closest('[target-id*="transcript"]') ||
        container.closest('#panels')
    );
  }

  function scrapeTranscriptFromSegmentsContainer() {
    const containers = deepQueryAll(document, (el) => isTranscriptSegmentsContainer(el));
    let bestSegments = [];

    for (const container of containers) {
      const segments = [];

      for (const child of container.children) {
        const tag = (child.tagName || '').toUpperCase();
        if (tag.includes('TRANSCRIPT-SECTION-HEADER')) continue;

        const textEl =
          child.querySelector?.('.segment-text') ||
          child.querySelector?.('.yt-core-attributed-string') ||
          child.querySelector?.('yt-formatted-string');

        let text = (textEl?.textContent || '').trim();
        if (!text) {
          const raw = (child.textContent || '').trim();
          text = raw.replace(/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*/, '').trim();
        }
        if (!text) continue;

        const ts = extractTimestampFromSegmentRow(child);
        const start = parseTimestampToSeconds(ts);
        if (start != null) segments.push({ start, text });
      }

      if (segments.length > bestSegments.length) bestSegments = segments;
    }

    return segmentsToSubtitleRows(bestSegments);
  }

  function scrapeTranscriptViewModels() {
    const viewModels = deepQueryAll(document, (el) => {
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'transcript-segment-view-model';
    });

    const segments = [];
    for (const vm of viewModels) {
      const text = (
        vm.querySelector?.('.yt-core-attributed-string') ||
        vm.querySelector?.('.segment-text')
      )?.textContent?.trim();
      if (!text) continue;

      const ts = extractTimestampFromSegmentRow(vm);
      const start = parseTimestampToSeconds(ts);
      if (start != null) segments.push({ start, text });
    }

    return segmentsToSubtitleRows(segments);
  }

  function segmentsToSubtitleRows(segments) {
    const deduped = [];
    const seen = new Set();
    for (const s of segments) {
      const key = `${s.start}|${s.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(s);
    }
    deduped.sort((a, b) => a.start - b.start);
    const subtitles = [];
    for (let i = 0; i < deduped.length; i++) {
      const current = deduped[i];
      const next = deduped[i + 1];
      subtitles.push({
        start: current.start,
        duration: next ? Math.max(0, next.start - current.start) : 0,
        text: current.text,
      });
    }
    return subtitles.length > 0 ? subtitles : null;
  }

  function getTranscriptScrollContainer() {
    const root = findTranscriptPanelRoot();
    return (
      root?.querySelector('#segments-container') ||
      root?.querySelector('#body') ||
      document.querySelector('#engagement-panel-searchable-transcript #content') ||
      root
    );
  }

  function scrapeTranscriptFromDom() {
    let subs = scrapeTranscriptFromSegmentsContainer();
    if (subs?.length) return subs;

    subs = scrapeTranscriptViewModels();
    if (subs?.length) return subs;

    const TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;
    const INLINE_TIME = /^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+([\s\S]+)$/;
    const root = findTranscriptPanelRoot() || document;
    const segments = [];

    const segmentTextEls = deepQueryAll(
      root,
      (el) =>
        el.classList?.contains('segment-text') ||
        (typeof el.className === 'string' && el.className.includes('segment-text'))
    );

    for (const textEl of segmentTextEls) {
      const row =
        textEl.closest('ytd-transcript-segment-renderer') ||
        textEl.closest('[role="listitem"]') ||
        textEl.parentElement;
      let text = (textEl.textContent || '').trim();
      let ts = null;
      const tsEl =
        row?.querySelector?.('.segment-timestamp, [class*="timestamp"]') ||
        deepQueryAll(row || document, (el) => TIME_ONLY.test((el.textContent || '').trim()))[0];
      if (tsEl) ts = (tsEl.textContent || '').trim();
      if (!ts) {
        const inline = text.match(INLINE_TIME);
        if (inline) {
          ts = inline[1];
          text = inline[2].trim();
        }
      }
      const start = parseTimestampToSeconds(ts);
      if (start != null && text) segments.push({ start, text });
    }

    if (segments.length === 0) {
      for (const renderer of deepQueryAll(root, (el) => (el.tagName || '').toLowerCase() === 'ytd-transcript-segment-renderer')) {
        let ts = (renderer.querySelector('.segment-timestamp, [class*="timestamp"]')?.textContent || '').trim();
        let text = (renderer.querySelector('.segment-text, [class*="segment-text"]')?.textContent || '').trim();
        const inline = !ts ? text.match(INLINE_TIME) : null;
        if (inline) {
          ts = inline[1];
          text = inline[2].trim();
        }
        const start = parseTimestampToSeconds(ts);
        if (start != null && text) segments.push({ start, text });
      }
    }

    return segmentsToSubtitleRows(segments) || bruteForceScrapeTranscript();
  }

  async function fetchViaDomTranscript() {
    return captureTranscriptViaPanel();
  }

  async function extractSubtitlesViaInnertube() {
    const errors = [];

    let playerResponse;
    try {
      playerResponse = await getPlayerResponse();
    } catch (e) {
      throw new Error(`Could not read YouTube player data: ${e.message}`);
    }

    const playability = playerResponse?.playabilityStatus?.status;
    if (playability && playability !== 'OK') {
      const reason = playerResponse?.playabilityStatus?.reason || playability;
      throw new Error(`Video not playable: ${reason}`);
    }

    const captionTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const hasPoTokenTracks = captionTracks.some((t) => requiresPoToken(t.baseUrl || t.url));

    // Primary: open transcript panel and capture YouTube's own get_transcript response + DOM
    try {
      const fromPanel = await captureTranscriptViaPanel();
      if (fromPanel?.length) {
        return { subtitles: fromPanel, source: 'transcript_panel' };
      }
      errors.push('transcript panel capture empty');
    } catch (e) {
      errors.push(`transcript panel: ${e.message}`);
    }

    // Direct API (works on some videos without bot checks)
    if (!hasPoTokenTracks && (captionTracks.length || scrapeTranscriptParamsFromScripts())) {
      try {
        const fromTranscript = await fetchViaGetTranscript(playerResponse);
        if (fromTranscript?.length) {
          return { subtitles: fromTranscript, source: 'get_transcript' };
        }
        errors.push('get_transcript returned no segments');
      } catch (e) {
        errors.push(`get_transcript: ${e.message}`);
      }
    }

    if (hasPoTokenTracks) {
      try {
        const fromPlayer = await extractFromVideoTextTracks(playerResponse, 4000);
        if (fromPlayer?.length) {
          return { subtitles: fromPlayer, source: 'player_textTracks' };
        }
        errors.push('player textTracks empty');
      } catch (e) {
        errors.push(`player textTracks: ${e.message}`);
      }
    }

    if (!hasPoTokenTracks) {
      try {
        const fromTracks = await fetchFromCaptionTracks(playerResponse);
        if (fromTracks?.length) {
          return { subtitles: fromTracks, source: 'captionTracks' };
        }
        errors.push('captionTracks fetch empty');
      } catch (e) {
        errors.push(`captionTracks: ${e.message}`);
      }
    }

    if (!captionTracks.length && !scrapeTranscriptParamsFromScripts()) {
      throw new Error('This video has no captions or transcript available');
    }

    throw new Error(
      `All extraction methods failed (${errors.join('; ')}). ` +
      'Try: refresh the page, play the video briefly, open ⋯ → Show transcript, then retry.'
    );
  }

  window.__SUBTIDEX_EXTRACT_SUBTITLES__ = extractSubtitlesViaInnertube;
})();
