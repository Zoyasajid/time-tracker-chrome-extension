const user = localStorage.getItem("incitertech_user");

if (user) {
  const parsedUser = JSON.parse(user);

  chrome.runtime.sendMessage({
    type: "USER_DATA",
    user: parsedUser,
  });
}
