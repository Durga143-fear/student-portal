import { createClient } from "@supabase/supabase-js";

const LOCAL_AUTH_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const memoryAuthStorage = {};

function readEnvValue(...keys) {
  for (const key of keys) {
    const value = import.meta.env[key];
    if (typeof value === "string" && value.trim()) {
      return { key, value: value.trim() };
    }
  }

  return { key: "", value: "" };
}

const supabaseUrlEnv = readEnvValue("SUPABASE_URL", "VITE_SUPABASE_URL");
const supabaseAnonKeyEnv = readEnvValue("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
const configuredAuthRedirectUrlEnv = readEnvValue(
  "SUPABASE_AUTH_REDIRECT_URL",
  "VITE_SUPABASE_AUTH_REDIRECT_URL",
);

const supabaseUrl = supabaseUrlEnv.value;
const supabaseAnonKey = supabaseAnonKeyEnv.value;
const configuredAuthRedirectUrl = configuredAuthRedirectUrlEnv.value;

function getSafeUrlHost(value) {
  if (!value) return "";

  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

function getDefaultPort(protocol) {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
}

function getEffectivePort(url) {
  return url.port || getDefaultPort(url.protocol);
}

function isLocalAuthHost(hostname) {
  return LOCAL_AUTH_HOSTS.has(hostname);
}

function getCleanCurrentUrl() {
  const redirectUrl = new URL(window.location.href);
  redirectUrl.search = "";
  redirectUrl.hash = "";

  return redirectUrl.toString();
}

function parseRedirectUrl(value) {
  if (!value) return null;

  try {
    return new URL(value, window.location.origin);
  } catch {
    return null;
  }
}

function getSupabaseProjectRef(value) {
  if (!value) return "";

  try {
    return new URL(value).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

const supabaseProjectRef = getSupabaseProjectRef(supabaseUrl);
const authStorageKey = supabaseProjectRef ? `sb-${supabaseProjectRef}-auth-token` : "";

function getWebStorage(type) {
  if (typeof window === "undefined") return null;

  try {
    return window[type] || null;
  } catch {
    return null;
  }
}

function canUseWebStorage(storage) {
  if (!storage) return false;

  const testKey = `auth-storage-test-${Math.random().toString(36).slice(2)}`;

  try {
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function getStorageBackends() {
  return [
    { name: "localStorage", storage: getWebStorage("localStorage") },
    { name: "sessionStorage", storage: getWebStorage("sessionStorage") },
  ].filter(({ storage }) => storage && canUseWebStorage(storage));
}

const browserAuthStorage = {
  getItem(key) {
    for (const { storage } of getStorageBackends()) {
      try {
        const value = storage.getItem(key);
        if (value !== null) return value;
      } catch {
        // Try the next backend.
      }
    }

    return memoryAuthStorage[key] || null;
  },
  setItem(key, value) {
    const backends = getStorageBackends();
    let wroteToWebStorage = false;

    backends.forEach(({ storage }) => {
      try {
        storage.setItem(key, value);
        wroteToWebStorage = true;
      } catch {
        // Try every available backend before falling back to memory.
      }
    });

    if (!wroteToWebStorage) {
      memoryAuthStorage[key] = value;
    }
  },
  removeItem(key) {
    getStorageBackends().forEach(({ storage }) => {
      try {
        storage.removeItem(key);
      } catch {
        // Best-effort cleanup across all storage backends.
      }
    });

    delete memoryAuthStorage[key];
  },
};

export function getAuthStorageSnapshot(key = "") {
  const backends = getStorageBackends();
  const values = backends.map(({ name, storage }) => {
    const value = key ? storage.getItem(key) : null;

    return {
      name,
      available: true,
      hasKey: key ? value !== null : false,
      valueLength: value?.length || 0,
    };
  });

  if (key) {
    const value = memoryAuthStorage[key] || null;
    values.push({
      name: "memory",
      available: true,
      hasKey: value !== null,
      valueLength: value?.length || 0,
    });
  }

  return {
    availableBackends: backends.map(({ name }) => name),
    values,
  };
}

export function getOAuthRedirectContext() {
  const configuredUrl = configuredAuthRedirectUrl?.trim();
  const currentRedirectUrl = getCleanCurrentUrl();
  const currentUrl = new URL(currentRedirectUrl);

  if (!configuredUrl) {
    return {
      redirectTo: currentRedirectUrl,
      source: "current-url",
      configuredUrl: "",
      configuredOrigin: "",
      currentOrigin: currentUrl.origin,
      originMatches: true,
      localHostMismatch: false,
      reason: "No configured OAuth redirect URL was provided.",
    };
  }

  const parsedConfiguredUrl = parseRedirectUrl(configuredUrl);

  if (!parsedConfiguredUrl) {
    return {
      redirectTo: currentRedirectUrl,
      source: "current-url-invalid-config",
      configuredUrl,
      configuredOrigin: "",
      currentOrigin: currentUrl.origin,
      originMatches: false,
      localHostMismatch: false,
      reason: "Configured OAuth redirect URL is invalid.",
    };
  }

  const originMatches = parsedConfiguredUrl.origin === currentUrl.origin;
  const localHostMismatch =
    !originMatches &&
    parsedConfiguredUrl.protocol === currentUrl.protocol &&
    getEffectivePort(parsedConfiguredUrl) === getEffectivePort(currentUrl) &&
    isLocalAuthHost(parsedConfiguredUrl.hostname) &&
    isLocalAuthHost(currentUrl.hostname);

  if (!originMatches) {
    return {
      redirectTo: currentRedirectUrl,
      source: "current-url-origin-mismatch",
      configuredUrl,
      configuredOrigin: parsedConfiguredUrl.origin,
      currentOrigin: currentUrl.origin,
      originMatches,
      localHostMismatch,
      reason: "PKCE code verifiers are stored per origin, so OAuth must return to the origin that started login.",
    };
  }

  return {
    redirectTo: configuredUrl,
    source: "configured-env",
    configuredUrl,
    configuredOrigin: parsedConfiguredUrl.origin,
    currentOrigin: currentUrl.origin,
    originMatches,
    localHostMismatch: false,
    reason: "Configured OAuth redirect URL matches the current origin.",
  };
}

export function getOAuthRedirectUrl() {
  return getOAuthRedirectContext().redirectTo;
}

export function getSupabaseAuthStorageInfo() {
  const codeVerifierKey = authStorageKey ? `${authStorageKey}-code-verifier` : "";

  return {
    projectRef: supabaseProjectRef,
    storageKey: authStorageKey,
    codeVerifierKey,
    storage: getAuthStorageSnapshot(codeVerifierKey),
  };
}

export function describeSupabaseClientConfig() {
  return {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
    urlEnvKey: supabaseUrlEnv.key || null,
    anonKeyEnvKey: supabaseAnonKeyEnv.key || null,
    authRedirectEnvKey: configuredAuthRedirectUrlEnv.key || null,
    supabaseHost: getSafeUrlHost(supabaseUrl),
    authRedirectUrl: configuredAuthRedirectUrl || "auto",
    resolvedAuthRedirect: typeof window === "undefined" ? null : getOAuthRedirectContext(),
    authStorage: getSupabaseAuthStorageInfo(),
    authFlowType: "pkce",
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  };
}

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storage: browserAuthStorage,
      },
    })
  : null;

console.info("[auth] Supabase client config", describeSupabaseClientConfig());
