// SubtideX - YouTube Subtitles Extractor
// Enhanced content script with improved video detection and error handling

// Global state
let currentVideoId = null;
let extractionInProgress = false;
let debugMode = false;

// DOM elements and UI references
let loadingIndicator = null;
let notificationElement = null;
let loadingStatusTextEl = null;
let loadingMessageTextEl = null;
let loadingStepsEl = null;
let lastExtractionMeta = { count: 0, filename: '' };

function sendMessageAsync(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Initialize once per content-script context (avoids duplicate listeners on re-inject)
if (!globalThis.__SUBTIDEX_CS_READY__) {
  globalThis.__SUBTIDEX_CS_READY__ = true;
  initializeContentScript();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, errorMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function ensureTidalStyles() {
  if (document.getElementById('subtidex-tidal-styles')) return;

  const style = document.createElement('style');
  style.id = 'subtidex-tidal-styles';
  style.textContent = `
    @keyframes subtidex-panel-in {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes subtidex-panel-out {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(8px); }
    }
    @keyframes subtidex-step-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    @media (prefers-reduced-motion: reduce) {
      .subtidex-panel, .subtidex-toast { animation: none !important; }
      .subtidex-step--active .subtidex-step__dot { animation: none !important; }
    }
    .subtidex-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: subtidex-panel-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .subtidex-panel__card {
      width: 320px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      color: #f8fafc;
    }
    .subtidex-panel__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px 10px;
      background: linear-gradient(135deg, rgba(12, 74, 110, 0.55) 0%, rgba(20, 184, 166, 0.15) 100%);
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    }
    .subtidex-panel__logo {
      width: 28px;
      height: 28px;
      border-radius: 8px;
    }
    .subtidex-panel__brand {
      font-size: 0.9375rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .subtidex-panel__detail {
      font-size: 0.75rem;
      color: rgba(248, 250, 252, 0.65);
      padding: 0 16px 10px;
    }
    .subtidex-steps {
      list-style: none;
      padding: 8px 16px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .subtidex-step {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.8125rem;
      color: rgba(248, 250, 252, 0.45);
      transition: color 0.2s;
    }
    .subtidex-step__dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, 0.35);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
    }
    .subtidex-step--done { color: #6ee7b7; }
    .subtidex-step--done .subtidex-step__dot {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
    }
    .subtidex-step--done .subtidex-step__dot::after { content: '✓'; }
    .subtidex-step--active { color: #f8fafc; font-weight: 500; }
    .subtidex-step--active .subtidex-step__dot {
      border-color: #14b8a6;
      box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.25);
      animation: subtidex-step-pulse 1.6s ease-in-out infinite;
    }
    .subtidex-progress {
      height: 3px;
      background: rgba(148, 163, 184, 0.15);
    }
    .subtidex-progress__bar {
      height: 100%;
      width: 33%;
      background: linear-gradient(90deg, #0c4a6e, #14b8a6);
      border-radius: 0 2px 2px 0;
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .subtidex-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      width: 320px;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
      padding: 16px;
      color: #f8fafc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: subtidex-panel-in 0.35s ease-out;
    }
    .subtidex-toast--success { border-color: rgba(16, 185, 129, 0.35); }
    .subtidex-toast--error { border-color: rgba(239, 68, 68, 0.35); }
    .subtidex-toast__title {
      font-size: 0.9375rem;
      font-weight: 700;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .subtidex-toast__title--success { color: #6ee7b7; }
    .subtidex-toast__title--error { color: #fca5a5; }
    .subtidex-toast__sub {
      font-size: 0.8125rem;
      color: rgba(248, 250, 252, 0.65);
      line-height: 1.45;
      margin-bottom: 12px;
    }
    .subtidex-toast__btn {
      width: 100%;
      min-height: 36px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #0c4a6e, #155e75);
      color: #fff;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
    }
    .subtidex-toast__btn:hover { filter: brightness(1.08); }
    .subtidex-toast__close {
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      color: rgba(248, 250, 252, 0.5);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 4px;
    }
  `;
  document.head.appendChild(style);
}

function setExtractionStep(step, detail) {
  if (!loadingIndicator) return;

  const steps = loadingIndicator.querySelectorAll('.subtidex-step');
  steps.forEach((el, index) => {
    const n = index + 1;
    el.classList.remove('subtidex-step--done', 'subtidex-step--active', 'subtidex-step--pending');
    if (n < step) el.classList.add('subtidex-step--done');
    else if (n === step) el.classList.add('subtidex-step--active');
    else el.classList.add('subtidex-step--pending');
  });

  const bar = loadingIndicator.querySelector('.subtidex-progress__bar');
  if (bar) bar.style.width = `${Math.round((step / 3) * 100)}%`;

  const detailEl = loadingIndicator.querySelector('.subtidex-panel__detail');
  if (detailEl && detail) detailEl.textContent = detail;
}

function inferStepFromMessage(messageText) {
  const msg = (messageText || '').toLowerCase();
  if (msg.includes('opening') || msg.includes('transcript panel')) return 1;
  if (msg.includes('reading') || msg.includes('caption') || msg.includes('transcript')) return 2;
  if (msg.includes('convert') || msg.includes('csv') || msg.includes('download') || msg.includes('sending')) return 3;
  return null;
}

function setLoadingTexts({ messageText, step } = {}) {
  if (step) {
    setExtractionStep(step, messageText);
  } else if (messageText) {
    const inferred = inferStepFromMessage(messageText);
    if (inferred) setExtractionStep(inferred, messageText);
    if (loadingMessageTextEl) loadingMessageTextEl.textContent = messageText;
  }
}

function sanitizeFilename(title) {
  return (title || 'youtube_subtitles').replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * Main initialization function for the content script
 */
function initializeContentScript() {
  console.log("SubtideX: Content script initialized on:", window.location.href);
  
  // Check if we're on a YouTube video page
  const isVideoPage = checkIfYouTubeVideoPage();
  
  // Register message listeners
  setupMessageListeners();
  
  // Monitor for YouTube SPA navigation (since YouTube doesn't fully reload the page)
  monitorYouTubeURLChanges();
  
  // Send initial status to background script
  if (isVideoPage) {
    const videoId = extractVideoId(window.location.href);
    currentVideoId = videoId;
    
    console.log("SubtideX: Detected YouTube video page with ID:", videoId);
    
    // Send status to background script
    chrome.runtime.sendMessage({
      action: "pageInfo",
      isVideoPage: true,
      videoId: videoId,
      url: window.location.href
    });
  }
}

/**
 * Set up listeners for messages from background script and popup
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("SubtideX: Content script received message:", message.action);
    
    switch (message.action) {
      case "ping":
        sendResponse({ status: "ok", ready: true });
        break;

      case "startExtraction":
        if (!extractionInProgress) {
          extractionInProgress = true;
          sendResponse({ status: "started" });
          extractAndProcessSubtitles();
        } else {
          sendResponse({ status: "busy" });
        }
        break;
        
      case "pageUpdated":
        handlePageUpdate(message, sendResponse);
        break;
        
      case "enableDebug":
        debugMode = true;
        addDebugButton();
        sendResponse({ status: "debug_enabled" });
        break;
        
      case "retryExtraction":
        if (!extractionInProgress) {
          extractionInProgress = true;
          extractAndProcessSubtitles();
          sendResponse({ status: "restarted" });
        } else {
          sendResponse({ status: "busy" });
        }
        break;

      case "getVideoInfo":
        sendResponse({
          isVideoPage: checkIfYouTubeVideoPage(),
          videoId: extractVideoId(window.location.href),
          title: getVideoTitle(),
          url: window.location.href,
          thumbnail: (() => {
            const id = extractVideoId(window.location.href);
            return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
          })(),
        });
        break;

      case "downloadSuccess":
        showSuccessToast(lastExtractionMeta.count ? lastExtractionMeta : undefined);
        hideLoadingIndicator();
        extractionInProgress = false;
        sendResponse({ status: "ack" });
        break;
    }
    
    // Return true for async response
    return true;
  });
}

/**
 * Handles page update messages from the background script
 */
function handlePageUpdate(message, sendResponse) {
  if (message.isVideoPage && message.videoId) {
    // Update current video ID
    currentVideoId = message.videoId;
    console.log("SubtideX: Page updated to video:", currentVideoId);
    sendResponse({ status: "updated", isVideoPage: true });
  } else {
    // Reset video ID if not on a video page
    currentVideoId = null;
    console.log("SubtideX: Page updated to non-video page");
    sendResponse({ status: "updated", isVideoPage: false });
  }
}

/**
 * Monitors URL changes in YouTube SPA
 */
function monitorYouTubeURLChanges() {
  // YouTube uses History API for navigation
  let lastUrl = window.location.href;
  
  // Function to check for URL changes
  const checkForURLChanges = () => {
    if (window.location.href !== lastUrl) {
      const oldUrl = lastUrl;
      lastUrl = window.location.href;
      
      // Check if the new URL is a video page
      const isVideoPage = checkIfYouTubeVideoPage();
      const newVideoId = isVideoPage ? extractVideoId(window.location.href) : null;
      
      console.log("SubtideX: URL changed from", oldUrl, "to", lastUrl);
      console.log("SubtideX: New page is video?", isVideoPage, "ID:", newVideoId);
      
      // Reset extraction state for new video
      extractionInProgress = false;
      
      // Update global state
      currentVideoId = newVideoId;
      
      // Notify background script about page change
      chrome.runtime.sendMessage({
        action: "pageChanged",
        from: oldUrl,
        to: lastUrl,
        isVideoPage: isVideoPage,
        videoId: newVideoId
      });
    }
  };
  
  // Create a new observer instance to monitor DOM mutations
  const observer = new MutationObserver(checkForURLChanges);
  
  // Start observing document body for DOM changes
  observer.observe(document.body, { subtree: true, childList: true });
  
  // Also check on history changes for SPAs
  window.addEventListener('popstate', checkForURLChanges);
  
  // Check periodically (as a backup)
  setInterval(checkForURLChanges, 1000);
}

async function extractAndProcessSubtitles() {
  // Show loading indicator
  showLoadingIndicator();
  
  try {
    setExtractionStep(1, 'Preparing…');

    // Check if we're on a video page
    if (!checkIfYouTubeVideoPage()) {
      throw new Error("Not on a YouTube video page");
    }
    
    const videoTitle = getVideoTitle();
    const videoId = extractVideoId(window.location.href);
    console.log(`SubtideX: Extracting subtitles for video ${videoId} - "${videoTitle}"`);
    
    setExtractionStep(1, 'Opening transcript panel…');
    const subtitles = await withTimeout(
      getYouTubeSubtitles(),
      45000,
      "Subtitle extraction timed out. Open ⋯ → Show transcript, wait for captions to load, then retry."
    );
    
    if (!subtitles || subtitles.length === 0) {
      throw new Error("No subtitles found for this video");
    }
    
    console.log(`SubtideX: Found ${subtitles.length} subtitle entries`);
    
    lastExtractionMeta = {
      count: subtitles.length,
      filename: `${sanitizeFilename(videoTitle)}.csv`,
    };
    
    setExtractionStep(3, 'Saving CSV to Downloads…');
    const csvData = convertToCSV(subtitles);
    
    chrome.runtime.sendMessage({
      action: "downloadCSV", 
      data: csvData,
      videoTitle: videoTitle
    }, response => {
      if (chrome.runtime.lastError) {
        console.error("SubtideX: Error sending download request:", chrome.runtime.lastError);
        showNotification("Error downloading subtitles. Please try again.", "error");
        extractionInProgress = false;
        return;
      }
      
      if (!response) {
        console.error("SubtideX: No response from background script");
        showNotification("Error: No response from extension. Please reload the page.", "error");
        extractionInProgress = false;
        return;
      }
      
      if (response.status === "error") {
        console.error("SubtideX: Download error:", response.error);
        showNotification(`Error: ${response.error}`, "error");
      } else if (response.status === "success") {
        console.log("SubtideX: Download request sent successfully with ID:", response.downloadId);
        showSuccessToast(lastExtractionMeta);
      } else {
        console.warn("SubtideX: Unknown response status:", response.status);
        showNotification("Captions processed — check your Downloads folder.", "info");
      }
      
      // Reset extraction state
      extractionInProgress = false;
    });
  } catch (error) {
    console.error("SubtideX: Error extracting subtitles:", error);
    showNotification(`Error: ${error.message}`, "error");
    
    // Log detailed error for debugging
    chrome.runtime.sendMessage({
      action: "error",
      error: error.message,
      stack: error.stack,
      context: "subtitle_extraction"
    });
    
    // Reset extraction state
    extractionInProgress = false;
  } finally {
    // Always hide loading indicator
    hideLoadingIndicator();
  }
}

/**
 * Get the title of the current YouTube video
 */
function getVideoTitle() {
  // Try different selectors for YouTube's changing UI
  const title = document.querySelector('h1.ytd-watch-metadata')?.textContent.trim() || 
                document.querySelector('.title')?.textContent.trim() || 
                document.querySelector('h1.title')?.textContent.trim() || 
                `youtube_video_${extractVideoId(window.location.href) || 'unknown'}`;
  
  // Remove any invalid characters for filenames
  return title;
}

/**
 * Check if the current page is a YouTube video page
 */
function checkIfYouTubeVideoPage() {
  const url = window.location.href;
  
  // Must be youtube.com domain
  const isYouTubeDomain = window.location.hostname === 'youtube.com' || 
                         window.location.hostname === 'www.youtube.com' ||
                         window.location.hostname === 'm.youtube.com';
  
  // Must have /watch path
  const isWatchPath = window.location.pathname === '/watch';
  
  // Must have v parameter
  const urlParams = new URLSearchParams(window.location.search);
  const hasVideoParam = urlParams.has('v');
  
  const isVideoPage = isYouTubeDomain && isWatchPath && hasVideoParam;
  console.log("SubtideX: URL check -", url, "is video page?", isVideoPage);
  
  return isVideoPage;
}

/**
 * Extract video ID from URL
 */
function extractVideoId(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get('v');
  } catch (error) {
    console.error("SubtideX: Error extracting video ID:", error);
    return null;
  }
}

/**
 * Extracts subtitles from a YouTube video
 * Uses multiple strategies to handle various YouTube layouts and subtitle formats
 */
function captionUrlRequiresPoToken(url) {
  return String(url || '').includes('exp=xpe');
}

async function getYouTubeSubtitles() {
  console.log("SubtideX: Starting subtitle extraction (transcript panel first)");
  let lastError = null;

  try {
    // Primary: open the right-side transcript panel and scrape visible captions
    setLoadingTexts({ messageText: 'Opening YouTube transcript panel...', step: 1 });
    const panelSubs = await extractFromTranscriptPanel();
    if (panelSubs?.length) {
      if (subtitlesHaveUsableCaptionText(panelSubs)) {
        console.log(
          `SubtideX: Extracted ${panelSubs.length} entries from transcript panel (${countValidCaptionRows(panelSubs)} with caption text)`
        );
        return panelSubs;
      }
      console.warn(
        `SubtideX: Transcript panel returned ${panelSubs.length} rows but only ${countValidCaptionRows(panelSubs)} had caption text — trying API fallback`
      );
      lastError = new Error('Transcript panel scrape returned timestamps without caption text');
    }
  } catch (e) {
    lastError = e;
    console.warn("SubtideX: Transcript panel extraction failed:", e);
  }

  try {
    setLoadingTexts({ messageText: 'Fetching captions via YouTube API...' });
    const res = await withTimeout(
      sendMessageAsync({ action: 'getTranscriptViaMainWorld' }),
      30000,
      'YouTube API caption fetch timed out'
    );
    if (res?.status === 'error') {
      throw new Error(res.error || 'InnerTube extraction failed');
    }
    const apiSubs = res?.result?.subtitles;
    if (Array.isArray(apiSubs) && apiSubs.length > 0 && subtitlesHaveUsableCaptionText(apiSubs)) {
      console.log(
        `SubtideX: Extracted ${apiSubs.length} entries via InnerTube (${res.result?.source || 'unknown'})`
      );
      return apiSubs;
    }
    if (apiSubs?.length) {
      throw new Error('InnerTube extractor returned timestamps without caption text');
    }
    throw new Error('InnerTube extractor returned no subtitles');
  } catch (e) {
    lastError = e;
    console.warn('SubtideX: InnerTube API strategy failed:', e);
  }

  // Fallback: player caption tracks (skip token-gated exp=xpe URLs)
  try {
    setLoadingTexts({ messageText: 'Trying YouTube player caption data...' });
    const ytplayer = await withTimeout(
      getYouTubePlayerData(),
      8000,
      'Timed out reading YouTube player data'
    );
    const captionTracks =
      ytplayer?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const poTokenOnly =
      captionTracks.length > 0 &&
      captionTracks.every((t) => captionUrlRequiresPoToken(t.baseUrl || t.url));

    if (!poTokenOnly && ytplayer?.captions?.playerCaptionsTracklistRenderer) {
      try {
        return await extractFromPlayerData(ytplayer);
      } catch (e) {
        lastError = e;
        console.warn("SubtideX: Player-data captions failed:", e);
      }
    }

    if (!poTokenOnly) {
      const videoTextTracks = await extractFromVideoTextTracks();
      if (videoTextTracks?.length) return videoTextTracks;
    }
  } catch (e) {
    lastError = e;
    console.warn("SubtideX: Fallback caption extraction failed:", e);
  }

  console.log("SubtideX: No subtitles found using any strategy");
  const detail = lastError?.message ? ` ${lastError.message}` : '';
  throw new Error(
    "No subtitles found for this video." + detail +
    " Open ⋯ → Show transcript on the video, wait for lines to appear, then retry."
  );
}

/**
 * Extract a balanced JSON object starting at `{` in a larger string.
 */
function extractBalancedJson(text, startIndex) {
  if (!text || text[startIndex] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
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

/**
 * Gets YouTube player data from window.ytplayer or page source
 */
async function getYouTubePlayerData() {
  return new Promise((resolve) => {
    // First check if ytplayer is directly accessible
    if (window.ytplayer && window.ytplayer.config) {
      return resolve(window.ytplayer.config);
    }
    
    // Check for ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse) {
      return resolve(window.ytInitialPlayerResponse);
    }
    
    // Try to find player data in script tags (avoid scanning full HTML, which can be slow/hang)
    try {
      const scripts = Array.from(document.scripts || []);
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (!txt.includes('ytInitialPlayerResponse')) continue;

        // Common patterns in YouTube watch pages
        const patterns = [
          /ytInitialPlayerResponse\s*=\s*(\{)/,
          /var\s+ytInitialPlayerResponse\s*=\s*(\{)/,
          /window\["ytInitialPlayerResponse"\]\s*=\s*(\{)/,
        ];

        for (const pattern of patterns) {
          const match = txt.match(pattern);
          if (!match || match.index == null) continue;

          const startIndex = match.index + match[0].length - 1;
          const jsonStr = extractBalancedJson(txt, startIndex);
          if (!jsonStr) continue;

          try {
            const ytData = JSON.parse(jsonStr);
            return resolve(ytData);
          } catch (e) {
            console.error("SubtideX: Failed to parse ytInitialPlayerResponse from script", e);
          }
        }
      }
    } catch (e) {
      console.error("SubtideX: Error scanning scripts for ytInitialPlayerResponse", e);
    }
    
    // If we can't find it, resolve with null
    resolve(null);
  });
}

/**
 * Extract subtitles from player data
 */
async function extractFromPlayerData(playerData) {
  try {
    const captions =
      playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
      playerData.captionTracks ||
      [];

    if (!captions.length) {
      throw new Error("No caption tracks found in player data");
    }

    for (const captionTrack of captions) {
      const captionUrl = captionTrack.baseUrl || captionTrack.url;
      if (!captionUrl || captionUrlRequiresPoToken(captionUrl)) continue;
      return await fetchAndParseCaptionTrack(captionUrl);
    }

    throw new Error("Caption tracks require YouTube session token (exp=xpe)");
  } catch (error) {
    console.error("SubtideX: Error extracting from player data:", error);
    throw error;
  }
}

/**
 * Finds caption track URL in page source
 */
async function findCaptionTrackInPage() {
  // Avoid scanning full document HTML (can be huge and slow). Prefer scanning script tags.
  const patterns = [
    /"captionTracks":\[\{"baseUrl":"([^"]+)"/, // Standard format
    /playerCaptionsTracklistRenderer.*?baseUrl":"([^"]+)"/, // Player captions renderer
    /"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/ // timedtext url embedded
  ];

  try {
    const scripts = Array.from(document.scripts || []);
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (!txt.includes('captionTracks') && !txt.includes('/api/timedtext')) continue;
  for (const pattern of patterns) {
        const match = txt.match(pattern);
        if (match && match[1]) {
          const url = match[1].replace(/\\u0026/g, '&');
          if (!captionUrlRequiresPoToken(url)) return url;
        }
      }
    }
  } catch (e) {
    console.warn("SubtideX: Error scanning scripts for caption URLs:", e);
  }
  
  return null;
}

/**
 * Fetch a URL from the page "main world" context (youtube.com first-party),
 * so cookies/consent flows work reliably. Content-script fetches can be treated
 * as cross-site and get HTML responses instead of captions.
 */
function ensureSubtidexPageFetchBridge() {
  if (document.getElementById('subtidex-page-fetch-bridge')) return;

  const script = document.createElement('script');
  script.id = 'subtidex-page-fetch-bridge';
  script.textContent = `
    (() => {
      if (window.__SUBTIDEX_PAGE_FETCH_BRIDGE__) return;
      window.__SUBTIDEX_PAGE_FETCH_BRIDGE__ = true;

      window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'subtidex' || data.type !== 'fetch') return;

        const { id, url, options } = data;
        try {
          const resp = await fetch(url, {
            ...(options || {}),
            credentials: 'include',
            redirect: 'follow'
          });
          const text = await resp.text();
          window.postMessage({
            source: 'subtidex',
            type: 'fetchResult',
            id,
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText,
            url: resp.url,
            contentType: resp.headers.get('content-type') || '',
            body: text
          }, '*');
        } catch (e) {
          window.postMessage({
            source: 'subtidex',
            type: 'fetchResult',
            id,
            ok: false,
            error: (e && (e.message || String(e))) || 'Unknown error'
          }, '*');
        }
      }, false);
    })();
  `;

  (document.documentElement || document.head).appendChild(script);
}

function fetchTextViaPageContext(url, options = {}) {
  ensureSubtidexPageFetchBridge();

  return new Promise((resolve, reject) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const timeoutMs = 15000;

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'subtidex' || data.type !== 'fetchResult' || data.id !== id) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);

      if (data.error) return reject(new Error(data.error));
      resolve({
        response: {
          ok: !!data.ok,
          status: data.status,
          statusText: data.statusText,
          url: data.url
        },
        contentType: data.contentType || '',
        rawBody: data.body || ''
      });
    }

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Timed out fetching captions via page context'));
    }, timeoutMs);

    window.addEventListener('message', onMessage);

    window.postMessage(
      {
        source: 'subtidex',
        type: 'fetch',
        id,
        url,
        options
      },
      '*'
    );
  });
}

/**
 * Fetches and parses a caption track from a URL
 */
async function fetchAndParseCaptionTrack(captionUrl) {
  try {
    if (captionUrlRequiresPoToken(captionUrl)) {
      throw new Error('Caption URL requires YouTube session token (exp=xpe)');
    }

    console.log("SubtideX: Fetching caption track from:", captionUrl);
    
    // Prefer json3, but only if no explicit format is already set.
    // YouTube commonly uses `fmt=json3` (not `format=json3`).
    let resolvedUrl = captionUrl;
    let didAddFmt = false;
    try {
      const urlObj = new URL(captionUrl);
      const hasFmt = urlObj.searchParams.has('fmt');
      const hasFormat = urlObj.searchParams.has('format');
      if (!hasFmt && !hasFormat) {
        urlObj.searchParams.set('fmt', 'json3');
        didAddFmt = true;
      }
      resolvedUrl = urlObj.toString();
    } catch {
      // If captionUrl isn't a valid absolute URL, fall back to string manipulation.
      if (!resolvedUrl.includes('fmt=') && !resolvedUrl.includes('format=')) {
        resolvedUrl += (resolvedUrl.includes('?') ? '&' : '?') + 'fmt=json3';
        didAddFmt = true;
      }
    }

    async function fetchText(url) {
      // In a content script, fetch may not include YouTube cookies by default.
      // Without credentials, YouTube can respond with an HTML consent/login page
      // even for timedtext endpoints.
      const controller = new AbortController();
      const timeoutMs = 12000;
      const t = setTimeout(() => controller.abort(), timeoutMs);

      const baseOptions = {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        referrer: window.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        signal: controller.signal
      };

      // Prefer background fetch for timedtext URLs, but DO NOT accept an empty body as success.
      // Extensions are often treated as third-party, so cookies may not be sent and responses can be stripped/empty.
      if (url.includes('://www.youtube.com/api/timedtext')) {
        try {
          const bg = await sendMessageAsync({ action: "fetchText", url });
          if (bg?.status === "success" && bg.result) {
            const body = bg.result.body || '';
            if (body.trim().length > 0) {
              return {
                response: {
                  ok: !!bg.result.ok,
                  status: bg.result.status,
                  statusText: bg.result.statusText,
                  url: bg.result.url
                },
                contentType: bg.result.contentType || '',
                rawBody: body
              };
            }
          }
        } catch (e) {
          console.warn("SubtideX: background fetchText failed:", e);
        }

        // If background fetch returns empty, try MAIN world fetch (best chance to include cookies and body).
        try {
          const mw = await sendMessageAsync({ action: "fetchViaMainWorld", url });
          const body = mw?.result?.body || '';
          if (mw?.status === "success" && body.trim().length > 0) {
            return {
              response: {
                ok: !!mw.result.ok,
                status: mw.result.status,
                statusText: mw.result.statusText,
                url: mw.result.url
              },
              contentType: mw.result.contentType || '',
              rawBody: body
            };
          }
        } catch (e) {
          console.warn("SubtideX: fetchViaMainWorld fallback failed:", e);
        }
      }

      let response;
      try {
        response = await fetch(url, baseOptions);
      } finally {
        clearTimeout(t);
      }
      const contentType = response.headers.get('content-type') || '';
      const rawBody = await response.text();

      // If YouTube returns HTML here, retry in page context (first-party cookies).
      const lower = (rawBody || '').trim().toLowerCase();
      const looksLikeHtml =
        contentType.includes('text/html') ||
        lower.startsWith('<!doctype html') ||
        lower.startsWith('<html');

      // If body is empty but content-type suggests HTML, the body may be blocked/stripped.
      const looksStripped = looksLikeHtml && (rawBody || '').trim().length === 0;

      if ((looksLikeHtml || looksStripped) && url.includes('://www.youtube.com/api/timedtext')) {
        // Best-effort: fetch via MAIN world through background scripting (bypasses CORB/CSP edge cases).
        try {
          const res = await sendMessageAsync({ action: "fetchViaMainWorld", url });
          if (res?.status === "success" && res.result) {
            return {
              response: {
                ok: !!res.result.ok,
                status: res.result.status,
                statusText: res.result.statusText,
                url: res.result.url
              },
              contentType: res.result.contentType || '',
              rawBody: res.result.body || ''
            };
          }
        } catch (e) {
          console.warn("SubtideX: fetchViaMainWorld failed:", e);
        }

        try {
          return await fetchTextViaPageContext(url, baseOptions);
        } catch (e) {
          // Fall back to the original (HTML) response, so we can include it in the error.
          console.warn('SubtideX: Page-context caption fetch failed:', e);
        }
      }

      return { response, contentType, rawBody };
    }

    function normalizeBody(rawBody) {
      return (rawBody || '').trim().replace(/^\)\]\}'\s*\n?/, ''); // strip common XSSI prefix
    }

    function parseVttTimestampToSeconds(ts) {
      // Supports: HH:MM:SS.mmm or MM:SS.mmm
      const trimmed = (ts || '').trim();
      const parts = trimmed.split(':');
      if (parts.length < 2 || parts.length > 3) return null;
      const hasHours = parts.length === 3;
      const [hStr, mStr, sStr] = hasHours ? parts : ['0', parts[0], parts[1]];
      const secParts = sStr.split('.');
      const s = Number(secParts[0]);
      const ms = Number((secParts[1] || '0').padEnd(3, '0').slice(0, 3));
      const h = Number(hStr);
      const m = Number(mStr);
      if (![h, m, s, ms].every(n => Number.isFinite(n))) return null;
      return h * 3600 + m * 60 + s + ms / 1000;
    }

    function parseWebVtt(vttText) {
      const lines = (vttText || '').replace(/\r\n/g, '\n').split('\n');
      const subtitles = [];

      let i = 0;
      // Skip WEBVTT header and metadata until first blank line
      while (i < lines.length && lines[i].trim() !== '') i++;
      while (i < lines.length && lines[i].trim() === '') i++;

      while (i < lines.length) {
        // Optional cue identifier line
        if (lines[i] && !lines[i].includes('-->') && lines[i + 1] && lines[i + 1].includes('-->')) {
          i++;
        }

        const timingLine = (lines[i] || '').trim();
        if (!timingLine.includes('-->')) {
          i++;
          continue;
        }

        const [startRaw, endRawWithSettings] = timingLine.split('-->').map(s => s.trim());
        const endRaw = (endRawWithSettings || '').split(/\s+/)[0];
        const start = parseVttTimestampToSeconds(startRaw);
        const end = parseVttTimestampToSeconds(endRaw);

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

    function tryParseFromBody(body) {
      // 0) WebVTT is common for some caption endpoints
      if (body.startsWith('WEBVTT')) {
        const vttSubs = parseWebVtt(body);
        if (vttSubs.length > 0) return vttSubs;
      }

      // 1) Try JSON (json3) first
      try {
        const json = JSON.parse(body);
        if (json && Array.isArray(json.events)) {
          const subtitles = json.events
            .filter(event => event && event.segs && event.tStartMs !== undefined)
            .map(event => ({
              start: event.tStartMs / 1000,
              duration: (event.dDurationMs || 0) / 1000,
              text: (event.segs || []).map(seg => seg.utf8 || '').join('').trim()
            }))
            .filter(subtitle => subtitle.text);

          if (subtitles.length > 0) return subtitles;
        }
      } catch {
        // Not JSON; continue to XML parsing.
      }

      // 2) Try XML timedtext format (including SRV3)
      try {
          const parser = new DOMParser();
        const xml = parser.parseFromString(body, 'text/xml');
        // Detect parse errors
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

        // SRV3/SRV1 often uses <p t="ms" d="ms"> with nested <s> tokens
        if (subtitles.length === 0) {
          const pElements = xml.getElementsByTagName('p');
          for (let i = 0; i < pElements.length; i++) {
            const element = pElements[i];

            const tMs = Number(element.getAttribute('t'));
            const dMs = Number(element.getAttribute('d'));

            // TTML-like attributes (less common, but shows up)
            const begin = element.getAttribute('begin');
            const end = element.getAttribute('end');

            let start = Number.isFinite(tMs) ? tMs / 1000 : null;
            let duration = Number.isFinite(dMs) ? dMs / 1000 : null;

            if (start == null && begin) start = parseVttTimestampToSeconds(begin);
            if ((duration == null || duration === 0) && end && start != null) {
              const endSeconds = parseVttTimestampToSeconds(end);
              if (endSeconds != null) duration = Math.max(0, endSeconds - start);
            }

            if (start == null) continue;
            if (duration == null) duration = 0;

            const text = (element.textContent || '').trim();
            if (!text) continue;
              subtitles.push({ start, duration, text });
            }
          }
          
        if (subtitles.length > 0) return subtitles;
        } catch (xmlError) {
          console.error("SubtideX: Failed to parse as XML:", xmlError);
      }

      return null;
    }

    const candidateUrls = [];
    candidateUrls.push(resolvedUrl);
    if (resolvedUrl !== captionUrl) candidateUrls.push(captionUrl);

    // If we injected fmt=json3 and got HTML, try common alternatives explicitly.
    if (didAddFmt) {
      try {
        const urlObj = new URL(captionUrl);
        if (!urlObj.searchParams.has('fmt') && !urlObj.searchParams.has('format')) {
          urlObj.searchParams.set('fmt', 'srv3');
          candidateUrls.push(urlObj.toString());
          urlObj.searchParams.set('fmt', 'vtt');
          candidateUrls.push(urlObj.toString());
        }
      } catch {
        // ignore
      }
    }

    let lastMeta = null;
    for (const url of candidateUrls) {
      const { response, contentType, rawBody } = await fetchText(url);
      const body = normalizeBody(rawBody);
      lastMeta = { response, contentType, body };

      if (!response.ok) continue;

      const subtitles = tryParseFromBody(body);
      if (subtitles && subtitles.length > 0) return subtitles;

      // If this candidate returned HTML, keep trying other candidates.
      const lower = body.toLowerCase();
      if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) continue;
    }

    // If we got here, we couldn't extract anything useful
    if (lastMeta) {
      const { response, contentType, body } = lastMeta;
      const lower = (body || '').toLowerCase();
      const isHtml =
        (contentType || '').includes('text/html') ||
        lower.startsWith('<!doctype html') ||
        lower.startsWith('<html');

      if (isHtml) {
        const finalUrl = response?.url || '';
        const snippetRaw = (body || '').slice(0, 280);
        const snippet = snippetRaw.replace(/\s+/g, ' ').trim();

        throw new Error(
          `Failed to parse caption track (YouTube returned an HTML page; status: ${response?.status ?? 'unknown'}). ` +
          `This is usually consent/login/rate-limit/anti-bot. url: ${finalUrl || 'unknown'}` +
          ` First bytes: "${snippet || '<empty body>'}"`
        );
      }

      const snippet = body.slice(0, 220).replace(/\s+/g, ' ').trim();
      throw new Error(
        `Failed to parse caption track (content-type: ${contentType || 'unknown'}).${response?.url ? ` url: ${response.url}` : ''}${snippet ? ` First bytes: "${snippet}"` : ''}`
      );
    }

    throw new Error("Failed to parse caption track");
  } catch (error) {
    console.error("SubtideX: Error fetching caption track:", error);
    throw error;
  }
}

/**
 * Extract subtitles from video element's textTracks
 */
async function extractFromVideoTextTracks() {
  return new Promise((resolve) => {
    // Find the video element
    const videoElement = document.querySelector('video');
    
    if (!videoElement || !videoElement.textTracks || videoElement.textTracks.length === 0) {
      return resolve(null);
    }
    
    console.log("SubtideX: Found video element with", videoElement.textTracks.length, "text tracks");
    
    // Prefer a track that is already showing; otherwise try the first track.
    let activeTrack = null;
    for (let i = 0; i < videoElement.textTracks.length; i++) {
      const track = videoElement.textTracks[i];
      if (track.mode === 'showing') {
        activeTrack = track;
        break;
      }
    }
    if (!activeTrack) activeTrack = videoElement.textTracks[0];
    if (!activeTrack) return resolve(null);

    // Ensure cues can load without necessarily rendering captions UI.
    // 'hidden' still loads cues in many browsers.
    try {
      if (activeTrack.mode === 'disabled') activeTrack.mode = 'hidden';
    } catch {
      // ignore
    }

    const timeoutMs = 10000;
    const startedAt = Date.now();

    const finish = () => {
      const cues = activeTrack.cues;
      if (!cues || cues.length === 0) return resolve(null);

      const subtitles = [];
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const text = (cue.text || '').trim();
        if (!text) continue;
        subtitles.push({
          start: cue.startTime,
          duration: cue.endTime - cue.startTime,
          text
        });
      }
      resolve(subtitles.length > 0 ? subtitles : null);
    };

    const onCueChange = () => {
      const cues = activeTrack.cues;
      if (cues && cues.length > 0) {
        cleanup();
        finish();
      }
    };

    const poll = () => {
      const elapsed = Date.now() - startedAt;
      const cues = activeTrack.cues;
      if (cues && cues.length > 0) {
        cleanup();
        return finish();
      }
      if (elapsed >= timeoutMs) {
        cleanup();
        return resolve(null);
      }
      setTimeout(poll, 250);
    };

    const cleanup = () => {
      try {
        activeTrack.removeEventListener('cuechange', onCueChange);
      } catch {
        // ignore
      }
    };

    try {
      activeTrack.addEventListener('cuechange', onCueChange);
    } catch {
      // ignore
    }
    poll();
  });
}

function parseYouTubeTimestampToSeconds(ts) {
  const trimmed = (ts || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map(p => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const [hStr, mStr, sStr] = parts.length === 3 ? parts : ['0', parts[0], parts[1]];
  const h = Number(hStr);
  const m = Number(mStr);
  const s = Number(parseFloat(sStr));
  if (![h, m, s].every(n => Number.isFinite(n))) return null;
  return h * 3600 + m * 60 + s;
}

function parseHumanReadableTimestampToSeconds(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;

  let match = t.match(/^(\d+)\s+(?:second|seconds|sec|secs)$/);
  if (match) return Number(match[1]);

  match = t.match(/^(\d+)\s+(?:minute|minutes|min|mins)$/);
  if (match) return Number(match[1]) * 60;

  match = t.match(/^(\d+)\s+(?:minute|minutes|min|mins)[,\s]+(\d+)\s+(?:second|seconds|sec|secs)$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);

  match = t.match(/^(\d+)\s+(?:hour|hours|hr|hrs)[,\s]+(\d+)\s+(?:minute|minutes|min|mins)(?:[,\s]+(\d+)\s+(?:second|seconds|sec|secs))?$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = match[3] ? Number(match[3]) : 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

function parseTranscriptTimestampToSeconds(ts) {
  const colonParsed = parseYouTubeTimestampToSeconds(ts);
  if (colonParsed != null) return colonParsed;
  return parseHumanReadableTimestampToSeconds(ts);
}

const TRANSCRIPT_TIMESTAMP_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;
const INLINE_TRANSCRIPT_TIME = /^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+([\s\S]+)$/;

function isHumanReadableTimestampString(text) {
  return parseHumanReadableTimestampToSeconds(text) != null;
}

function isTranscriptTimestampString(text) {
  return (
    TRANSCRIPT_TIMESTAMP_RE.test(String(text || '').trim()) ||
    isHumanReadableTimestampString(text)
  );
}

function isValidCaptionText(text) {
  const trimmed = String(text || '').trim();
  return trimmed.length > 0 && !isTranscriptTimestampString(trimmed);
}

function stripKnownTimestampPrefix(text) {
  let normalized = String(text || '').trim();
  if (!normalized) return '';

  const colonInline = normalized.match(INLINE_TRANSCRIPT_TIME);
  if (colonInline) return colonInline[2].trim();

  const hrMatch = normalized.match(
    /^(?:(?:\d+\s+(?:hour|hours|hr|hrs)[,\s]+)?(?:\d+\s+(?:minute|minutes|min|mins)[,\s]+)?\d+\s+(?:second|seconds|sec|secs)|(?:\d+\s+(?:minute|minutes|min|mins)))\s*[,.]?\s*(.+)$/i
  );
  if (hrMatch?.[1]) return hrMatch[1].trim();

  if (isHumanReadableTimestampString(normalized)) return '';

  return normalized;
}

function normalizeCaptionText(text, timestamp) {
  let normalized = String(text || '').trim();
  if (!normalized) return '';

  const ts = String(timestamp || '').trim();
  if (ts && normalized.startsWith(ts)) {
    normalized = normalized.slice(ts.length).trim();
  }

  normalized = stripKnownTimestampPrefix(normalized);

  return isValidCaptionText(normalized) ? normalized : '';
}

function extractCaptionFromAriaLabel(ariaLabel) {
  const label = String(ariaLabel || '').trim();
  if (!label) return '';

  const withoutPrefix = stripKnownTimestampPrefix(label);
  return isValidCaptionText(withoutPrefix) ? withoutPrefix : '';
}

function extractCaptionTextFromSegmentRow(row, timestamp) {
  if (!row) return '';

  const ariaCaption = extractCaptionFromAriaLabel(row.getAttribute?.('aria-label'));
  if (ariaCaption) return ariaCaption;

  const textSelectors = [
    '.segment-text',
    'yt-formatted-string.segment-text',
    '[class*="segment-text"]',
  ];

  for (const selector of textSelectors) {
    const el = row.querySelector?.(selector);
    if (!el) continue;
    const className = String(el.className || '');
    if (className.includes('timestamp')) continue;

    const ariaText = extractCaptionFromAriaLabel(el.getAttribute?.('aria-label'));
    if (ariaText) return ariaText;

    const text = normalizeCaptionText(el.textContent, timestamp);
    if (text) return text;
  }

  const children = row.children ? Array.from(row.children) : [];
  for (const child of children) {
    const cls = String(child.className || '');
    const tag = (child.tagName || '').toUpperCase();
    if (cls.includes('timestamp') || tag === 'BUTTON') continue;

    const ariaText = extractCaptionFromAriaLabel(child.getAttribute?.('aria-label'));
    if (ariaText) return ariaText;

    const text = normalizeCaptionText(child.textContent, timestamp);
    if (text) return text;
  }

  const ts = String(timestamp || '').trim();
  return normalizeCaptionText(row.textContent || '', ts);
}

function countValidCaptionRows(subtitles) {
  return (subtitles || []).filter((row) => isValidCaptionText(row?.text)).length;
}

function subtitlesHaveUsableCaptionText(subtitles) {
  if (!subtitles?.length) return false;
  const validCount = countValidCaptionRows(subtitles);
  if (validCount === 0) return false;
  return validCount >= Math.max(1, Math.ceil(subtitles.length * 0.25));
}

function extractTimestampFromSegmentRow(row) {
  if (!row) return null;

  const tsCandidates = [
    row.querySelector?.('.segment-timestamp'),
    row.querySelector?.('[class*="segment-timestamp"]'),
    row.querySelector?.('button'),
  ].filter(Boolean);

  for (const el of tsCandidates) {
    const candidates = [
      (el.textContent || '').trim(),
      (el.getAttribute?.('aria-label') || '').trim(),
    ].filter(Boolean);

    for (const text of candidates) {
      if (TRANSCRIPT_TIMESTAMP_RE.test(text) || isHumanReadableTimestampString(text)) {
        return text;
      }
    }
  }

  const full = (row.textContent || '').trim();
  const inline = full.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+/);
  if (inline?.[1]) return inline[1];

  const hrPrefix = full.match(
    /^((?:(?:\d+\s+(?:hour|hours|hr|hrs)[,\s]+)?(?:\d+\s+(?:minute|minutes|min|mins)[,\s]+)?\d+\s+(?:second|seconds|sec|secs)|(?:\d+\s+(?:minute|minutes|min|mins))))\b/i
  );
  return hrPrefix?.[1] || null;
}

function parseSegmentRow(row) {
  let ts = extractTimestampFromSegmentRow(row);
  let text = extractCaptionTextFromSegmentRow(row, ts);

  if (!ts && isHumanReadableTimestampString(text)) {
    ts = text;
    text = extractCaptionTextFromSegmentRow(row, ts);
  }

  const start = parseTranscriptTimestampToSeconds(ts);
  if (start == null || !isValidCaptionText(text)) return null;

  return { start, text };
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

function countTranscriptSegmentNodes() {
  return deepQueryAll(
    document,
    (el) =>
      el.classList?.contains('segment-text') ||
      (el.tagName || '').toLowerCase() === 'transcript-segment-view-model' ||
      (el.tagName || '').toLowerCase() === 'ytd-transcript-segment-renderer'
  ).length;
}

function scrapeTranscriptFromSegmentsContainer() {
  const containers = deepQueryAll(document, (el) => isTranscriptSegmentsContainer(el));
  let bestSegments = [];

  for (const container of containers) {
    const segments = [];

    for (const child of container.children) {
      const tag = (child.tagName || '').toUpperCase();
      if (tag.includes('TRANSCRIPT-SECTION-HEADER')) continue;

      const parsed = parseSegmentRow(child);
      if (parsed) segments.push(parsed);
    }

    if (segments.length > bestSegments.length) bestSegments = segments;
  }

  if (bestSegments.length) {
    console.log(`SubtideX: segments-container scrape found ${bestSegments.length} segments`);
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
    const parsed = parseSegmentRow(vm);
    if (parsed) segments.push(parsed);
  }

  if (segments.length) {
    console.log(`SubtideX: transcript-segment-view-model scrape found ${segments.length} segments`);
  }
  return segmentsToSubtitleRows(segments);
}

function* deepElementIterator(root) {
  // Walk DOM + open shadow roots
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;

    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      // Shadow root
      if (node.shadowRoot) stack.push(node.shadowRoot);

      // Children
      const children = node.children ? Array.from(node.children) : [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }

    if (node.nodeType === Node.ELEMENT_NODE) yield node;
  }
}

function deepQueryAll(root, predicate) {
  const out = [];
  for (const el of deepElementIterator(root)) {
    try {
      if (predicate(el)) out.push(el);
    } catch {
      // ignore predicate errors
    }
  }
  return out;
}

async function openYouTubeTranscriptPanel() {
  const expand =
    document.querySelector('#expand') ||
    document.querySelector('tp-yt-paper-button#expand') ||
    document.querySelector('[aria-label="Show more"]') ||
    document.querySelector('[aria-label*="Show more"]');
  if (expand) {
    expand.click();
    await sleep(300);
  }

  const descTranscript = document.querySelector('ytd-video-description-transcript-section-renderer');
  if (descTranscript) {
    descTranscript.click();
    await sleep(600);
    if (countTranscriptSegmentNodes() > 0 || isTranscriptPanelVisible()) return true;
  }

  const transcriptButtons = deepQueryAll(document, (el) => {
    if ((el.tagName || '').toLowerCase() !== 'button') return false;
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const text = (el.textContent || '').toLowerCase();
    return (
      label.includes('transcript') ||
      label.includes('bản ghi') ||
      label.includes('phụ đề') ||
      label.includes('字幕') ||
      text.includes('transcript') ||
      text.includes('show transcript')
    );
  });

  for (const btn of transcriptButtons) {
    btn.click();
    await sleep(600);
    if (countTranscriptSegmentNodes() > 0 || isTranscriptPanelVisible()) return true;
  }

  for (const item of document.querySelectorAll('ytd-menu-service-item-renderer')) {
    const html = item.outerHTML || '';
    if (
      html.includes('searchable-transcript') ||
      html.includes('getTranscriptEndpoint') ||
      html.includes('engagement-panel-searchable-transcript')
    ) {
      item.click();
      await sleep(600);
      return true;
    }
  }

  const moreButton =
    document.querySelector('button[aria-label="More actions"]') ||
    document.querySelector('button[aria-label*="More actions"]') ||
    deepQueryAll(document, (el) => {
      if ((el.tagName || '').toLowerCase() !== 'button') return false;
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      return label.includes('more actions') || label.includes('more');
    })[0];

  if (moreButton) {
    moreButton.click();
    await sleep(400);
  }

  const menuItems = Array.from(
    document.querySelectorAll(
      'ytd-menu-service-item-renderer, tp-yt-paper-item, ytd-menu-navigation-item-renderer'
    )
  );
  const transcriptItem = menuItems.find((el) => {
    const text = (el.textContent || '').trim().toLowerCase();
    const html = el.outerHTML || '';
    return (
      html.includes('searchable-transcript') ||
      html.includes('getTranscriptEndpoint') ||
      text.includes('transcript') ||
      text.includes('transkript') ||
      text.includes('transcription') ||
      text.includes('bản ghi') ||
      text.includes('phụ đề') ||
      text.includes('hiển thị') ||
      text.includes('字幕')
    );
  });

  if (transcriptItem) {
    (transcriptItem.closest('ytd-menu-service-item-renderer, tp-yt-paper-item') || transcriptItem).click();
    await sleep(600);
    return true;
  }

  return false;
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

  const byTag = deepQueryAll(document, (el) => {
    const tag = (el.tagName || '').toLowerCase();
    return tag.includes('transcript') && tag.startsWith('ytd-');
  });
  if (byTag.length) return byTag[0];

  return (
    deepQueryAll(document, (el) => el.id === 'engagement-panel-searchable-transcript')[0] ||
    document.querySelector('#panels') ||
    null
  );
}

function collectTranscriptPanelCandidates() {
  const candidates = new Set();
  const add = (el) => {
    if (el && el.nodeType === Node.ELEMENT_NODE) candidates.add(el);
  };

  add(findTranscriptPanelRoot());
  add(document.querySelector('#panels'));
  add(document.querySelector('#contentScrollable'));

  for (const el of deepQueryAll(document, (node) => {
    const tid = (node.getAttribute?.('target-id') || '').toLowerCase();
    return tid.includes('transcript');
  })) {
    add(el);
  }

  for (const el of deepQueryAll(document, (node) => {
    const tag = (node.tagName || '').toLowerCase();
    return tag.includes('transcript') && tag.startsWith('ytd-');
  })) {
    add(el);
  }

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
      const start = parseTranscriptTimestampToSeconds(inline[1]);
      const caption = normalizeCaptionText(inline[2], inline[1]);
      if (start != null && caption) {
        segments.push({ start, text: caption });
      }
      continue;
    }

    const lineIsTimestamp = TIME_ONLY.test(line) || isHumanReadableTimestampString(line);
    const nextLine = lines[i + 1];
    const nextIsTimestamp =
      nextLine && (TIME_ONLY.test(nextLine) || isHumanReadableTimestampString(nextLine));

    if (lineIsTimestamp && nextLine && !nextIsTimestamp) {
      const start = parseTranscriptTimestampToSeconds(line);
      const caption = normalizeCaptionText(nextLine, line);
      if (start != null && caption) {
        segments.push({ start, text: caption });
      }
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
  let bestScore = 0;

  for (const root of collectTranscriptPanelCandidates()) {
    const text = root.innerText || root.textContent || '';
    const score = scoreTranscriptPlainText(text);
    if (score < 2) continue;

    const parsed = parseTranscriptPlainText(text);
    if (parsed.length > bestSegments.length || (parsed.length === bestSegments.length && score > bestScore)) {
      bestSegments = parsed;
      bestScore = score;
    }
  }

  // Smallest useful subtree: list items grouped by parent
  if (bestSegments.length < 3) {
    const listParents = new Set();
    for (const item of deepQueryAll(document, (el) => el.getAttribute?.('role') === 'listitem')) {
      if (item.parentElement) listParents.add(item.parentElement);
    }
    for (const parent of listParents) {
      const text = parent.innerText || parent.textContent || '';
      const score = scoreTranscriptPlainText(text);
      if (score < 2) continue;
      const parsed = parseTranscriptPlainText(text);
      if (parsed.length > bestSegments.length) bestSegments = parsed;
    }
  }

  console.log(`SubtideX: brute-force scrape found ${bestSegments.length} segments (score ${bestScore})`);
  return segmentsToSubtitleRows(bestSegments);
}

function isTranscriptPanelVisible() {
  for (const root of collectTranscriptPanelCandidates()) {
    if (scoreTranscriptPlainText(root.innerText || '') >= 2) return true;
  }

  const root = findTranscriptPanelRoot();
  if (!root) return false;
  return (
    deepQueryAll(root, (el) => el.classList?.contains('segment-text')).length > 0 ||
    deepQueryAll(root, (el) => (el.tagName || '').toLowerCase() === 'ytd-transcript-segment-renderer').length > 0 ||
    scoreTranscriptPlainText(root.innerText || '') >= 2
  );
}

function segmentsToSubtitleRows(segments) {
  const deduped = [];
  const seen = new Set();
  for (const s of segments) {
    if (!isValidCaptionText(s.text)) continue;
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

async function extractTranscriptSegmentsFromDom() {
  let subs = scrapeTranscriptFromSegmentsContainer();
  if (subs?.length) return subs;

  subs = scrapeTranscriptViewModels();
  if (subs?.length) return subs;

  const root = findTranscriptPanelRoot() || document;
  const segments = [];

  const segmentRows = deepQueryAll(root, (el) => {
    const tag = (el.tagName || '').toLowerCase();
    return (
      tag === 'transcript-segment-view-model' ||
      tag === 'ytd-transcript-segment-renderer' ||
      el.getAttribute?.('role') === 'listitem'
    );
  });

  for (const row of segmentRows) {
    const parsed = parseSegmentRow(row);
    if (parsed) segments.push(parsed);
  }

  if (segments.length) {
    return segmentsToSubtitleRows(segments);
  }

  const container =
    root.querySelector('#segments-container') ||
    deepQueryAll(root, (el) => el.id === 'segments-container')[0];

  if (container) {
    for (const child of container.children) {
      const tag = (child.tagName || '').toUpperCase();
      if (tag.includes('TRANSCRIPT-SECTION-HEADER')) continue;
      const parsed = parseSegmentRow(child);
      if (parsed) segments.push(parsed);
    }
  }

  return segmentsToSubtitleRows(segments) || bruteForceScrapeTranscript();
}

async function scrapeAllVisibleTranscriptStrategies() {
  await scrollTranscriptPanelToLoadAll();

  let subs = await extractTranscriptSegmentsFromDom();
  if (subs?.length) return subs;

  subs = bruteForceScrapeTranscript();
  if (subs?.length) return subs;

  const containers = deepQueryAll(document, (el) => isTranscriptSegmentsContainer(el));
  const segmentTexts = deepQueryAll(document, (el) => el.classList?.contains('segment-text'));
  console.warn('SubtideX: visible transcript scrape found nothing', {
    segmentsContainers: containers.length,
    segmentTextNodes: segmentTexts.length,
    panelRoot: findTranscriptPanelRoot()?.tagName || null,
    panelVisible: isTranscriptPanelVisible(),
  });

  return null;
}

async function scrollTranscriptPanelToLoadAll() {
  const containers = deepQueryAll(document, (el) => isTranscriptSegmentsContainer(el));

  if (!containers.length) {
    const fallback =
      document.querySelector('ytd-transcript-search-panel-renderer #segments-container') ||
      document.querySelector('#engagement-panel-searchable-transcript #content') ||
      findTranscriptPanelRoot();
    if (fallback) containers.push(fallback);
  }

  for (const container of containers.slice(0, 2)) {
    if (typeof container.scrollTop !== 'number') continue;

    let lastCount = 0;
    let stablePasses = 0;

    for (let i = 0; i < 15; i++) {
      container.scrollTop = container.scrollHeight;
      await sleep(100);

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
        if (stablePasses >= 2 && count > 0) break;
      }
    }
  }
}

async function extractFromTranscriptPanel() {
  if (countTranscriptSegmentNodes() > 0 || isTranscriptPanelVisible()) {
    setLoadingTexts({ messageText: 'Reading transcript from panel...', step: 2 });
    const existing = await scrapeAllVisibleTranscriptStrategies();
    if (existing?.length) return existing;
  }

  setLoadingTexts({ messageText: 'Opening transcript panel...', step: 1 });
  await openYouTubeTranscriptPanel();

  for (let attempt = 0; attempt < 25; attempt++) {
    if (countTranscriptSegmentNodes() > 0 || isTranscriptPanelVisible()) {
      setLoadingTexts({ messageText: 'Downloading captions from transcript...', step: 2 });
      const subtitles = await scrapeAllVisibleTranscriptStrategies();
      if (subtitles?.length) return subtitles;
    }

    if (attempt === 6 || attempt === 14) {
      await openYouTubeTranscriptPanel();
    }

    await sleep(400);
  }

  return null;
}

/**
 * Converts subtitle objects to CSV format
 */
function convertToCSV(subtitles) {
  if (!subtitles || subtitles.length === 0) {
    throw new Error("No subtitles to convert");
  }
  
  console.log("SubtideX: Converting subtitles to CSV format");
  
  // CSV header
  let csv = "Start Time,End Time,Duration,Text\n";
  
  // Add each subtitle as a row
  subtitles.forEach(subtitle => {
    const startTime = formatTimestamp(subtitle.start);
    const endTime = formatTimestamp(subtitle.start + subtitle.duration);
    const duration = subtitle.duration.toFixed(2);
    
    // Properly escape text for CSV (double quotes, escape internal quotes)
    const escapedText = subtitle.text.replace(/"/g, '""');
    
    // Add the row to CSV
    csv += `${startTime},${endTime},${duration},"${escapedText}"\n`;
  });
  
  return csv;
}

/**
 * Formats a timestamp into HH:MM:SS.mmm format
 */
function formatTimestamp(seconds) {
  const date = new Date(seconds * 1000);
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const secs = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
  
  return `${hours}:${minutes}:${secs}.${ms}`;
}

/**
 * Shows the Tidal progress panel (bottom-right)
 */
function showLoadingIndicator() {
  hideLoadingIndicator();
  ensureTidalStyles();

  loadingIndicator = document.createElement('div');
  loadingIndicator.id = 'subtidex-loading';
  loadingIndicator.className = 'subtidex-panel';
  loadingIndicator.setAttribute('role', 'status');
  loadingIndicator.setAttribute('aria-live', 'polite');

  loadingIndicator.innerHTML = `
    <div class="subtidex-panel__card">
      <div class="subtidex-panel__header">
        <img class="subtidex-panel__logo" src="${chrome.runtime.getURL('icons/icon48.png')}" alt="">
        <span class="subtidex-panel__brand">SubtideX</span>
      </div>
      <div class="subtidex-panel__detail">Starting…</div>
      <ul class="subtidex-steps">
        <li class="subtidex-step subtidex-step--active" data-step="1">
          <span class="subtidex-step__dot"></span>
          <span class="subtidex-step__label">Open transcript panel</span>
        </li>
        <li class="subtidex-step subtidex-step--pending" data-step="2">
          <span class="subtidex-step__dot"></span>
          <span class="subtidex-step__label">Read captions</span>
        </li>
        <li class="subtidex-step subtidex-step--pending" data-step="3">
          <span class="subtidex-step__dot"></span>
          <span class="subtidex-step__label">Save CSV</span>
        </li>
      </ul>
      <div class="subtidex-progress"><div class="subtidex-progress__bar"></div></div>
    </div>
  `;

  loadingMessageTextEl = loadingIndicator.querySelector('.subtidex-panel__detail');
  loadingStepsEl = loadingIndicator.querySelector('.subtidex-steps');
  document.body.appendChild(loadingIndicator);
}

function hideLoadingIndicator() {
  const existing = document.getElementById('subtidex-loading');
  if (existing) {
    existing.style.animation = 'subtidex-panel-out 0.25s ease-in forwards';
    setTimeout(() => existing.remove(), 250);
  }
  loadingIndicator = null;
  loadingStatusTextEl = null;
  loadingMessageTextEl = null;
  loadingStepsEl = null;
}

function showSuccessToast({ count, filename } = {}) {
  dismissNotification();
  ensureTidalStyles();

  const toast = document.createElement('div');
  toast.id = 'subtidex-notification';
  toast.className = 'subtidex-toast subtidex-toast--success';
  toast.style.position = 'fixed';

  const lines = count
    ? `${count.toLocaleString()} caption${count === 1 ? '' : 's'} saved`
    : 'Captions saved';

  toast.innerHTML = `
    <button class="subtidex-toast__close" type="button" aria-label="Dismiss">×</button>
    <div class="subtidex-toast__title subtidex-toast__title--success">✓ ${lines}</div>
    <div class="subtidex-toast__sub">${filename ? `${filename} → Downloads` : 'Check your Downloads folder'}</div>
    <button class="subtidex-toast__btn" type="button">Download again</button>
  `;

  toast.querySelector('.subtidex-toast__close').addEventListener('click', () => dismissNotification());
  toast.querySelector('.subtidex-toast__btn').addEventListener('click', () => {
    dismissNotification();
    if (!extractionInProgress) {
      extractionInProgress = true;
      extractAndProcessSubtitles();
    }
  });

  document.body.appendChild(toast);
  notificationElement = toast;

  setTimeout(() => dismissNotification(), 8000);
}

function dismissNotification() {
  const existing = document.getElementById('subtidex-notification');
  if (existing) {
    existing.style.animation = 'subtidex-panel-out 0.25s ease-in forwards';
    setTimeout(() => existing.remove(), 250);
  }
  if (notificationElement === existing) notificationElement = null;
}

/**
 * Shows a notification message to the user
 */
function showNotification(message, type = "info") {
  dismissNotification();
  ensureTidalStyles();

  const toast = document.createElement('div');
  toast.id = 'subtidex-notification';
  toast.className = `subtidex-toast subtidex-toast--${type === 'success' ? 'success' : type === 'error' ? 'error' : 'info'}`;
  toast.style.position = 'fixed';

  const titleClass = type === 'success' ? 'subtidex-toast__title--success' : type === 'error' ? 'subtidex-toast__title--error' : '';
  const prefix = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

  toast.innerHTML = `
    <button class="subtidex-toast__close" type="button" aria-label="Dismiss">×</button>
    <div class="subtidex-toast__title ${titleClass}">${prefix} ${type === 'error' ? 'Something went wrong' : type === 'success' ? 'Done' : 'SubtideX'}</div>
    <div class="subtidex-toast__sub"></div>
  `;

  toast.querySelector('.subtidex-toast__sub').textContent = message;
  toast.querySelector('.subtidex-toast__close').addEventListener('click', () => dismissNotification());

  document.body.appendChild(toast);
  notificationElement = toast;

  setTimeout(() => dismissNotification(), type === 'error' ? 9000 : 6000);
}

/**
 * Adds a debug button to the page in development mode
 */
function addDebugButton() {
  if (!document.getElementById('subtidex-debug-button')) {
    const debugButton = document.createElement('button');
    debugButton.id = 'subtidex-debug-button';
    debugButton.textContent = 'SubtideX Debug';
    
    const style = document.createElement('style');
    style.textContent = `
      #subtidex-debug-button {
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: #137dc5;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 8px 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        cursor: pointer;
        z-index: 9999;
        opacity: 0.8;
        transition: opacity 0.2s, transform 0.2s;
      }
      #subtidex-debug-button:hover {
        opacity: 1;
        transform: translateY(-2px);
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(debugButton);
    
    debugButton.addEventListener('click', () => {
      debugMode = true;
      console.log('SubtideX: Debug mode enabled');
      showNotification('SubtideX Debug Mode Enabled', 'info');
      
      // Log page state
      console.log('SubtideX Debug: Current URL', window.location.href);
      console.log('SubtideX Debug: Is video page?', checkIfYouTubeVideoPage());
      console.log('SubtideX Debug: Video ID', extractVideoId(window.location.href));
      console.log('SubtideX Debug: ytInitialPlayerResponse exists?', !!window.ytInitialPlayerResponse);
      
      // Try to extract captions
      if (!extractionInProgress) {
        extractAndProcessSubtitles();
      } else {
        console.log('SubtideX Debug: Extraction already in progress');
      }
    });
  }
}