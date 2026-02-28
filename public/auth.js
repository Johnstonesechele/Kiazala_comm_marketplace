const api = window.Kiazala && window.Kiazala.api;
const setToken = window.Kiazala && window.Kiazala.setToken;
const setStatus = window.Kiazala && window.Kiazala.setStatus;
const initFloatingChat = window.Kiazala && window.Kiazala.initFloatingChat;
if (!api || !setToken || !setStatus || !initFloatingChat) {
  throw new Error("Kiazala helpers not loaded. Load /common.js before /auth.js.");
}

const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const regRole = document.getElementById("reg-role");
const sellerFields = document.getElementById("seller-fields");
const registerMsg = document.getElementById("register-msg");
const loginMsg = document.getElementById("login-msg");
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const loginView = document.getElementById("login-view");
const signupView = document.getElementById("signup-view");
const forgotView = document.getElementById("forgot-view");
const openForgot = document.getElementById("open-forgot");
const backLogin = document.getElementById("back-login");
const forgotForm = document.getElementById("forgot-form");
const resetForm = document.getElementById("reset-form");
const forgotMsg = document.getElementById("forgot-msg");
const resetMsg = document.getElementById("reset-msg");

function showTab(tab) {
  const onLogin = tab === "login";
  if (onLogin) {
    loginView.classList.remove("hidden");
    signupView.classList.add("hidden");
    forgotView.classList.add("hidden");
    tabLogin.classList.remove("btn--ghost");
    tabSignup.classList.add("btn--ghost");
  } else {
    loginView.classList.add("hidden");
    signupView.classList.remove("hidden");
    forgotView.classList.add("hidden");
    tabLogin.classList.add("btn--ghost");
    tabSignup.classList.remove("btn--ghost");
  }
}

function showForgot() {
  loginView.classList.add("hidden");
  signupView.classList.add("hidden");
  forgotView.classList.remove("hidden");
  tabLogin.classList.add("btn--ghost");
  tabSignup.classList.add("btn--ghost");
}

tabLogin.addEventListener("click", (e) => {
  e.preventDefault();
  showTab("login");
});

tabSignup.addEventListener("click", (e) => {
  e.preventDefault();
  showTab("signup");
});

openForgot.addEventListener("click", () => showForgot());
backLogin.addEventListener("click", () => showTab("login"));

regRole.addEventListener("change", () => {
  sellerFields.classList.toggle("hidden", regRole.value !== "seller");
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(registerMsg, "Creating account...");

  const fd = new FormData();
  fd.append("role", regRole.value);
  fd.append("name", document.getElementById("reg-name").value);
  fd.append("email", document.getElementById("reg-email").value);
  fd.append("password", document.getElementById("reg-password").value);
  fd.append("businessName", document.getElementById("reg-business").value);
  fd.append("location", document.getElementById("reg-location").value);
  fd.append("bio", document.getElementById("reg-bio").value);

  const doc = document.getElementById("reg-doc").files[0];
  if (doc) fd.append("verificationDocument", doc);

  const registeredEmail = document.getElementById("reg-email").value;

  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: fd
    });
    setStatus(registerMsg, "[OK] " + (result.message || "Account created! You can now log in."));
    registerForm.reset();
    sellerFields.classList.add("hidden");
    setTimeout(() => {
      showTab("login");
      document.getElementById("login-email").value = registeredEmail;
      setStatus(registerMsg, "");
      setStatus(loginMsg, "Please login with your new account");
    }, 700);
  } catch (error) {
    setStatus(registerMsg, "[ERROR] " + (error.message || "Registration failed. Please try again."), true);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(loginMsg, "Logging in...");

  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value
      })
    });

    if (!result.token) {
      throw new Error("No token received from server");
    }

    setToken(result.token);
    setStatus(loginMsg, "[OK] Login successful! Redirecting...");

    setTimeout(() => {
      window.location.href = "/marketplace";
    }, 400);
  } catch (error) {
    setStatus(loginMsg, error.message || "Login failed. Please check your credentials.", true);
  }
});

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(forgotMsg, "Generating reset token...");
  try {
    const result = await api("/api/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("forgot-email").value
      })
    });
    if (result.resetToken) {
      document.getElementById("reset-token").value = result.resetToken;
    }
    setStatus(forgotMsg, result.message || "If the email exists, reset token generated.");
  } catch (error) {
    setStatus(forgotMsg, error.message || "Could not generate reset token.", true);
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(resetMsg, "Resetting password...");
  try {
    const result = await api("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        token: document.getElementById("reset-token").value,
        newPassword: document.getElementById("reset-password").value
      })
    });
    setStatus(resetMsg, result.message || "Password reset successful.");
    resetForm.reset();
    setTimeout(() => {
      showTab("login");
      setStatus(loginMsg, "Password changed. Login with your new password.");
    }, 800);
  } catch (error) {
    setStatus(resetMsg, error.message || "Reset failed.", true);
  }
});

initFloatingChat();
showTab("login");
