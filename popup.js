import { signInWithEmailAndPassword, signOut } from "./firebase.js";

const loginBox = document.getElementById("loginBox");
const userBox = document.getElementById("userBox");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const userEmail = document.getElementById("userEmail");

// ---------- Check login state ----------
chrome.storage.local.get("user", (res) => {
  if (res.user) {
    showUser(res.user);
  }
});

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

// ---------- Logout ----------
logoutBtn.addEventListener("click", async () => {
  await signOut();

  chrome.storage.local.remove("user");

  loginBox.classList.remove("hidden");
  userBox.classList.add("hidden");
});

// ---------- UI switch ----------
function showUser(user) {
  loginBox.classList.add("hidden");
  userBox.classList.remove("hidden");

  userEmail.innerText = user.email;
}
