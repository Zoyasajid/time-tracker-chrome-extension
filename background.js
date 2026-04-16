const API_KEY = "AIzaSyDZi7ARPwDvj9Ea5w7ZNTlFPxeH5FqRl2w";
const PROJECT_ID = "employee-management-12704";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/screenshots`;
const ALARM_NAME = "screenshot-timer";

// ── Helpers ──

const genSessionId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

// Random delay for next screenshot (in minutes)
function randomDelayMinutes() {
  return 0.5;
  // return 0.5 + Math.random() * 14.5; // between 30s and 15 minutes
}

// ── Load state from storage ──

async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["user", "tracking", "totalTime"], (res) => {
      resolve({
        user: res.user || null,
        tracking: res.tracking || null,
        totalTime: res.totalTime || 0,
      });
    });
  });
}

// ── Firebase Auth Token Refresh ──

async function refreshToken(user) {
  if (!user?.refreshToken) return user;
  try {
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: user.refreshToken,
        }),
      },
    );
    const data = await res.json();
    if (res.ok) {
      user.idToken = data.id_token;
      user.refreshToken = data.refresh_token;
      await chrome.storage.local.set({ user });
    }
  } catch (e) {
    console.error("Token refresh failed:", e);
  }
  return user;
}

// ── Firestore Save (with auto-retry on 401) ──

async function saveToFirestore(fields, user) {
  const body = JSON.stringify({ fields });
  const headers = () => ({
    Authorization: `Bearer ${user.idToken}`,
    "Content-Type": "application/json",
  });

  let res = await fetch(FIRESTORE_URL, {
    method: "POST",
    headers: headers(),
    body,
  });
  if (res.status === 401 || res.status === 403) {
    user = await refreshToken(user);
    res = await fetch(FIRESTORE_URL, {
      method: "POST",
      headers: headers(),
      body,
    });
  }
  if (!res.ok) throw new Error("Firestore save failed: " + res.status);
}

// ── Capture Screenshot & Save ──

async function captureAndSave() {
  const { user, tracking } = await getState();
  if (!user || !tracking) {
    console.log("📸 Skipped — no user or tracking inactive");
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      console.log("📸 Skipped — no active tab");
      scheduleNextCapture();
      return;
    }

    // captureVisibleTab fails on chrome:// and other restricted pages
    let screenshot;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(null, {
        format: "png",
      });
    } catch (captureErr) {
      console.log("📸 Skipped — cannot capture this page:", tab.url);
      scheduleNextCapture();
      return;
    }

    await saveToFirestore(
      {
        userId: { stringValue: user.uid },
        timestamp: { integerValue: String(Date.now()) },
        sessionId: { stringValue: tracking.sessionId },
        screenshot: { stringValue: screenshot },
        activeTabUrl: { stringValue: tab?.url || "unknown" },
      },
      user,
    );

    const elapsed = Date.now() - tracking.startTime;
    console.log(
      `📸 Saved | Session: ${formatTime(elapsed)} | Tab: ${tab?.url || "unknown"}`,
    );
  } catch (e) {
    console.error("📸 Error:", e.message);
  }

  scheduleNextCapture();
}

// ── Schedule next random capture ──

async function scheduleNextCapture() {
  const delay = randomDelayMinutes();
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: delay });
  console.log(`⏰ Next screenshot in ${Math.round(delay * 60)}s`);
}

// ── Start / Stop Tracking ──

async function startTracking(mode) {
  const { user, tracking } = await getState();
  if (!user || tracking) return;

  const sessionData = {
    sessionId: genSessionId(),
    startTime: Date.now(),
  };

  await chrome.storage.local.set({ tracking: sessionData });
  console.log(
    `🟢 Started (${mode}) | ${user.email} | ${sessionData.sessionId}`,
  );

  captureAndSave(); // First capture immediately
}

async function stopTracking(mode) {
  const { user, tracking, totalTime } = await getState();
  if (!tracking) return;

  const duration = Date.now() - tracking.startTime;

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.local.remove("tracking");
  await chrome.storage.local.set({ totalTime: totalTime + duration });

  console.log(
    `🔴 Stopped (${mode}) | ${user?.email} | Session: ${formatTime(duration)}`,
  );
}

// ── Alarm listener (wakes service worker for each capture) ──

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    captureAndSave();
  }
});

// ── On startup: resume tracking if was active ──

async function init() {
  const { user, tracking } = await getState();
  if (user && tracking) {
    // Only schedule if no alarm already exists
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      console.log("👤 Resumed tracking for:", user.email);
      scheduleNextCapture();
    } else {
      console.log(
        "👤 Resumed tracking for:",
        user.email,
        "| Alarm already set",
      );
    }
  } else if (user) {
    console.log("👤 Loaded:", user.email);
  }
}

init();

// ── Listen for login/logout ──

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.user) return;
  if (changes.user.newValue) {
    console.log("👤 Logged in:", changes.user.newValue.email);
    startTracking("login");
  } else {
    console.log("👤 Logged out");
    stopTracking("logout");
  }
});

// ── Idle Detection ──

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "idle" || state === "locked") stopTracking("idle");
  else getState().then(({ user }) => user && startTracking("resume"));
});

chrome.runtime.onStartup.addListener(init);
