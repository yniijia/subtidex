document.addEventListener('DOMContentLoaded', () => {
  const statusMessage = document.getElementById('status-message');
  const statusText = document.getElementById('status-text');
  const messageText = document.getElementById('message-text');
  const youtubeButton = document.getElementById('youtube-button');
  const youtubeButtonLabel = document.getElementById('youtube-button-label');
  const extractButton = document.getElementById('extract-button');
  const extractButtonLabel = document.getElementById('extract-button-label');
  const alertBox = document.getElementById('alert-box');
  const videoCard = document.getElementById('video-card');
  const videoThumb = document.getElementById('video-thumb');
  const videoTitleEl = document.getElementById('video-title');
  const videoUrlEl = document.getElementById('video-url');
  const stepsHint = document.getElementById('steps-hint');

  chrome.runtime.sendMessage({ action: 'popupOpened' });
  window.addEventListener('unload', () => chrome.runtime.sendMessage({ action: 'popupClosed' }));

  checkCurrentPage();

  if (youtubeButton) {
    youtubeButton.addEventListener('click', (e) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.url?.includes('youtube.com')) {
          e.preventDefault();
          chrome.tabs.update(tab.id, { url: 'https://www.youtube.com/feed/trending' });
          window.close();
        }
      });
    });
  }

  if (extractButton) {
    extractButton.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab) return;

        setStatus('waiting', 'Starting extraction…');
        messageText.textContent = 'Watch the bottom-right panel on YouTube for live progress.';
        extractButton.disabled = true;
        extractButtonLabel.textContent = 'Working…';
        hideAlert();

        chrome.runtime.sendMessage({ action: 'startExtraction', tabId: tab.id }, (response) => {
          if (chrome.runtime.lastError) {
            showError(chrome.runtime.lastError.message);
            return;
          }
          if (!response) {
            showError('No response from extension.');
            return;
          }
          if (response.status === 'error') {
            showError(response.error || 'Failed to start extraction.');
            return;
          }
          setTimeout(() => window.close(), 400);
        });
      });
    });
  }

  function setStatus(type, text) {
    statusMessage.className = `tidal-status tidal-status--${type}`;
    statusText.textContent = text;
  }

  function showError(errorMessage) {
    setStatus('error', 'Something went wrong');
    extractButton.disabled = false;
    extractButtonLabel.textContent = 'Try again';
    alertBox.hidden = false;
    alertBox.classList.remove('is-hidden');
    alertBox.classList.add('tidal-alert--error');
    alertBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(errorMessage || 'Failed to communicate with the page.')}`;
  }

  function hideAlert() {
    alertBox.hidden = true;
    alertBox.classList.add('is-hidden');
    alertBox.classList.remove('tidal-alert--error');
    alertBox.innerHTML = '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseVideoId(url) {
    try {
      return new URL(url).searchParams.get('v');
    } catch {
      return null;
    }
  }

  function cleanYouTubeTitle(title) {
    return (title || '')
      .replace(/\s*-\s*YouTube\s*$/i, '')
      .trim() || 'YouTube video';
  }

  function showVideoCard({ title, url, videoId, thumbnail }) {
    videoCard.classList.add('is-visible');
    videoTitleEl.textContent = title;
    videoUrlEl.textContent = url.replace(/^https?:\/\//, '');
    if (thumbnail) {
      videoThumb.src = thumbnail;
      videoThumb.alt = title;
    } else if (videoId) {
      videoThumb.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      videoThumb.alt = title;
    }
  }

  function fetchVideoInfoFromTab(tab, callback) {
    if (!tab?.id) {
      callback(null);
      return;
    }

    const fallback = () => {
      const videoId = parseVideoId(tab.url);
      callback({
        title: cleanYouTubeTitle(tab.title),
        url: tab.url,
        videoId,
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
      });
    };

    chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' }, (response) => {
      if (chrome.runtime.lastError || !response?.isVideoPage) {
        fallback();
        return;
      }
      callback(response);
    });
  }

  function checkCurrentPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.url) {
        showNotYouTubeState();
        return;
      }

      let urlObj;
      try {
        urlObj = new URL(tab.url);
      } catch {
        showNotYouTubeState();
        return;
      }

      const isYouTube = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(urlObj.hostname);
      const isVideoPage = isYouTube && urlObj.pathname === '/watch' && urlObj.searchParams.has('v');

      if (isVideoPage) {
        fetchVideoInfoFromTab(tab, (info) => {
          showVideoPageState(info || {
            title: cleanYouTubeTitle(tab.title),
            url: tab.url,
            videoId: parseVideoId(tab.url),
          });
        });
      } else if (isYouTube) {
        showYouTubeNonVideoState();
      } else {
        showNotYouTubeState();
      }
    });
  }

  function showVideoPageState(info) {
    setStatus('ready', 'Ready to download');
    messageText.textContent = 'We\'ll open the transcript panel, read the captions, and save a CSV for you.';
    showVideoCard(info);
    youtubeButton.classList.add('is-hidden');
    extractButton.classList.remove('is-hidden');
    stepsHint.classList.remove('is-hidden');
    hideAlert();
  }

  function showYouTubeNonVideoState() {
    setStatus('waiting', 'Not on a video page');
    messageText.textContent = 'Navigate to any YouTube video to download its captions.';
    youtubeButtonLabel.textContent = 'Browse videos';
    youtubeButton.href = 'https://www.youtube.com/feed/trending';
    extractButton.classList.add('is-hidden');
    stepsHint.classList.add('is-hidden');
    showTip('This extension works on watch pages — URLs with <strong>youtube.com/watch?v=…</strong>');
  }

  function showNotYouTubeState() {
    setStatus('waiting', 'Not on YouTube');
    messageText.textContent = 'Open a YouTube video, then click the SubtideX icon again.';
    youtubeButtonLabel.textContent = 'Go to YouTube';
    youtubeButton.href = 'https://www.youtube.com';
    extractButton.classList.add('is-hidden');
    stepsHint.classList.add('is-hidden');
    hideAlert();
  }

  function showTip(html) {
    alertBox.hidden = false;
    alertBox.classList.remove('is-hidden', 'tidal-alert--error');
    alertBox.innerHTML = html;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'downloadSuccess') {
      setStatus('ready', 'Download started');
      messageText.textContent = 'Check your Downloads folder for the CSV file.';
      extractButton.disabled = false;
      extractButtonLabel.textContent = 'Download again';
    } else if (message.action === 'error') {
      showError(message.error || 'Extraction failed');
    }
    return true;
  });
});
