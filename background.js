// Background script for SubtideX extension
console.log("SubtideX: Background script loaded - v1.5.0");

// Global state
let currentTabId = null;
let isProcessing = false;
let lastVideoId = null;

// Track popup state
let popupState = {
  isShowing: false
};

// Listen for tab updates to monitor YouTube navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process if the URL has changed and it's complete
  if (changeInfo.status === 'complete' && tab.url) {
    const isYouTubeVideoPage = isYouTubeVideo(tab.url);
    
    // If we're on a YouTube video page
    if (isYouTubeVideoPage) {
      // Extract video ID
      const videoId = extractVideoId(tab.url);
      
      // If it's a new video (not the same as last time)
      if (videoId && videoId !== lastVideoId) {
        lastVideoId = videoId;
        currentTabId = tabId;
        
        // Notify content script about the page change
        chrome.tabs.sendMessage(tabId, { action: "pageUpdated", isVideoPage: true, videoId: videoId })
          .catch(error => {
            // This will happen if the content script isn't loaded yet, which is normal
            console.log("SubtideX: Content script not ready yet, will try again later");
          });
      }
    } else if (tab.url.includes('youtube.com')) {
      // We're on YouTube but not a video page
      lastVideoId = null;
      currentTabId = tabId;
      
      // Notify content script
      chrome.tabs.sendMessage(tabId, { action: "pageUpdated", isVideoPage: false })
        .catch(error => {
          // This is expected if the content script isn't ready
          console.log("SubtideX: Content script not ready yet on non-video page");
        });
    }
  }
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("SubtideX: Received message:", message.action);
  
  try {
    switch (message.action) {
      case "startExtraction":
        handleStartExtraction(message, sender, sendResponse);
        break;
        
      case "downloadCSV":
        handleDownloadCSV(message, sender, sendResponse);
        break;
        
      case "checkYouTubeVideo":
        handleCheckYouTubeVideo(sender.tab, sendResponse);
        break;
        
      case "popupOpened":
        popupState.isShowing = true;
        break;
        
      case "popupClosed":
        popupState.isShowing = false;
        break;
        
      case "debugInfo":
        console.log("SubtideX Debug:", message.info);
        break;
        
      case "error":
        console.error("SubtideX Error:", message.error, message.context || "");
        break;
        
      case "reloadAndExtract":
        handleReloadAndExtract(message.tabId);
        break;

      case "openTab":
        if (message.url) {
          chrome.tabs.create({ url: message.url });
          sendResponse({ status: "success" });
        } else {
          sendResponse({ status: "error", error: "No URL provided" });
        }
        break;

      case "fetchViaMainWorld":
        // Fetch a URL from the page's MAIN world using chrome.scripting to bypass
        // cases where content-script fetch gets an empty/blocked body (CORB/CSP).
        if (!sender.tab?.id) {
          sendResponse({ status: "error", error: "No sender tab available" });
          break;
        }
        if (!message.url) {
          sendResponse({ status: "error", error: "No URL provided" });
          break;
        }

        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: "MAIN",
          args: [message.url],
          func: async (url) => {
            const resp = await fetch(url, { credentials: "include", redirect: "follow" });
            const contentType = resp.headers.get("content-type") || "";
            const text = await resp.text();
            return {
              ok: resp.ok,
              status: resp.status,
              statusText: resp.statusText,
              url: resp.url,
              contentType,
              body: text
            };
          }
        }).then((results) => {
          const result = results?.[0]?.result;
          sendResponse({ status: "success", result });
        }).catch((error) => {
          console.error("SubtideX: fetchViaMainWorld failed:", error);
          sendResponse({ status: "error", error: error?.message || String(error) });
        });
        break;

      case "fetchText":
        // Fetch a URL from the extension service worker context.
        // This avoids some renderer/CORB cases where content scripts see an empty body.
        if (!message.url) {
          sendResponse({ status: "error", error: "No URL provided" });
          break;
        }

        fetch(message.url, {
          credentials: "include",
          redirect: "follow",
          cache: "no-store",
          headers: {
            // Hint the formats we can parse
            "accept": "text/vtt,text/xml,application/json;q=0.9,*/*;q=0.8"
          }
        })
          .then(async (resp) => {
            const contentType = resp.headers.get("content-type") || "";
            const body = await resp.text();
            sendResponse({
              status: "success",
              result: {
                ok: resp.ok,
                status: resp.status,
                statusText: resp.statusText,
                url: resp.url,
                contentType,
                body
              }
            });
          })
          .catch((error) => {
            console.error("SubtideX: fetchText failed:", error);
            sendResponse({ status: "error", error: error?.message || String(error) });
          });
        break;

      case "getTranscriptViaMainWorld":
        handleInnertubeExtraction(sender, sendResponse);
        break;
    }
  } catch (error) {
    console.error("SubtideX: Error handling message:", error, message);
    sendResponse({ status: "error", error: error.message });
  }
  
  // Required for async response
  return true;
});

function handleInnertubeExtraction(sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ status: "error", error: "No sender tab available" });
    return;
  }

  chrome.scripting
    .executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["innertube-extract.js"],
    })
    .then(() =>
      chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async () => {
          try {
            const extract = window.__SUBTIDEX_EXTRACT_SUBTITLES__;
            if (typeof extract !== "function") {
              return { error: "SubtideX InnerTube extractor failed to load" };
            }
            return await extract();
          } catch (e) {
            return { error: e?.message || String(e) };
          }
        },
      })
    )
    .then((results) => {
      const frameResult = results?.[0];
      if (frameResult?.error) {
        throw new Error(frameResult.error.message || String(frameResult.error));
      }
      const result = frameResult?.result;
      if (result?.error) {
        throw new Error(result.error);
      }
      if (!result?.subtitles?.length) {
        throw new Error(result?.message || "No subtitles returned from InnerTube extractor");
      }
      sendResponse({ status: "success", result });
    })
    .catch((error) => {
      console.error("SubtideX: InnerTube extraction failed:", error);
      sendResponse({ status: "error", error: error?.message || String(error) });
    });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure the content script is connected on a YouTube watch tab.
 * After an extension reload, manifest-injected scripts on open tabs are dead until
 * the page is refreshed — we re-inject programmatically when needed.
 */
async function ensureContentScript(tabId) {
  const tab = await chrome.tabs.get(tabId);

  if (!tab?.url?.includes('youtube.com')) {
    throw new Error('Open a YouTube video page first.');
  }

  if (!isYouTubeVideo(tab.url)) {
    throw new Error('Navigate to a YouTube watch page (youtube.com/watch?v=…) first.');
  }

  const ping = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

  try {
    await ping();
    return;
  } catch {
    // Content script not connected — inject below
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(150);
    try {
      await ping();
      return;
    } catch {
      // retry
    }
  }

  throw new Error('Could not connect to the YouTube tab. Refresh the page and try again.');
}

/**
 * Handles the start extraction message
 */
async function handleStartExtraction(message, sender, sendResponse) {
  if (isProcessing) {
    console.log("SubtideX: Already processing, ignoring duplicate request");
    sendResponse({ status: "busy" });
    return;
  }

  isProcessing = true;

  if (sender.tab !== undefined) {
    console.log("SubtideX: Direct extraction request from content script");
    sendResponse({ status: "started" });
    isProcessing = false;
    return;
  }

  const tabId = message?.tabId || currentTabId;
  if (!tabId) {
    isProcessing = false;
    sendResponse({
      status: "error",
      error: "No active YouTube tab found. Open a YouTube video and try again.",
    });
    return;
  }

  currentTabId = tabId;

  try {
    await ensureContentScript(tabId);
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'startExtraction' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
    isProcessing = false;
    sendResponse({ status: "started" });
  } catch (error) {
    console.error("SubtideX: Error starting extraction:", error);
    isProcessing = false;
    sendResponse({
      status: "error",
      error: error?.message || "Failed to communicate with YouTube page. Refresh the tab and retry.",
    });
  }
}

/**
 * Handles the download CSV message
 */
function handleDownloadCSV(message, sender, sendResponse) {
  console.log("SubtideX: Preparing to download CSV");
  
  try {
    const csvData = message.data;
    const videoTitle = message.videoTitle || "youtube_subtitles";
    
    // Create a valid filename while preserving case and most characters
    // Only replace characters that are invalid in filenames
    const sanitizedTitle = videoTitle.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${sanitizedTitle}.csv`;
    
    console.log("SubtideX: Initiating download of:", filename);
    
    // Create a data URI for the CSV content with proper encoding
    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvData);
    
    // Use chrome.downloads.download with the data URI
    chrome.downloads.download({
      url: csvContent,
      filename: filename,
      saveAs: true // Let user choose where to save
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("SubtideX: Download error:", chrome.runtime.lastError);
        sendResponse({ status: "error", error: chrome.runtime.lastError.message });
      } else {
        console.log("SubtideX: Download started with ID:", downloadId);
        sendResponse({ status: "success", downloadId: downloadId });
        
        // Send success message back to content script
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "downloadSuccess", 
            downloadId: downloadId
          }).catch(err => {
            console.error("SubtideX: Error sending success message to content script:", err);
          });
        }
        
        // Reset processing flag
        isProcessing = false;
      }
    });
  } catch (error) {
    console.error("SubtideX: Error creating download:", error);
    sendResponse({ status: "error", error: error.message });
    isProcessing = false;
  }
}

/**
 * Handles checking if the current tab is a YouTube video
 */
function handleCheckYouTubeVideo(tab, sendResponse) {
  if (!tab || !tab.url) {
    sendResponse({ isVideoPage: false });
    return;
  }
  
  const isVideoPage = isYouTubeVideo(tab.url);
  const videoId = isVideoPage ? extractVideoId(tab.url) : null;
  
  sendResponse({ 
    isVideoPage: isVideoPage,
    videoId: videoId
  });
}

/**
 * Checks if a URL is a YouTube video page
 */
function isYouTubeVideo(url) {
  if (!url) return false;
  
  // Create URL object to parse the URL
  try {
    const urlObj = new URL(url);
    
    // Must be youtube.com or www.youtube.com or m.youtube.com
    const isYouTubeDomain = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(urlObj.hostname);
    
    // Must have /watch path
    const isWatchPath = urlObj.pathname === '/watch';
    
    // Must have v parameter
    const hasVideoParam = urlObj.searchParams.has('v');
    
    return isYouTubeDomain && isWatchPath && hasVideoParam;
  } catch (error) {
    console.error("SubtideX: Error parsing URL:", error);
    return false;
  }
}

/**
 * Extracts video ID from YouTube URL
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

function handleReloadAndExtract(tabId) {
  if (!tabId) {
    console.error("SubtideX: No tab ID provided for reload and extract");
    return;
  }
  
  // First get the current URL
  chrome.tabs.get(tabId, (tab) => {
    const currentUrl = tab.url;
    console.log("SubtideX: Processing video at URL:", currentUrl);
    
    // Reload by navigating to the same URL (forces a true reload)
    chrome.tabs.update(tabId, { url: currentUrl }, () => {
      console.log("SubtideX: Tab navigation initiated");
      
      // Set up a listener for when the reload completes
      function onTabUpdated(updatedTabId, changeInfo, tab) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          console.log("SubtideX: Tab reload completed");
          
          // Remove the listener to avoid multiple calls
          chrome.tabs.onUpdated.removeListener(onTabUpdated);
          
          // Wait a moment for the YouTube player to initialize
          setTimeout(() => {
            ensureContentScript(tabId)
              .then(() => {
                chrome.tabs.sendMessage(tabId, { action: "startExtraction" }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.error("SubtideX: Error starting extraction after reload:", chrome.runtime.lastError);
                  } else {
                    console.log("SubtideX: Extraction started after reload:", response);
                  }
                });
              })
              .catch((err) => {
                console.error("SubtideX: Could not connect after reload:", err);
              });
          }, 2000);
        }
      }
      
      // Register the listener
      chrome.tabs.onUpdated.addListener(onTabUpdated);
    });
  });
} 