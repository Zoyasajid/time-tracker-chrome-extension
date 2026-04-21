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
import { signInWithEmailAndPassword, signOut } from "./firebase.js";

const loginBox = document.getElementById("loginBox");
const userBox = document.getElementById("userBox");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const userEmail = document.getElementById("userEmail");

// ---------- Check login and session state ----------
function updateUI() {
  chrome.storage.local.get(["user", "session"], (res) => {
    if (res.user) {
      showUser(res.user);
      if (res.session) {
        // Session active: show Stop and Logout
        startBtn.classList.add("hidden");
        stopBtn.classList.remove("hidden");
      } else {
        // No session: show Start and Logout
        startBtn.classList.remove("hidden");
        stopBtn.classList.add("hidden");
      }
      logoutBtn.classList.remove("hidden");
    } else {
      // Not logged in
      loginBox.classList.remove("hidden");
      userBox.classList.add("hidden");
    }
  });
}

updateUI();
chrome.storage.onChanged.addListener(updateUI);

// ---------- Login ----------
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

// ---------- Start Session ----------
startBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "START_SESSION" });
});

// ---------- Stop Session ----------
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_SESSION" });
});

// ---------- Logout ----------
logoutBtn.addEventListener("click", async () => {
  // End session if active, then logout
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

// ---------- UI switch ----------

function showUser(user) {
  loginBox.classList.add("hidden");
  userBox.classList.remove("hidden");
  userEmail.innerText = user.email;
}
