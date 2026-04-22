// offscreen.js
// Handles screen capture and screenshot logic for background use

let screenStream = null;
let videoElement = null;
let canvasElement = null;
let captureInterval = null;

// Listen for messages from background.js
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "START_SCREEN_CAPTURE") {
    const granted = await requestScreenCapturePermission();
    sendResponse({ granted });
    return true;
  }
  if (message.type === "STOP_SCREEN_CAPTURE") {
    stopScreenCapture();
    sendResponse({ stopped: true });
    return true;
  }
  if (message.type === "CAPTURE_SCREENSHOT") {
    const screenshot = await captureScreenshot();
    sendResponse({ screenshot });
    return true;
  }
  if (message.type === "START_SCREENSHOT_LOOP") {
    startScreenshotLoop();
    sendResponse && sendResponse({ started: true });
    return true;
  }
  if (message.type === "STOP_SCREENSHOT_LOOP") {
    stopScreenshotLoop();
    sendResponse && sendResponse({ stopped: true });
    return true;
  }
});

async function requestScreenCapturePermission() {
  try {
    // Show instruction before capture (offscreen context, so use notification)
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon.png",
        title: "Screen Capture",
        message: "Please select Entire Screen to enable tracking.",
        priority: 2,
      });
    }
    // Only the monitor selected by the user will be captured.
    // Multi-monitor: user must select the desired screen. We do not assume both screens are captured.
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false,
    });
    // Check if user selected 'Entire Screen'
    const track = screenStream.getVideoTracks()[0];
    const settings = track.getSettings();
    if (settings.displaySurface !== "monitor") {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
      if (chrome.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon.png",
          title: "Screen Selection Required",
          message: "Please select Entire Screen to continue.",
          priority: 2,
        });
      }
      return false;
    }
    // Listen for stream end (user stops sharing)
    track.onended = () => {
      stopScreenCapture();
      if (chrome.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon.png",
          title: "Screen Capture Ended",
          message: "Screen sharing ended. Session stopped.",
          priority: 2,
        });
      }
      chrome.runtime.sendMessage({ type: "SCREEN_CAPTURE_ENDED" });
    };
    return true;
  } catch (e) {
    screenStream = null;
    if (e && e.name === "NotAllowedError") {
      if (chrome.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon.png",
          title: "Screen Capture Cancelled",
          message: "Screen capture cancelled.",
          priority: 2,
        });
      }
    }
    return false;
  }
}

function stopScreenCapture() {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  if (videoElement) {
    videoElement.remove();
    videoElement = null;
  }
  if (canvasElement) {
    canvasElement.remove();
    canvasElement = null;
  }
  stopPeriodicCapture();
}

async function captureScreenshot() {
  if (!screenStream) return null;
  if (!videoElement) {
    videoElement = document.createElement("video");
    videoElement.style.display = "none";
    document.body.appendChild(videoElement);
  }
  if (!canvasElement) {
    canvasElement = document.createElement("canvas");
    canvasElement.style.display = "none";
    document.body.appendChild(canvasElement);
  }
  videoElement.srcObject = screenStream;
  await videoElement.play();
  await new Promise((resolve) => {
    if (videoElement.readyState >= 2) return resolve();
    videoElement.onloadeddata = resolve;
  });
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
  const ctx = canvasElement.getContext("2d");
  ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
  // Convert to JPEG blob and upload to Cloudinary, return URL
  return new Promise((resolve) => {
    canvasElement.toBlob(
      async (blob) => {
        if (!blob) return resolve(null);
        try {
          const formData = new FormData();
          formData.append("file", blob);
          formData.append("upload_preset", "nuxt_unsigned");
          const response = await fetch(
            "https://api.cloudinary.com/v1_1/dlyktw5s5/image/upload",
            {
              method: "POST",
              body: formData,
            },
          );
          if (!response.ok) {
            const err = await response.text();
            console.error("Cloudinary upload failed:", err);
            resolve(null);
            return;
          }
          const data = await response.json();
          console.log("Cloudinary upload success:", data);
          resolve(data.secure_url || null);
        } catch (e) {
          console.error("Cloudinary upload error:", e);
          resolve(null);
        }
      },
      "image/jpeg",
      0.6,
    );
  });
}

// Screenshot loop logic
let screenshotLoopInterval = null;
const SCREENSHOT_LOOP_INTERVAL_MS = 900000; // 15 minutes

function startScreenshotLoop() {
  stopScreenshotLoop();
  screenshotLoopInterval = setInterval(async () => {
    if (!screenStream) return;
    const imageUrl = await captureScreenshot();
    if (imageUrl) {
      chrome.runtime.sendMessage({
        type: "PERIODIC_SCREENSHOT",
        screenshot: imageUrl,
      });
    }
  }, SCREENSHOT_LOOP_INTERVAL_MS);
  // Take first screenshot immediately
  (async () => {
    if (!screenStream) return;
    const imageUrl = await captureScreenshot();
    if (imageUrl) {
      chrome.runtime.sendMessage({
        type: "PERIODIC_SCREENSHOT",
        screenshot: imageUrl,
      });
    }
  })();
}

function stopScreenshotLoop() {
  if (screenshotLoopInterval) {
    clearInterval(screenshotLoopInterval);
    screenshotLoopInterval = null;
  }
}
