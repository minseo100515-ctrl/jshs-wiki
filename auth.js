(function initWikiAuth(global) {
  let supabaseClient = null;
  let activeSession = null;
  let allowedEmailDomain = "@jeju-s.jje.hs.kr";
  let superAdminEmails = new Set();
  const sessionListeners = new Set();

  function normalizeEmail(email) {
    return (email || "").trim().toLowerCase();
  }

  function loadSuperAdminEmails(config) {
    const fromConfig = Array.isArray(config?.superAdminEmails)
      ? config.superAdminEmails
      : [];
    superAdminEmails = new Set(
      fromConfig.map(normalizeEmail).filter(Boolean)
    );
  }

  function isSuperAdminEmail(email) {
    const normalized = normalizeEmail(email);
    return normalized ? superAdminEmails.has(normalized) : false;
  }

  function isWikiAdmin(email = getCurrentUserEmail()) {
    if (isSuperAdminEmail(email)) return true;
    const meta = activeSession?.user?.user_metadata || {};
    const role = String(meta.wiki_role || meta.role || "").toLowerCase();
    return role === "super_admin" || role === "admin";
  }

  function isSchoolEmail(email) {
    if (!email || typeof email !== "string") return false;
    return email.toLowerCase().endsWith(allowedEmailDomain.toLowerCase());
  }

  function notifySessionChange() {
    sessionListeners.forEach((listener) => {
      listener(activeSession);
    });
  }

  function setActiveSession(session) {
    activeSession = session?.user ? session : null;
    notifySessionChange();
  }

  async function refreshSession() {
    if (!supabaseClient) {
      setActiveSession(null);
      return null;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      console.error("Failed to get session:", error);
      setActiveSession(null);
      return null;
    }

    setActiveSession(data.session);
    return activeSession;
  }

  let sessionReadyResolve = null;
  const sessionReadyPromise = new Promise((resolve) => {
    sessionReadyResolve = resolve;
  });

  function markSessionReady() {
    if (sessionReadyResolve) {
      sessionReadyResolve();
      sessionReadyResolve = null;
    }
  }

  async function init(config) {
    allowedEmailDomain = config.allowedEmailDomain || allowedEmailDomain;
    loadSuperAdminEmails(config);

    if (!global.supabase) {
      console.warn("Supabase SDK not loaded.");
      markSessionReady();
      return;
    }

    if (
      !config.supabaseUrl ||
      !config.supabaseAnonKey ||
      config.supabaseUrl === "YOUR_SUPABASE_URL" ||
      config.supabaseAnonKey === "YOUR_SUPABASE_ANON_KEY"
    ) {
      console.info("Set Supabase config values before using auth/api.");
      markSessionReady();
      return;
    }

    supabaseClient = global.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      setActiveSession(session);
    });

    await refreshSession();
    markSessionReady();
  }

  function whenReady() {
    return sessionReadyPromise;
  }

  function onSessionChange(listener) {
    sessionListeners.add(listener);
    listener(activeSession);
    return () => sessionListeners.delete(listener);
  }

  function getSupabaseClient() {
    return supabaseClient;
  }

  function hasActiveSession() {
    return Boolean(activeSession);
  }

  function getCurrentUserId() {
    return activeSession?.user?.id ?? null;
  }

  function getCurrentUserEmail() {
    return activeSession?.user?.email ?? null;
  }

  function getEditorProfile() {
    const email = getCurrentUserEmail() || "";
    const meta = activeSession?.user?.user_metadata || {};
    const nickname =
      meta.nickname || meta.display_name || email.split("@")[0] || "익명";
    const gen = meta.gen ?? meta.gen_number ?? meta.generation ?? null;

    return {
      nickname,
      gen: gen != null && gen !== "" ? String(gen) : null,
    };
  }

  function canEditWiki() {
    const email = getCurrentUserEmail();
    return isSchoolEmail(email) || isWikiAdmin(email);
  }

  async function signInWithEmail(email, password) {
    if (!supabaseClient) {
      throw new Error("Supabase client is not configured.");
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    setActiveSession(data.session);
    return data.session;
  }

  async function signUpWithEmail(email, password, profile = {}) {
    if (!supabaseClient) {
      throw new Error("Supabase client is not configured.");
    }
    if (!password || password.length < 8) {
      throw new Error("비밀번호는 8자 이상이어야 합니다.");
    }

    const isSchool = isSchoolEmail(email);
    const isAdminAccount = isSuperAdminEmail(email);
    let nickname = (profile.nickname || "").trim();
    let gen = profile.gen != null ? String(profile.gen).trim() : "";

    if (isSchool) {
      if (!nickname) {
        throw new Error("이름을 입력해주세요.");
      }
      if (!gen) {
        throw new Error("기수를 입력해주세요.");
      }
      const genNumber = Number(gen);
      if (!Number.isInteger(genNumber) || genNumber < 1 || genNumber > 99) {
        throw new Error("기수는 1~99 사이 숫자로 입력해주세요.");
      }
      gen = String(genNumber);
    } else {
      nickname = nickname || email.split("@")[0] || "게스트";
      gen = gen || "";
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          nickname,
          display_name: nickname,
          gen: gen || null,
          gen_number: gen || null,
          generation: gen || null,
          ...(isAdminAccount ? { wiki_role: "super_admin" } : {}),
        },
        emailRedirectTo: global.location?.origin || undefined,
      },
    });

    if (error) throw error;

    if (data.session) {
      setActiveSession(data.session);
    } else {
      setActiveSession(null);
    }

    return {
      session: data.session,
      user: data.user,
      needsEmailConfirmation: !data.session,
    };
  }

  async function signOut() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    setActiveSession(null);
  }

  function getAllowedEmailDomain() {
    return allowedEmailDomain;
  }

  global.WikiAuth = {
    init: (config) => init(config),
    whenReady,
    onSessionChange,
    getSupabaseClient,
    hasActiveSession,
    canEditWiki,
    isWikiAdmin,
    isSuperAdminEmail,
    getCurrentUserId,
    getCurrentUserEmail,
    getEditorProfile,
    refreshSession,
    isSchoolEmail,
    isAllowedEmail: isSchoolEmail,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    getAllowedEmailDomain,
  };
})(window);
