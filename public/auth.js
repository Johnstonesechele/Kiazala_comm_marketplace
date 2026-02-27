// Only destructure if not already declared
if (typeof api === "undefined") {
  const { api, setToken, setStatus, initFloatingChat } = window.Kiazala;
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

function showTab(tab) {
  const onLogin = tab === "login";
  if (onLogin) {
    loginView.classList.remove("hidden");
    signupView.classList.add("hidden");
    tabLogin.classList.remove("btn--ghost");
    tabSignup.classList.add("btn--ghost");
  } else {
    loginView.classList.add("hidden");
    signupView.classList.remove("hidden");
    tabLogin.classList.add("btn--ghost");
    tabSignup.classList.remove("btn--ghost");
  }
}

tabLogin.addEventListener("click", (e) => {
  e.preventDefault();
  showTab("login");
});

tabSignup.addEventListener("click", (e) => {
  e.preventDefault();
  showTab("signup");
});

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
    setStatus(registerMsg, "✓ " + (result.message || "Account created! You can now log in."));
    registerForm.reset();
    sellerFields.classList.add("hidden");
    // Auto-switch to login tab after successful registration
    setTimeout(() => {
      showTab("login");
      document.getElementById("login-email").value = registeredEmail;
      setStatus(registerMsg, "");
      setStatus(loginMsg, "Please login with your new account");
    }, 2000);
  } catch (error) {
    console.error("Registration error:", error);
    setStatus(registerMsg, "✗ " + (error.message || "Registration failed. Please try again."), true);
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
    setStatus(loginMsg, "✓ Login successful! Redirecting...");
    
    // Small delay to show success message
    setTimeout(() => {
      window.location.href = "/marketplace";
    }, 500);
  } catch (error) {
    console.error("Login error:", error);
    setStatus(loginMsg, error.message || "Login failed. Please check your credentials.", true);
  }
});

initFloatingChat();
showTab("login");
