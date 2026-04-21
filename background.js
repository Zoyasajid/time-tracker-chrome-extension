// ── Listen for session control messages from popup.js ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_SESSION") {
    startSession();
    sendResponse && sendResponse({ ok: true });
    return true;
  }
  if (message.type === "STOP_SESSION") {
    stopSession();
    sendResponse && sendResponse({ ok: true });
    return true;
  }
});
const API_KEY = "AIzaSyDZi7ARPwDvj9Ea5w7ZNTlFPxeH5FqRl2w";
const PROJECT_ID = "employee-management-12704";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/screenshots`;
const ALARM_NAME = "screenshot-timer";

// ── Helpers ──

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

function toSeconds(ms) {
  return Math.round(ms / 1000);
}

function randomDelayMinutes() {
  return 0.5;
  // return 30; // between 30s and 15 minutes
}

async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["user", "session", "totalTime"], (res) => {
      resolve({
        user: res.user || null,
        session: res.session || null,
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
  const { user, session } = await getState();
  if (!user || !session) {
    console.log("📸 Skipped — no user or session inactive");
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
        sessionId: { stringValue: session.sessionId },
        screenshot: { stringValue: screenshot },
        activeTabUrl: { stringValue: tab?.url || "unknown" },
      },
      user,
    );

    // Notify all extension views (including popup) of screenshot success
    // Suppress error if no receiving end (e.g., popup not open)
    // Always attach .catch to suppress 'no receiving end' error
    chrome.runtime.sendMessage({ type: "SCREENSHOT_SUCCESS" }).catch(() => {});
    // Show Chrome notification for screenshot success
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon.png",
        title: "Screenshot captured",
        message: "A screenshot was successfully taken.",
        priority: 0,
      });
    }

    // Log the required data structure dynamically
    const times = calculateTimes(session);
    console.log(
      `📸 Saved | Total: ${formatTime(times.totalSessionTime)} | Active: ${formatTime(times.activeTime)} | Idle: ${formatTime(times.totalIdleTime)} | Tab: ${tab?.url || "unknown"}`,
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

// ── Time Calculation ──

function calculateTimes(session) {
  const now = Date.now();
  const totalSessionTime = now - session.sessionStartTime;

  // If currently idle, include the ongoing idle period
  let currentIdleDuration = 0;
  if (session.idleStart) {
    currentIdleDuration = now - session.idleStart;
  }

  const totalIdleTime = (session.totalIdleTime || 0) + currentIdleDuration;
  const activeTime = totalSessionTime - totalIdleTime;

  return { totalSessionTime, totalIdleTime, activeTime };
}

// ── Session Start (Manual — login) ──

async function startSession() {
  const { user, session } = await getState();
  if (!user) {
    console.log("⚠️ Cannot start session — no user logged in");
    return;
  }

  // Prevent duplicate session starts
  if (session) {
    console.log("⚠️ Session already active — ignoring duplicate start");
    return;
  }

  // Create session doc in Firestore and use docId as sessionId
  const SESSIONS_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/sessions`;
  const startTime = Date.now();
  const sessionFields = {
    startTime: { timestampValue: new Date(startTime).toISOString() },
    idleTime: { integerValue: "0" },
    activeTime: { integerValue: "0" },
    duration: { integerValue: "0" },
    userId: { stringValue: user.uid },
  };
  try {
    const res = await fetch(SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: sessionFields }),
    });
    if (!res.ok) throw new Error("Failed to create session doc");
    const data = await res.json();
    // docId is the last segment of the name field
    const docId = data.name.split("/").pop();
    const sessionData = {
      sessionId: docId,
      sessionStartTime: startTime,
      totalIdleTime: 0,
      idleStart: null,
      userId: user.uid,
    };
    await chrome.storage.local.set({ session: sessionData });
    console.log("══════════════════════════════════════════");
    console.log("🟢 SESSION STARTED");
    console.log(`   User: ${user.email} (${user.uid})`);
    console.log(`   Session ID: ${docId}`);
    console.log(`   Start Time: ${new Date(startTime).toLocaleString()}`);
    console.log("══════════════════════════════════════════");
    captureAndSave(); // First capture immediately
  } catch (e) {
    console.error("Failed to start session:", e);
  }
}

// ── Session Stop (Manual — logout) ──

async function stopSession(logoutUser) {
  const { user, session, totalTime } = await getState();
  // Use passed-in user (captured before storage removal) or fallback to storage
  const sessionUser = logoutUser || user;
  if (!session) {
    console.log("⚠️ No active session to stop");
    return;
  }

  const times = calculateTimes(session);

  // PATCH session doc in Firestore using docId as sessionId
  const docId = session.sessionId;
  const endDate = new Date();
  const PATCH_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/sessions/${docId}?updateMask.fieldPaths=endTime&updateMask.fieldPaths=duration&updateMask.fieldPaths=idleTime&updateMask.fieldPaths=activeTime`;
  const sessionPatch = {
    fields: {
      endTime: { timestampValue: endDate.toISOString() },
      duration: { integerValue: String(times.totalSessionTime) },
      idleTime: { integerValue: String(times.totalIdleTime) },
      activeTime: { integerValue: String(times.activeTime) },
    },
  };
  try {
    await fetch(PATCH_URL, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${sessionUser?.idToken || user?.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionPatch),
    });
    console.log("[Session] Data updated in Firestore.");
  } catch (e) {
    console.error("[Session] Failed to update:", e);
  }

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.local.remove("session");
  await chrome.storage.local.set({
    totalTime: totalTime + times.totalSessionTime,
  });

  console.log("══════════════════════════════════════════");
  console.log("🔴 SESSION ENDED");
  console.log(
    `   User: ${sessionUser?.email || "unknown"} (${sessionUser?.uid || "unknown"})`,
  );
  console.log(`   Session ID: ${session.sessionId}`);
  console.log(
    `   Start Time: ${new Date(session.sessionStartTime).toLocaleString()}`,
  );
  console.log(`   End Time:   ${new Date().toLocaleString()}`);
  console.log("──────────────────────────────────────────");
  console.log(
    `   Total Session Time: ${formatTime(times.totalSessionTime)} (${toSeconds(times.totalSessionTime)}s)`,
  );
  console.log(
    `   Total Idle Time:    ${formatTime(times.totalIdleTime)} (${toSeconds(times.totalIdleTime)}s)`,
  );
  console.log(
    `   Active Time:        ${formatTime(times.activeTime)} (${toSeconds(times.activeTime)}s)`,
  );
  console.log("══════════════════════════════════════════");
}

// ── Idle Handling (separate from session control) ──

async function handleIdleStart() {
  const { session } = await getState();
  if (!session) return;

  // Already tracking an idle period
  if (session.idleStart) {
    console.log("⏸️ Idle already being tracked — ignoring duplicate");
    return;
  }

  session.idleStart = Date.now();
  await chrome.storage.local.set({ session });

  console.log("──────────────────────────────────────────");
  console.log("⏸️ IDLE STARTED");
  console.log(`   Idle Start: ${new Date(session.idleStart).toLocaleString()}`);
  console.log(`   Session still running...`);
  console.log("──────────────────────────────────────────");
}

async function handleIdleEnd() {
  const { session } = await getState();
  if (!session) return;

  // No idle period was being tracked
  if (!session.idleStart) {
    console.log("▶️ Active state but no idle period was tracked — ignoring");
    return;
  }

  const idleDuration = Date.now() - session.idleStart;
  session.totalIdleTime = (session.totalIdleTime || 0) + idleDuration;
  session.idleStart = null;
  await chrome.storage.local.set({ session });

  const times = calculateTimes(session);

  console.log("──────────────────────────────────────────");
  console.log("▶️ IDLE ENDED — User is active again");
  console.log(
    `   Idle Duration:      ${formatTime(idleDuration)} (${toSeconds(idleDuration)}s)`,
  );
  console.log(
    `   Total Idle So Far:  ${formatTime(times.totalIdleTime)} (${toSeconds(times.totalIdleTime)}s)`,
  );
  console.log(
    `   Total Session Time: ${formatTime(times.totalSessionTime)} (${toSeconds(times.totalSessionTime)}s)`,
  );
  console.log(
    `   Active Time:        ${formatTime(times.activeTime)} (${toSeconds(times.activeTime)}s)`,
  );
  console.log("──────────────────────────────────────────");
}

// ── Alarm listener (wakes service worker for each capture) ──

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    captureAndSave();
  }
});

// ── On startup: resume session if was active ──

async function init() {
  const { user, session } = await getState();
  if (user && session) {
    const times = calculateTimes(session);
    console.log(
      `👤 Resumed session for: ${user.email} | Total: ${formatTime(times.totalSessionTime)} | Active: ${formatTime(times.activeTime)} | Idle: ${formatTime(times.totalIdleTime)}`,
    );

    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      scheduleNextCapture();
    }
  } else if (user) {
    console.log("👤 Loaded:", user.email, "| No active session");
  }
}

init();

// ── Listen for login/logout (manual session control) ──

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.user) return;
  if (changes.user.newValue) {
    console.log("👤 Logged in:", changes.user.newValue.email);
    startSession();
  } else {
    // Capture user details before they are removed from storage
    const logoutUser = changes.user.oldValue || null;
    console.log("👤 Logged out:", logoutUser?.email || "unknown");
    stopSession(logoutUser);
  }
});

// ── Idle Detection (does NOT stop session — only tracks idle time) ──
// Set idle detection threshold to 30 seconds
chrome.idle.setDetectionInterval(30);

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "idle" || state === "locked") {
    handleIdleStart();
  } else if (state === "active") {
    handleIdleEnd();
  }
});

chrome.runtime.onStartup.addListener(init);
