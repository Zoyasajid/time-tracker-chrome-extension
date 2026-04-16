const firebaseConfig = {
  apiKey: "AIzaSyDZi7ARPwDvj9Ea5w7ZNTlFPxeH5FqRl2w",
  authDomain: "employee-management-12704.firebaseapp.com",
  projectId: "employee-management-12704",
};

export async function signInWithEmailAndPassword(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Login failed");
  }

  return {
    uid: data.localId,
    email: data.email,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
  };
}

export async function signOut() {
  return;
}
