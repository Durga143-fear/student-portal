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
    const profileCreatedAt = document.getElementById("profileCreatedAt");
    const profileProvider = document.getElementById("profileProvider");
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
      !profileCreatedAt ||
      !profileProvider ||
      !avatar
    ) {
      console.error("Student portal markup is missing one or more required elements.");
      return;
    }

    const STUDENTS_TABLE = "students";
    const STUDENT_COLUMNS = "id, email, full_name, created_at";

    let mode = "signup";
    let client = null;

    function isConfigured(value) {
      return Boolean(value && !value.includes("YOUR_") && !value.includes("PROJECT_REF"));
    }

    function normalizeEmail(email) {
      return email.trim().toLowerCase();
    }

    function setMessage(text, isOk = false) {
      message.textContent = text;
      message.classList.toggle("ok", isOk);
    }

    function setLoading(isLoading) {
      submitButton.disabled = isLoading || !client;
      submitButton.textContent = isLoading
        ? "Please wait..."
        : mode === "signup"
          ? "Create account"
          : "Login to dashboard";
    }

    function getInitials(fullName = "") {
      const cleanName = fullName.trim();
      if (!cleanName) return "ST";

      return cleanName
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase();
    }

    function formatCreatedAt(value) {
      if (!value) return "Just now";

      const createdAt = new Date(value);
      if (Number.isNaN(createdAt.getTime())) return "Just now";

      return createdAt.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }

    function fallbackProfile(user) {
      const metadata = user?.user_metadata || {};
      const email = user?.email || "";
      const fullName = metadata.full_name || email.split("@")[0] || "Student";

      return {
        id: user?.id || "",
        email,
        fullName,
        createdAt: user?.created_at || null,
      };
    }

    function tableProfile(row, user) {
      const fallback = fallbackProfile(user);

      return {
        id: row?.id || fallback.id,
        email: row?.email || fallback.email,
        fullName: row?.full_name || fallback.fullName,
        createdAt: row?.created_at || fallback.createdAt,
      };
    }

    function formData() {
      return {
        fullName: form.elements.full_name.value.trim(),
        email: normalizeEmail(form.elements.email.value),
        password: form.elements.password.value,
      };
    }

    function validate(data) {
      if (mode === "signup" && data.fullName.length < 2) {
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
      return "The students table must use only these columns: id, email, full_name, created_at.";
    }

    function isStudentsTableError(error) {
      return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code);
    }

    function renderMode() {
      const isSignup = mode === "signup";
      modeLabel.textContent = isSignup ? "Create account" : "Welcome back";
      formTitle.textContent = isSignup ? "Student Signup" : "Student Login";
      modeToggle.textContent = isSignup ? "Login" : "Signup";
      signupFields.hidden = !isSignup;
      forgotPassword.hidden = isSignup || !client;
      form.elements.password.autocomplete = isSignup ? "new-password" : "current-password";
      setLoading(false);
      setMessage("");
    }

    function renderAuthState() {
      if (client) {
        authBadge.textContent = "Supabase Auth";
        notice.innerHTML =
          "<strong>Supabase Auth enabled.</strong> Student profiles use only <code>id</code>, <code>email</code>, <code>full_name</code>, and <code>created_at</code>.";
        return;
      }

      authBadge.textContent = "Supabase unavailable";
      notice.innerHTML =
        "<strong>Supabase is required.</strong> Add your Supabase URL and publishable key in <code>auth-config.js</code>.";
      setMessage("Supabase is not configured, so signup and login are disabled.");
    }

    function showDashboard(student) {
      document.body.classList.add("signed-in");
      studentName.textContent = student.fullName;
      profileName.textContent = student.fullName;
      profileEmail.textContent = student.email;
      profileCreatedAt.textContent = formatCreatedAt(student.createdAt);
      profileProvider.textContent = "Supabase Auth";
      avatar.textContent = getInitials(student.fullName);
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

    function throwStudentsTableError(error) {
      if (isStudentsTableError(error)) {
        throw new Error(tableSetupMessage());
      }

      throw error;
    }

    async function fetchStudentProfile(user) {
      const { data, error } = await client
        .from(STUDENTS_TABLE)
        .select(STUDENT_COLUMNS)
        .eq("id", user.id)
        .maybeSingle();

      if (error) throwStudentsTableError(error);

      return data ? tableProfile(data, user) : null;
    }

    async function saveStudentProfile(user) {
      const fallback = fallbackProfile(user);
      const row = {
        id: user.id,
        email: fallback.email,
        full_name: fallback.fullName,
      };

      const { data, error } = await client
        .from(STUDENTS_TABLE)
        .upsert(row, { onConflict: "id" })
        .select(STUDENT_COLUMNS)
        .single();

      if (error) throwStudentsTableError(error);

      return tableProfile(data || row, user);
    }

    async function ensureStudentProfile(user) {
      const existingProfile = await fetchStudentProfile(user);
      if (existingProfile) return existingProfile;

      return saveStudentProfile(user);
    }

    async function getCurrentUser() {
      if (!client) return null;

      const { data, error } = await client.auth.getUser();
      if (error && !error.message?.toLowerCase().includes("auth session missing")) {
        throw error;
      }

      return data.user || null;
    }

    async function signUp(data) {
      if (!client) {
        throw new Error("Supabase is required for signup.");
      }

      const result = await client.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
          },
        },
      });

      if (result.error) throw result.error;

      if (!result.data.user) {
        throw new Error("Supabase did not return a user for this signup.");
      }

      if (!result.data.session) {
        mode = "login";
        renderMode();
        setMessage("Account created. Please check your email to confirm before logging in.", true);
        return;
      }

      const profile = await saveStudentProfile(result.data.user);
      showDashboard(profile);
    }

    async function login(data) {
      if (!client) {
        throw new Error("Supabase is required for login.");
      }

      const { data: sessionData, error } = await client.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;

      const profile = await ensureStudentProfile(sessionData.user);
      showDashboard(profile);
    }

    async function logout() {
      if (client) {
        await client.auth.signOut();
      }

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

      if (!client) {
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
      } catch (error) {
        console.warn("Supabase could not be initialized.", error);
      }

      renderAuthState();
      renderMode();

      try {
        const user = await getCurrentUser();
        if (user) {
          const profile = await ensureStudentProfile(user);
          showDashboard(profile);
        }
      } catch (error) {
        setMessage(error.message || "Could not load the student profile.");
      }

      if (client) {
        client.auth.onAuthStateChange(async (event, session) => {
          if (event === "SIGNED_OUT" || !session?.user) {
            showAuth();
            return;
          }

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
