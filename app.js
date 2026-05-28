import { authConfig } from "./auth-config.js";

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("studentForm");
    const modeLabel = document.getElementById("modeLabel");
    const formTitle = document.getElementById("formTitle");
    const modeToggle = document.getElementById("modeToggle");
    const submitButton = document.getElementById("submitButton");
    const message = document.getElementById("message");
    const signupFields = document.querySelector(".signup-fields");
    const logoutButton = document.getElementById("logoutButton");
    const notice = document.getElementById("authNotice");
    const authBadge = document.getElementById("authBadge");
    const forgotPassword = document.getElementById("forgotPassword");
    const studentName = document.getElementById("studentName");
    const profileName = document.getElementById("profileName");
    const profileEmail = document.getElementById("profileEmail");
    const profileRoll = document.getElementById("profileRoll");
    const profileCourse = document.getElementById("profileCourse");
    const avatar = document.getElementById("avatar");

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
      !forgotPassword ||
      !studentName ||
      !profileName ||
      !profileEmail ||
      !profileRoll ||
      !profileCourse ||
      !avatar
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
      return Boolean(value && !value.includes("YOUR_") && !value.includes("PROJECT_REF"));
    }

    function normalizeEmail(email) {
      return email.trim().toLowerCase();
    }

    function safeRandomId() {
      if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
      }

      return `student-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function readStorage(key, fallback = null) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch (error) {
        console.warn("Browser storage is unavailable.", error);
        return fallback;
      }
    }

    function writeStorage(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.warn("Browser storage is unavailable.", error);
      }
    }

    function removeStorage(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn("Browser storage is unavailable.", error);
      }
    }

    function readJsonStorage(key, fallback) {
      try {
        return JSON.parse(readStorage(key, JSON.stringify(fallback)));
      } catch (error) {
        console.warn("Stored data could not be read.", error);
        return fallback;
      }
    }

    function writeJsonStorage(key, value) {
      writeStorage(key, JSON.stringify(value));
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
      return readJsonStorage(DEMO_USERS_KEY, {});
    }

    function saveDemoUsers(users) {
      writeJsonStorage(DEMO_USERS_KEY, users);
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
        id: user?.id || metadata.id || safeRandomId(),
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
        name: form.elements.name.value.trim(),
        roll: form.elements.roll.value.trim(),
        course: form.elements.course.value.trim() || DEFAULT_COURSE,
        email: normalizeEmail(form.elements.email.value),
        password: form.elements.password.value,
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
      form.elements.password.autocomplete = isSignup ? "new-password" : "current-password";
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
      studentName.textContent = student.name;
      profileName.textContent = student.name;
      profileEmail.textContent = student.email;
      profileRoll.textContent = student.roll;
      profileCourse.textContent = student.course;
      avatar.textContent = getInitials(student.name);
    }

    function showAuth() {
      document.body.classList.remove("signed-in");
    }

    function createSupabaseClient() {
      const key = authConfig.supabasePublishableKey || authConfig.supabaseAnonKey;

      if (!isConfigured(authConfig.supabaseUrl) || !isConfigured(key)) {
        return null;
      }

      const createClient = globalThis.supabase?.createClient;

      if (!createClient) {
        throw new Error("Supabase library did not load. Check the script tag in index.html.");
      }

      return createClient(authConfig.supabaseUrl, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
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

      return readJsonStorage(DEMO_SESSION_KEY, null);
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
        id: safeRandomId(),
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
      writeJsonStorage(DEMO_SESSION_KEY, user);
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

      writeJsonStorage(DEMO_SESSION_KEY, user);
      showDashboard(fallbackProfile(user));
    }

    async function logout() {
      if (usingSupabase) {
        await client.auth.signOut();
      }

      removeStorage(DEMO_SESSION_KEY);
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
      const email = normalizeEmail(form.elements.email.value);

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
        client = createSupabaseClient();
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
  });
}
