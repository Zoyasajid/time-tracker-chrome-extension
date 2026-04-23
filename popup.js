import { signInWithEmailAndPassword, signOut } from "./firebase.js";

// ---- DOM Elements ----
const loginBox = document.getElementById("loginBox");
const userBox = document.getElementById("userBox");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const userEmail = document.getElementById("userEmail");
const trackerTime = document.getElementById("trackerTime");
const stopSharingBtn = document.getElementById("stopSharingBtn");
let trackerTimerInterval = null;
// ---- Stop Sharing Button Handler ----
console.log("Stop Sharing Button:", stopSharingBtn);
if (stopSharingBtn) {
  stopSharingBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "STOP_SESSION" });
    // Optionally, update UI immediately
    chrome.storage.local.remove("session", updateUI);
  });
}

// ---- Screenshot Toast Notification ----
function showScreenshotToast() {
  const toast = document.getElementById("screenshotToast");
  if (!toast) return;
  toast.style.display = "block";
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) scale(1.08)";
  setTimeout(() => {
    toast.style.transform = "translateX(-50%) scale(1)";
    toast.style.opacity = "0.95";
  }, 80);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) scale(0.95)";
  }, 1200);
  setTimeout(() => {
    toast.style.display = "none";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) scale(1)";
  }, 1700);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "SCREENSHOT_SUCCESS") {
    showScreenshotToast();
  }
});

// ---- UI State Management ----
function showUser(user) {
  loginBox.classList.add("hidden");
  userBox.classList.remove("hidden");
  userEmail.innerText = user.email;
}

function updateUI() {
  chrome.storage.local.get(["user", "session"], (res) => {
    if (res.user) {
      showUser(res.user);
      if (res.session) {
        startBtn.classList.add("hidden");
        stopBtn.classList.remove("hidden");
        startTrackerTimer(res.session.sessionStartTime);
      } else {
        startBtn.classList.remove("hidden");
        stopBtn.classList.add("hidden");
        stopTrackerTimer();
      }
      logoutBtn.classList.remove("hidden");
    } else {
      loginBox.classList.remove("hidden");
      userBox.classList.add("hidden");
    }
  });
}

// ---- Tracker Timer ----
function startTrackerTimer(sessionStartTime) {
  stopTrackerTimer();
  if (!trackerTime) return;
  if (!sessionStartTime) {
    trackerTime.innerText = "Time: 00h 00m 00s";
    return;
  }
  function update() {
    const now = Date.now();
    const elapsed = now - sessionStartTime;
    trackerTime.innerText = "Time: " + formatTime(elapsed);
  }
  update();
  trackerTimerInterval = setInterval(update, 1000);
}

function stopTrackerTimer() {
  if (trackerTimerInterval) {
    clearInterval(trackerTimerInterval);
    trackerTimerInterval = null;
  }
  if (trackerTime) trackerTime.innerText = "Time: 00h 00m 00s";
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

// ---- Event Listeners ----
updateUI();
chrome.storage.onChanged.addListener(updateUI);

loginBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }
  try {
    const user = await signInWithEmailAndPassword(email, password);
    const userData = {
      uid: user.uid,
      email: user.email,
      idToken: user.idToken,
      refreshToken: user.refreshToken,
    };
    chrome.storage.local.set({ user: userData });
    showUser(userData);
  } catch (err) {
    alert("Login failed: " + err.message);
    console.log(err);
  }
});

startBtn.addEventListener("click", async () => {
  alert(
    "Please select 'Entire Screen' to enable tracking.\n\nYou will be prompted to pick a screen.\n\nTracking will only start if you select 'Entire Screen'.",
  );
  chrome.runtime.sendMessage({ type: "START_SESSION" });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_SESSION" });
});

logoutBtn.addEventListener("click", async () => {
  chrome.storage.local.get("session", async (res) => {
    if (res.session) {
      chrome.runtime.sendMessage({ type: "STOP_SESSION" }, async () => {
        await signOut();
        chrome.storage.local.remove("user");
        loginBox.classList.remove("hidden");
        userBox.classList.add("hidden");
      });
    } else {
      await signOut();
      chrome.storage.local.remove("user");
      loginBox.classList.remove("hidden");
      userBox.classList.add("hidden");
    }
  });
});
