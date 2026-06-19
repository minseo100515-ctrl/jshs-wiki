(function initWikiAPI(global) {
  const PROFANITY_WORDS = [
    "시발",
    "씨발",
    "병신",
    "개새",
    "지랄",
    "미친",
    "죽어",
    "fuck",
    "shit",
    "bitch",
  ];

  const BLOCKED_REAL_NAMES = [
    "홍길동",
    "김철수",
    "이영희",
    "박민수",
    "최지우",
  ];

  const CONTENT_POLICY_BLOCK_MESSAGE =
    "개인정보 보호 및 비방 금지 원칙에 따라 저장할 수 없습니다.";

  const NAME_CONTEXT_PATTERN = /[가-힣]{2,4}\s?(학생|선생|교사|회장|부회장|학번)/;

  class ContentValidationError extends Error {
    constructor(message) {
      super(message);
      this.name = "ContentValidationError";
    }
  }

  function getClient() {
    const client = global.WikiAuth?.getSupabaseClient?.();
    if (!client) {
      throw new Error("Supabase client is not configured.");
    }
    return client;
  }

  function isMockMode() {
    return !global.WikiAuth?.getSupabaseClient?.();
  }

  function getMockStore() {
    return global.WikiMockStore ?? null;
  }

  function cloneMockRow(row) {
    return row ? { ...row } : null;
  }

  function getMockArticles() {
    return getMockStore()?.articles ?? [];
  }

  function findMockArticleByTitle(title) {
    const normalized = (title || "").trim();
    if (!normalized) return null;
    const found = getMockArticles().find((row) => row.title === normalized);
    return cloneMockRow(found);
  }

  function getMockArticlesByCategory(category) {
    const slug = (category || "general").trim();
    return getMockArticles()
      .filter((row) => (row.category || "general") === slug)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        updated_at: row.updated_at,
      }));
  }

  function getMockArchivesByGeneration(genId, genNumber) {
    const store = getMockStore();
    if (!store) return [];

    let resolvedGenId = genId;
    if (!resolvedGenId && genNumber != null) {
      const gen = store.generations.find(
        (row) => row.gen_number === Number(genNumber)
      );
      resolvedGenId = gen?.id;
    }
    if (!resolvedGenId) return [];

    return store.archives
      .filter((row) => row.gen_id === resolvedGenId)
      .sort((a, b) => b.id - a.id)
      .map((row) => ({
        ...row,
        content: row.content || decodeArchiveContent(row.file_url),
      }));
  }

  let readFallbackActive = false;

  function markReadFallback() {
    readFallbackActive = true;
  }

  function isReadFallbackActive() {
    return readFallbackActive;
  }

  async function checkSupabaseReadiness() {
    readFallbackActive = false;
    if (isMockMode()) return;

    try {
      const { error } = await getClient().from("Articles").select("id").limit(1);
      if (error) markReadFallback();
    } catch {
      markReadFallback();
    }
  }

  function warnSupabaseReadFallback(context, error) {
    markReadFallback();
    console.warn(
      `[WikiAPI] ${context} failed, using local fallback:`,
      error?.message || error
    );
  }

  function normalizeText(value) {
    return (value || "").toLowerCase().replace(/\s+/g, "");
  }

  function validateContent(content) {
    const text = (content || "").trim();
    if (!text) {
      return { ok: false, message: "내용을 입력해주세요." };
    }

    const compact = normalizeText(text);

    for (const word of PROFANITY_WORDS) {
      if (compact.includes(normalizeText(word))) {
        return { ok: false, message: CONTENT_POLICY_BLOCK_MESSAGE };
      }
    }

    for (const name of BLOCKED_REAL_NAMES) {
      if (text.includes(name)) {
        return { ok: false, message: CONTENT_POLICY_BLOCK_MESSAGE };
      }
    }

    if (NAME_CONTEXT_PATTERN.test(text)) {
      return { ok: false, message: CONTENT_POLICY_BLOCK_MESSAGE };
    }

    return { ok: true };
  }

  function assertValidContent(content) {
    const result = validateContent(content);
    if (!result.ok) {
      throw new ContentValidationError(result.message);
    }
  }

  function buildArticlePayload({ title, content, category }) {
    return {
      title: title.trim(),
      content,
      category: category || "general",
      updated_at: new Date().toISOString(),
    };
  }

  function encodeArchiveContent(content) {
    return `inline:${content}`;
  }

  function decodeArchiveContent(fileUrl) {
    if (!fileUrl) return "";
    if (fileUrl.startsWith("inline:")) {
      return fileUrl.slice("inline:".length);
    }
    return "";
  }

  async function getArticleByTitle(title) {
    const normalized = (title || "").trim();
    if (!normalized) return null;

    if (isMockMode()) {
      return findMockArticleByTitle(normalized);
    }

    try {
      const client = getClient();
      const { data, error } = await client
        .from("Articles")
        .select("id, title, content, category, updated_at")
        .eq("title", normalized)
        .maybeSingle();

      if (error) {
        warnSupabaseReadFallback("getArticleByTitle", error);
        return findMockArticleByTitle(normalized);
      }

      if (data) return data;
      markReadFallback();
      return findMockArticleByTitle(normalized);
    } catch (error) {
      warnSupabaseReadFallback("getArticleByTitle", error);
      return findMockArticleByTitle(normalized);
    }
  }

  async function getAllArticleTitles() {
    const mockTitles = getMockArticles().map((row) => row.title.trim());

    if (isMockMode()) {
      return new Set(mockTitles);
    }

    const titles = new Set(mockTitles);

    try {
      const client = getClient();
      const { data, error } = await client.from("Articles").select("title");

      if (error) {
        warnSupabaseReadFallback("getAllArticleTitles", error);
        return titles;
      }

      (data || []).forEach((row) => {
        if (row.title) titles.add(row.title.trim());
      });
      return titles;
    } catch (error) {
      warnSupabaseReadFallback("getAllArticleTitles", error);
      return titles;
    }
  }

  function ensureMockGeneration(genNumber) {
    const store = getMockStore();
    if (!store) return null;

    const num = Number(genNumber);
    const calendar = global.WikiGenCalendar;
    if (!calendar || num < 1 || calendar.isFutureGen(num)) return null;

    const existing = store.generations.find((row) => row.gen_number === num);
    if (existing) return cloneMockRow(existing);

    if (!store.nextGenerationId) store.nextGenerationId = 1000;
    const id = store.nextGenerationId;
    store.nextGenerationId += 1;

    const generation = {
      id,
      ...calendar.buildAutoGeneration(num),
    };
    store.generations.push(generation);

    const hasOverview = store.archives.some(
      (row) =>
        row.gen_id === id &&
        ["개요", "overview", "소개"].includes((row.category || "").trim())
    );

    if (!hasOverview) {
      if (!store.nextArchiveId) store.nextArchiveId = 1000;
      store.archives.push({
        id: store.nextArchiveId,
        gen_id: id,
        title: `${num}기 소개`,
        category: "개요",
        content: calendar.buildAutoGenOverviewContent(num),
      });
      store.nextArchiveId += 1;
    }

    return cloneMockRow(generation);
  }

  async function getGenerationByNumber(genNumber) {
    if (isMockMode()) {
      return ensureMockGeneration(genNumber);
    }

    try {
      const client = getClient();
      const { data, error } = await client
        .from("Generations")
        .select("id, gen_number, slogan, rep_image")
        .eq("gen_number", Number(genNumber))
        .maybeSingle();

      if (error) {
        warnSupabaseReadFallback("getGenerationByNumber", error);
        return ensureMockGeneration(genNumber);
      }

      if (data) return data;

      const calendar = global.WikiGenCalendar;
      const num = Number(genNumber);
      if (calendar && num >= 1 && !calendar.isFutureGen(num)) {
        return {
          id: null,
          ...calendar.buildAutoGeneration(num),
        };
      }

      return ensureMockGeneration(genNumber);
    } catch (error) {
      warnSupabaseReadFallback("getGenerationByNumber", error);
      return ensureMockGeneration(genNumber);
    }
  }

  async function getArchivesByGeneration(genId, genNumber = null) {
    if (isMockMode()) {
      return getMockArchivesByGeneration(genId, genNumber);
    }

    if (!genId) {
      return getMockArchivesByGeneration(null, genNumber);
    }

    try {
      const client = getClient();
      const { data, error } = await client
        .from("Archives")
        .select("id, gen_id, title, category, file_url")
        .eq("gen_id", genId)
        .order("id", { ascending: false });

      if (error) {
        warnSupabaseReadFallback("getArchivesByGeneration", error);
        return getMockArchivesByGeneration(genId, genNumber);
      }

      const rows = (data || []).map((row) => ({
        ...row,
        content: decodeArchiveContent(row.file_url),
      }));

      if (rows.length) return rows;
      return getMockArchivesByGeneration(genId, genNumber);
    } catch (error) {
      warnSupabaseReadFallback("getArchivesByGeneration", error);
      return getMockArchivesByGeneration(genId, genNumber);
    }
  }

  async function getGenerationArchiveData(genNumber) {
    const generation = await getGenerationByNumber(genNumber);
    const calendar = global.WikiGenCalendar;
    const num = Number(genNumber);

    let archives = generation?.id
      ? await getArchivesByGeneration(generation.id, num)
      : await getArchivesByGeneration(null, num);

    if (
      generation &&
      !archives.length &&
      calendar &&
      num >= 1 &&
      !calendar.isFutureGen(num)
    ) {
      archives = [
        {
          id: null,
          gen_id: generation.id,
          title: `${num}기 소개`,
          category: "개요",
          content: calendar.buildAutoGenOverviewContent(num),
        },
      ];
    }

    return {
      generation,
      archives,
    };
  }

  const REVISION_META_PREFIX = "---jshs-revision\n";
  const REVISION_META_SUFFIX = "\n---\n\n";

  function packRevisionContent(prevContent, meta = {}) {
    const editSummary = meta.editSummary || "";
    const editorNickname = meta.editorNickname || "";
    const editorGen = meta.editorGen != null ? String(meta.editorGen) : "";

    return `${REVISION_META_PREFIX}edit_summary: ${JSON.stringify(editSummary)}\neditor_nickname: ${JSON.stringify(editorNickname)}\neditor_gen: ${JSON.stringify(editorGen)}${REVISION_META_SUFFIX}${prevContent || ""}`;
  }

  function unpackRevisionRow(row) {
    const raw = row.prev_content ?? "";
    if (!raw.startsWith(REVISION_META_PREFIX)) {
      return {
        id: row.id,
        article_id: row.article_id,
        user_id: row.user_id,
        created_at: row.created_at,
        prev_content: raw,
        edit_summary: row.edit_summary || "",
        editor_nickname: row.editor_nickname || "",
        editor_gen: row.editor_gen || "",
      };
    }

    const endMeta = raw.indexOf(REVISION_META_SUFFIX);
    const metaBlock = raw.slice(REVISION_META_PREFIX.length, endMeta);
    const body = raw.slice(endMeta + REVISION_META_SUFFIX.length);

    const readMeta = (key) => {
      const match = metaBlock.match(new RegExp(`^${key}: (.+)$`, "m"));
      if (!match) return "";
      try {
        return JSON.parse(match[1]);
      } catch {
        return match[1];
      }
    };

    return {
      id: row.id,
      article_id: row.article_id,
      user_id: row.user_id,
      created_at: row.created_at,
      prev_content: body,
      edit_summary: row.edit_summary || readMeta("edit_summary") || "",
      editor_nickname: row.editor_nickname || readMeta("editor_nickname") || "",
      editor_gen: row.editor_gen || readMeta("editor_gen") || "",
    };
  }

  async function getRevisionsByArticleId(articleId) {
    if (!articleId) return [];

    if (isMockMode()) {
      const store = getMockStore();
      if (!store) return [];
      return store.revisions
        .filter((row) => row.article_id === articleId)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .map((row) => unpackRevisionRow(row));
    }

    const client = getClient();
    const { data, error } = await client
      .from("Revisions")
      .select(
        "id, article_id, prev_content, user_id, created_at, edit_summary, editor_nickname, editor_gen"
      )
      .eq("article_id", articleId)
      .order("created_at", { ascending: false });

    if (error) {
      const { data: fallbackData, error: fallbackError } = await client
        .from("Revisions")
        .select("id, article_id, prev_content, user_id, created_at")
        .eq("article_id", articleId)
        .order("created_at", { ascending: false });

      if (fallbackError) throw fallbackError;
      return (fallbackData || []).map(unpackRevisionRow);
    }

    return (data || []).map(unpackRevisionRow);
  }

  async function getArticleRevisionHistory(articleId) {
    const revisions = await getRevisionsByArticleId(articleId);
    const total = revisions.length;

    return revisions.map((rev, index) => ({
      ...rev,
      version: total - index,
    }));
  }

  async function createRevision({
    articleId,
    prevContent,
    userId,
    editSummary = "",
    editorNickname = "",
    editorGen = "",
  }) {
    if (!articleId) return;

    if (isMockMode()) {
      const store = getMockStore();
      if (!store) return;
      store.revisions.unshift({
        id: store.nextRevisionId++,
        article_id: articleId,
        user_id: userId,
        created_at: new Date().toISOString(),
        prev_content: packRevisionContent(prevContent, {
          editSummary,
          editorNickname,
          editorGen,
        }),
        edit_summary: editSummary,
        editor_nickname: editorNickname,
        editor_gen: editorGen != null ? String(editorGen) : "",
      });
      return;
    }

    const client = getClient();
    const packedContent = packRevisionContent(prevContent, {
      editSummary,
      editorNickname,
      editorGen,
    });

    const fullRow = {
      article_id: articleId,
      prev_content: packedContent,
      user_id: userId,
      edit_summary: editSummary,
      editor_nickname: editorNickname,
      editor_gen: editorGen != null ? String(editorGen) : "",
    };

    let { error } = await client.from("Revisions").insert(fullRow);

    if (error) {
      const { error: fallbackError } = await client.from("Revisions").insert({
        article_id: articleId,
        prev_content: packedContent,
        user_id: userId,
      });
      if (fallbackError) throw fallbackError;
    }
  }

  async function rollbackArticle(client, articleId, snapshot) {
    if (!articleId || !snapshot) return;

    const { error } = await client
      .from("Articles")
      .update({
        title: snapshot.title,
        content: snapshot.content,
        category: snapshot.category,
        updated_at: snapshot.updated_at,
      })
      .eq("id", articleId);

    if (error) {
      console.error("Failed to rollback article after revision error:", error);
    }
  }

  /**
   * 1) Bad word 필터
   * 2) Articles upsert
   * 3) 성공 시 기존 본문 Revisions 백업 (실패 시 보상 롤백)
   */
  async function saveArticle({
    title,
    content,
    category,
    userId,
    previousArticle,
    editSummary = "",
    editorNickname = "",
    editorGen = "",
  }) {
    assertValidContent(content);

    if (!isMockMode() && !userId) {
      throw new Error("로그인이 필요합니다.");
    }

    if (isMockMode()) {
      const store = getMockStore();
      if (!store) throw new Error("Mock store is not available.");

      const payload = buildArticlePayload({ title, content, category });
      const existing = previousArticle?.id
        ? store.articles.find((row) => row.id === previousArticle.id)
        : store.articles.find((row) => row.title === payload.title);

      const prevSnapshot = existing
        ? {
            id: existing.id,
            title: existing.title,
            content: existing.content ?? "",
            category: existing.category ?? "general",
            updated_at: existing.updated_at,
          }
        : null;

      const shouldBackup =
        prevSnapshot &&
        (prevSnapshot.content !== payload.content ||
          prevSnapshot.title !== payload.title ||
          prevSnapshot.category !== payload.category);

      let saved;

      if (prevSnapshot) {
        Object.assign(existing, payload);
        saved = cloneMockRow(existing);
      } else {
        saved = {
          id: store.nextArticleId++,
          ...payload,
        };
        store.articles.push(saved);
        saved = cloneMockRow(saved);
      }

      if (shouldBackup) {
        await createRevision({
          articleId: saved.id,
          prevContent: prevSnapshot.content,
          userId,
          editSummary,
          editorNickname,
          editorGen,
        });
      }

      return saved;
    }

    const client = getClient();
    const payload = buildArticlePayload({ title, content, category });
    const existing =
      previousArticle?.id != null
        ? previousArticle
        : await getArticleByTitle(payload.title);

    const prevSnapshot = existing
      ? {
          id: existing.id,
          title: existing.title,
          content: existing.content ?? "",
          category: existing.category ?? "general",
          updated_at: existing.updated_at,
        }
      : null;

    const shouldBackup =
      prevSnapshot &&
      (prevSnapshot.content !== payload.content ||
        prevSnapshot.title !== payload.title ||
        prevSnapshot.category !== payload.category);

    let saved;

    if (prevSnapshot?.id) {
      const { data, error } = await client
        .from("Articles")
        .upsert(
          {
            id: prevSnapshot.id,
            ...payload,
          },
          { onConflict: "id" }
        )
        .select("id, title, content, category, updated_at")
        .single();

      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await client
        .from("Articles")
        .upsert(payload, { onConflict: "title" })
        .select("id, title, content, category, updated_at")
        .single();

      if (error) throw error;
      saved = data;
    }

    if (shouldBackup) {
      try {
        await createRevision({
          articleId: saved.id,
          prevContent: prevSnapshot.content,
          userId,
          editSummary,
          editorNickname,
          editorGen,
        });
      } catch (revisionError) {
        await rollbackArticle(client, saved.id, prevSnapshot);
        throw revisionError;
      }
    }

    return saved;
  }

  async function saveArchivePost({
    genNumber,
    title,
    content,
    category,
    userId,
    previousArchive,
  }) {
    assertValidContent(content);

    if (!isMockMode() && !userId) {
      throw new Error("로그인이 필요합니다.");
    }

    if (isMockMode()) {
      const store = getMockStore();
      if (!store) throw new Error("Mock store is not available.");

      const generation = await getGenerationByNumber(genNumber);
      if (!generation?.id) {
        throw new Error("해당 기수 정보를 찾을 수 없습니다.");
      }

      const archiveTitle = title.trim();
      const archiveCategory = category || "archive";
      const saved = {
        id: store.nextArchiveId++,
        gen_id: generation.id,
        title: archiveTitle,
        category: archiveCategory,
        file_url: encodeArchiveContent(content),
        content,
      };
      store.archives.unshift(saved);

      return {
        ...saved,
        gen_number: generation.gen_number,
      };
    }

    const generation = await getGenerationByNumber(genNumber);
    if (!generation?.id) {
      throw new Error("해당 기수 정보를 찾을 수 없습니다.");
    }

    const client = getClient();
    const archiveTitle = title.trim();
    const archiveCategory = category || "archive";
    const fileUrl = encodeArchiveContent(content);

    const prevSnapshot = previousArchive?.id
      ? {
          id: previousArchive.id,
          gen_id: previousArchive.gen_id,
          title: previousArchive.title,
          category: previousArchive.category,
          file_url: previousArchive.file_url,
        }
      : null;

    let saved;

    if (prevSnapshot?.id) {
      const { data, error } = await client
        .from("Archives")
        .upsert(
          {
            id: prevSnapshot.id,
            gen_id: generation.id,
            title: archiveTitle,
            category: archiveCategory,
            file_url: fileUrl,
          },
          { onConflict: "id" }
        )
        .select("id, gen_id, title, category, file_url")
        .single();

      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await client
        .from("Archives")
        .insert({
          gen_id: generation.id,
          title: archiveTitle,
          category: archiveCategory,
          file_url: fileUrl,
        })
        .select("id, gen_id, title, category, file_url")
        .single();

      if (error) throw error;
      saved = data;
    }

    return {
      ...saved,
      content: decodeArchiveContent(saved.file_url),
      gen_number: generation.gen_number,
    };
  }

  async function getArticlesByCategory(category) {
    const slug = (category || "general").trim();

    if (isMockMode()) {
      return getMockArticlesByCategory(slug);
    }

    try {
      const client = getClient();
      const { data, error } = await client
        .from("Articles")
        .select("id, title, category, updated_at")
        .eq("category", slug)
        .order("updated_at", { ascending: false });

      if (error) {
        warnSupabaseReadFallback("getArticlesByCategory", error);
        return getMockArticlesByCategory(slug);
      }

      if (data?.length) return data;
      markReadFallback();
      return getMockArticlesByCategory(slug);
    } catch (error) {
      warnSupabaseReadFallback("getArticlesByCategory", error);
      return getMockArticlesByCategory(slug);
    }
  }

  global.WikiAPI = {
    ContentValidationError,
    validateContent,
    getArticleByTitle,
    getAllArticleTitles,
    getArticlesByCategory,
    getGenerationByNumber,
    getArchivesByGeneration,
    getGenerationArchiveData,
    saveArticle,
    saveArchivePost,
    getRevisionsByArticleId,
    getArticleRevisionHistory,
    createRevision,
    isMockMode,
    isReadFallbackActive,
    checkSupabaseReadiness,
  };
})(window);
