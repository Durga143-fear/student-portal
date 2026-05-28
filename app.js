import { authConfig } from "./auth-config.js";

function startStudentPortal() {
const form = document.querySelector("#studentForm");
const modeLabel = document.querySelector("#modeLabel");
const formTitle = document.querySelector("#formTitle");
const modeToggle = document.querySelector("#modeToggle");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const signupFields = document.querySelector(".signup-fields");
const logoutButton = document.querySelector("#logoutButton");
const notice = document.querySelector("#authNotice");
const authBadge = document.querySelector("#authBadge");
const forgotPassword = document.querySelector("#forgotPassword");

if (
  !form ||
  !modeLabel ||
  !formTitle ||
  !modeToggle ||
  !submitButton ||
  !message ||
  !signupFields ||
  !logoutButton ||
  !notice ||
  !authBadge ||
  !forgotPassword
) {
  console.error("Student portal markup is missing one or more required elements.");
  return;
}

const DEMO_USERS_KEY = "student_connect_demo_users";
const DEMO_SESSION_KEY = "student_connect_demo_session";
const DEFAULT_COURSE = "B.Sc Computer Science";
const STUDENTS_TABLE = "students";

let mode = "signup";
let client = null;
let usingSupabase = false;

function isConfigured(value) {
  return value && !value.includes("YOUR_") && !value.includes("PROJECT_REF");
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function getInitials(name = "") {
  const cleanName = name.trim();
  if (!cleanName) return "ST";

  return cleanName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function getDemoUsers() {
  return JSON.parse(localStorage.getItem(DEMO_USERS_KEY) || "{}");
}

function saveDemoUsers(users) {
  localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(users));
}

function setMessage(text, isOk = false) {
  message.textContent = text;
  message.classList.toggle("ok", isOk);
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading
    ? "Please wait..."
    : mode === "signup"
      ? "Create account"
      : "Login to dashboard";
}

function fallbackProfile(user) {
  const metadata = user?.user_metadata || {};
  const email = user?.email || metadata.email || "";

  return {
    id: user?.id || metadata.id || crypto.randomUUID(),
    name: metadata.full_name || metadata.name || email.split("@")[0] || "Student",
    email,
    roll: metadata.roll || metadata.roll_number || "Not added",
    course: metadata.course || DEFAULT_COURSE,
  };
}

function tableProfile(row, user) {
  const fallback = fallbackProfile(user);

  return {
    id: row?.id || fallback.id,
    name: row?.full_name || fallback.name,
    email: row?.email || fallback.email,
    roll: row?.roll_number || fallback.roll,
    course: row?.course || fallback.course,
  };
}

function formData() {
  return {
    name: form.name.value.trim(),
    roll: form.roll.value.trim(),
    course: form.course.value.trim() || DEFAULT_COURSE,
    email: normalizeEmail(form.email.value),
    password: form.password.value,
  };
}

function validate(data) {
  if (mode === "signup" && data.name.length < 2) {
    return "Please enter the student's full name.";
  }

  if (!data.email.includes("@") || !data.email.includes(".")) {
    return "Please enter a valid email address.";
  }

  if (data.password.length < 6) {
    return "Password must be at least 6 characters.";
  }

  return "";
}

function tableSetupMessage() {
  return "Students table is not ready. Run supabase-schema.sql in the Supabase SQL editor, then try again.";
}

function isMissingTableError(error) {
  return ["42P01", "PGRST205", "PGRST116"].includes(error?.code);
}

function renderMode() {
  const isSignup = mode === "signup";
  modeLabel.textContent = isSignup ? "Create account" : "Welcome back";
  formTitle.textContent = isSignup ? "Student Signup" : "Student Login";
  modeToggle.textContent = isSignup ? "Login" : "Signup";
  submitButton.textContent = isSignup ? "Create account" : "Login to dashboard";
  signupFields.hidden = !isSignup;
  forgotPassword.hidden = isSignup || !usingSupabase;
  form.password.autocomplete = isSignup ? "new-password" : "current-password";
  setMessage("");
}

function renderAuthState() {
  const provider = usingSupabase ? "Supabase Auth" : "Local preview";
  authBadge.textContent = provider;

  if (usingSupabase) {
    notice.innerHTML =
      "<strong>Public student access.</strong> Any student can create an account. Profile data is saved in Supabase.";
    return;
  }

  notice.innerHTML =
    "<strong>Preview mode.</strong> Add your Supabase URL and anon key in <code>auth-config.js</code> to enable real hosted authentication.";
}

function showDashboard(student) {
  document.body.classList.add("signed-in");
  document.querySelector("#studentName").textContent = student.name;
  document.querySelector("#profileName").textContent = student.name;
  document.querySelector("#profileEmail").textContent = student.email;
  document.querySelector("#profileRoll").textContent = student.roll;
  document.querySelector("#profileCourse").textContent = student.course;
  document.querySelector("#avatar").textContent = getInitials(student.name);
}

function showAuth() {
  document.body.classList.remove("signed-in");
}

async function createSupabaseClient() {
  const key = authConfig.supabasePublishableKey || authConfig.supabaseAnonKey;

  if (!isConfigured(authConfig.supabaseUrl) || !isConfigured(key)) {
    return null;
  }

  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  return createClient(authConfig.supabaseUrl, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

async function fetchStudentProfile(user) {
  const { data, error } = await client
    .from(STUDENTS_TABLE)
    .select("id, full_name, email, roll_number, course")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) throw new Error(tableSetupMessage());
    throw error;
  }

  return data ? tableProfile(data, user) : null;
}

async function verifyStudentsTableExists() {
  const { error } = await client.from(STUDENTS_TABLE).select("id").limit(1);

  if (error && isMissingTableError(error)) {
    throw new Error(tableSetupMessage());
  }
}

async function saveStudentProfile(user, profile) {
  const row = {
    id: user.id,
    full_name: profile.name,
    email: user.email || profile.email,
    roll_number: profile.roll || "Not added",
    course: profile.course || DEFAULT_COURSE,
  };

  const { error } = await client.from(STUDENTS_TABLE).upsert(row, { onConflict: "id" });

  if (error) {
    if (isMissingTableError(error)) throw new Error(tableSetupMessage());
    throw error;
  }

  return tableProfile(row, user);
}

async function ensureStudentProfile(user) {
  const existingProfile = await fetchStudentProfile(user);
  if (existingProfile) return existingProfile;

  return saveStudentProfile(user, fallbackProfile(user));
}

async function getCurrentUser() {
  if (usingSupabase) {
    const { data } = await client.auth.getUser();
    return data.user;
  }

  return JSON.parse(localStorage.getItem(DEMO_SESSION_KEY) || "null");
}

async function signUp(data) {
  if (usingSupabase) {
    await verifyStudentsTableExists();

    const result = await client.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.name,
          roll_number: data.roll || "Not added",
          course: data.course,
        },
      },
    });

    if (result.error) throw result.error;

    if (!result.data.session) {
      mode = "login";
      renderMode();
      setMessage("Account created. Please check your email to confirm before logging in.", true);
      return;
    }

    const profile = await saveStudentProfile(result.data.user, {
      name: data.name,
      email: data.email,
      roll: data.roll || "Not added",
      course: data.course,
    });

    showDashboard(profile);
    return;
  }

  const users = getDemoUsers();
  if (users[data.email]) {
    throw new Error("This email already has an account. Please login instead.");
  }

  const user = {
    id: crypto.randomUUID(),
    email: data.email,
    password: data.password,
    user_metadata: {
      full_name: data.name,
      roll_number: data.roll || "Not added",
      course: data.course,
    },
  };

  users[data.email] = user;
  saveDemoUsers(users);
  localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
  showDashboard(fallbackProfile(user));
}

async function login(data) {
  if (usingSupabase) {
    const { data: sessionData, error } = await client.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) throw error;

    const profile = await ensureStudentProfile(sessionData.user);
    showDashboard(profile);
    return;
  }

  const user = getDemoUsers()[data.email];
  if (!user || user.password !== data.password) {
    throw new Error("Email or password is incorrect.");
  }

  localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
  showDashboard(fallbackProfile(user));
}

async function logout() {
  if (usingSupabase) {
    await client.auth.signOut();
  }

  localStorage.removeItem(DEMO_SESSION_KEY);
  mode = "login";
  renderMode();
  showAuth();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formData();
  const errorMessage = validate(data);

  if (errorMessage) {
    setMessage(errorMessage);
    return;
  }

  setLoading(true);

  try {
    if (mode === "signup") {
      await signUp(data);
    } else {
      await login(data);
    }
  } catch (error) {
    setMessage(error.message || "Something went wrong. Please try again.");
  } finally {
    setLoading(false);
  }
});

modeToggle.addEventListener("click", () => {
  mode = mode === "signup" ? "login" : "signup";
  renderMode();
});

forgotPassword.addEventListener("click", async () => {
  const email = normalizeEmail(form.email.value);

  if (!usingSupabase) {
    setMessage("Password reset is available after Supabase is configured.");
    return;
  }

  if (!email) {
    setMessage("Enter your email address first.");
    return;
  }

  const { error } = await client.auth.resetPasswordForEmail(email);
  setMessage(error ? error.message : "Password reset email sent.", !error);
});

logoutButton.addEventListener("click", logout);

async function init() {
  try {
    client = await createSupabaseClient();
    usingSupabase = Boolean(client);
  } catch (error) {
    console.warn("Supabase could not be initialized. Preview mode is active.", error);
  }

  renderAuthState();
  renderMode();

  try {
    const user = await getCurrentUser();
    if (user) {
      const profile = usingSupabase ? await ensureStudentProfile(user) : fallbackProfile(user);
      showDashboard(profile);
    }
  } catch (error) {
    setMessage(error.message || "Could not load the student profile.");
  }

  if (usingSupabase) {
    client.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) return;

      try {
        const profile = await ensureStudentProfile(session.user);
        showDashboard(profile);
      } catch (error) {
        setMessage(error.message || "Could not load the student profile.");
      }
    });
  }
}

init();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startStudentPortal);
  } else {
    startStudentPortal();
  }
}
