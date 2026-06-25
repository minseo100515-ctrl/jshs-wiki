const APP_CONFIG = window.APP_CONFIG ?? {
  supabaseUrl: "YOUR_SUPABASE_URL",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  allowedEmailDomain: "@jeju-s.jje.hs.kr",
  superAdminEmails: [
    "wiki-admin1@jeju-s.jje.hs.kr",
    "wiki-admin2@jeju-s.jje.hs.kr",
  ],
};

const STUB_CATEGORY = "토막글";

const SCHOOL_NAMU_WIKI_TITLE = "제주과학고등학교 - 나무위키";
const JEGWANG_WRITE_TITLE = "직접 적어보는 제곽";

const SCHOOL_INTRO_TITLES = new Set([
  SCHOOL_NAMU_WIKI_TITLE,
  JEGWANG_WRITE_TITLE,
  "R&E 연구",
  "동아리",
  "학교 행사",
  "주의 사항",
]);

function isSchoolIntroArticle(title) {
  return SCHOOL_INTRO_TITLES.has(title);
}

function getSchoolIntroCategory(title) {
  const categoryMap = {
    "R&E 연구": "studies",
    동아리: "clubs",
    "학교 행사": "events",
    "주의 사항": "notices",
  };
  return categoryMap[title] || "general";
}

function buildSchoolIntroEditBannerHTML(title) {
  if (!isSchoolIntroArticle(title)) return "";
  const cautionHref = buildWikiLinkHref("주의 사항");
  return `
    <div class="school-intro-edit-banner" role="note">
      <strong>제주과학고 소개</strong> 문서입니다.
      상단 <button type="button" class="wiki-inline-edit-btn" data-action="wiki-edit">[편집]</button>
      탭에서 내용을 수정할 수 있습니다. 저장은 ${APP_CONFIG.allowedEmailDomain} 학교 이메일 로그인 후 가능합니다.
      커뮤니티 규칙은 <a href="${cautionHref}" class="wiki-link wiki-link--exists">주의 사항</a>을 참고하세요.
    </div>
  `;
}

const GEN_GROUP_SIZE = 5;

function getCurrentGen() {
  return window.WikiGenCalendar.getCurrentGen();
}

function getMaxGen() {
  return window.WikiGenCalendar.getMaxGen();
}

function getGenGradeLabel(genNumber) {
  return window.WikiGenCalendar.getGenGradeLabel(genNumber);
}

function getGenEntranceYear(genNumber) {
  return window.WikiGenCalendar.getGenEntranceYear(genNumber);
}

function getGenGroupStart(genNumber) {
  return Math.floor((Number(genNumber) - 1) / GEN_GROUP_SIZE) * GEN_GROUP_SIZE + 1;
}

function buildHomeContent() {
  const gen = getCurrentGen();
  const kstLabel = window.WikiGenCalendar.formatKstLabel();

  return `<p>좌측 <strong>제주과학고 소개</strong>에서 학교 문서를 보거나, 기수·카테고리 메뉴로 아카이브를 탐색하세요.</p>
      <p class="wiki-gen-calendar-note">기수·학년도는 한국시간 기준 매년 3월 1일에 자동 갱신됩니다. (오늘: ${kstLabel})</p>
      <p><strong>추천 문서:</strong>
        <a href="#/wiki/${encodeURIComponent(SCHOOL_NAMU_WIKI_TITLE)}">${escapeHtml(SCHOOL_NAMU_WIKI_TITLE)}</a> ·
        <a href="#/wiki/제곽위키">제곽위키</a> ·
        <a href="#/wiki/R%26E%20연구">R&amp;E 연구</a> ·
        <a href="#/generation/${gen}">${gen}기</a>
      </p>`;
}

const ROUTE_META = {
  home: {
    title: "환영합니다",
    description: "JSHS-WIKI 메인 페이지입니다.",
  },
  category: {
    title: "카테고리",
    description: "카테고리별 문서 목록을 표시할 영역입니다.",
  },
  generation: {
    title: "기수 아카이브",
    description: "기수 문서 · R&E 아카이브 · 댓글",
  },
};

const GEN_COMMENT_CATEGORIES = new Set([
  "댓글",
  "comment",
  "선배한마디",
  "선배들의한마디",
  "한마디",
  "토론",
]);

const GEN_SECTION_DEFS = [
  { id: "overview", title: "1. 개요", categories: ["개요", "overview", "소개"] },
  { id: "events", title: "2. 주요 사건", categories: ["사건", "주요사건", "events", "행사"] },
  {
    id: "research",
    title: "3. R&E 연구",
    categories: ["r&e", "re", "연구", "research", "r_e", "rne"],
  },
  { id: "archives", title: "4. 아카이브", categories: ["archive", "아카이브", "기타"] },
];

const DRAFT_AUTOSAVE_MS = 60_000;
const AUTH_NOTICE_KEY = "jshs-wiki-auth-notice";

let currentArticleState = null;
let currentEditTitle = null;
let currentCategorySlug = null;
let currentArchiveEdit = null;
let isArticleSaveInProgress = false;
let draftAutosaveTimer = null;
let articleTitleCache = null;
let articleTitleCachePromise = null;

const WIKI_LINK_REGEX = /\[\[([^[\]|#]+)(?:\|([^[\]]+))?\]\]/g;
const MARKDOWN_CODE_SEGMENT_REGEX = /(```[\s\S]*?```|`[^`\n]+`)/g;
const NAMU_FOOTNOTE_REGEX = /\[\*\s*([^\]\n]+?)\s*\]/g;
const NAMU_HEADING_REGEX = /^(\={2,6})\s*(.+?)\s*\1\s*$/gm;
const NAMU_BOLD_REGEX = /'''([^']+?)'''/g;
const NAMU_ITALIC_REGEX = /''([^']+?)''/g;
const NAMU_HR_REGEX = /^----+\s*$/gm;
const NAMU_STRIKE_STRIP_REGEX = /~~([^~\n]+?)~~/g;

const CATEGORY_LABELS = {
  general: "일반",
  studies: "학습",
  clubs: "동아리",
  events: "행사",
  archives: "아카이브",
  notices: "공지",
};

function isLoggedIn() {
  return window.WikiAuth?.hasActiveSession?.() ?? false;
}

function canEdit() {
  return window.WikiAuth?.canEditWiki?.() ?? false;
}

function isWikiAdmin() {
  return window.WikiAuth?.isWikiAdmin?.() ?? false;
}

function applyAuthToDocument() {
  document.body.classList.toggle("is-authenticated", isLoggedIn());
  document.body.classList.toggle("is-school-editor", canEdit());
  document.body.classList.toggle("is-wiki-admin", isWikiAdmin());
  updateAuthBarUI();
  updateInlineSaveButton();
  updateGenSaveButtons();
}

function canSaveContent() {
  return canEdit() || (window.WikiAPI?.isMockMode?.() ?? false);
}

function getSchoolEditRequiredMessage() {
  return `${APP_CONFIG.allowedEmailDomain} 학교 이메일 계정만 편집·저장할 수 있습니다.`;
}

function promptForEditAuth() {
  if (canSaveContent()) return true;
  if (isLoggedIn()) {
    alert(getSchoolEditRequiredMessage());
    return false;
  }
  openLoginModal();
  return false;
}

function promptForAdminAuth() {
  if (!isLoggedIn()) {
    openLoginModal();
    return false;
  }
  if (!isWikiAdmin()) {
    alert("관리자만 댓글을 삭제할 수 있습니다.");
    return false;
  }
  return true;
}

function updateGenSaveButtons() {
  const canSave = canSaveContent();
  document
    .querySelectorAll('[data-action="save-archive"], [data-action="save-gen-comment"]')
    .forEach((btn) => {
      btn.disabled = !canSave;
      btn.title = canSave
        ? ""
        : getSchoolEditRequiredMessage();
    });
}

function getCategoryMetaTitle(categorySlug) {
  return `분류:${getCategoryLabel(categorySlug)}`;
}

function getGenerationDocTitle(genNumber) {
  return `제${genNumber}기`;
}

function buildWikiEditHref(title) {
  return `#/edit/${encodeURIComponent(title)}`;
}

function updateAuthBarUI() {
  const label = document.getElementById("authUserLabel");
  if (!label) return;

  if (!isLoggedIn()) return;

  const profile = getEditorProfile();
  const email = window.WikiAuth?.getCurrentUserEmail?.() || "";
  const displayName = profile.nickname || email.split("@")[0] || "회원";

  if (canEdit()) {
    const genText = profile.gen ? `${profile.gen}기 ` : "";
    const adminText = isWikiAdmin() ? " · 관리자" : "";
    label.textContent = `${genText}${displayName} (${email})${adminText}`;
    return;
  }

  label.textContent = `${displayName} (${email}) · 열람 계정`;
}

let authModalMode = "login";

function updateSignupProfileFields(email = "") {
  const isSchool = window.WikiAuth?.isSchoolEmail?.(email);
  const nicknameLabel = document.querySelector('label[for="signupNickname"]');
  const genLabel = document.querySelector('label[for="signupGen"]');
  const nicknameInput = document.getElementById("signupNickname");
  const genInput = document.getElementById("signupGen");
  const signupHint = document.getElementById("signupExtraHint");

  if (nicknameLabel) {
    nicknameLabel.innerHTML = isSchool
      ? '이름 <span class="label-required">(필수)</span>'
      : '이름 <span class="label-optional">(선택)</span>';
  }
  if (genLabel) {
    genLabel.innerHTML = isSchool
      ? '기수 <span class="label-required">(필수)</span>'
      : '기수 <span class="label-optional">(선택)</span>';
  }
  if (nicknameInput) nicknameInput.required = Boolean(isSchool);
  if (genInput) genInput.required = Boolean(isSchool);
  if (signupHint) {
    signupHint.innerHTML = isSchool
      ? `학교 이메일(<strong>${APP_CONFIG.allowedEmailDomain}</strong>) 가입 시 <strong>이름</strong>과 <strong>기수</strong>를 입력해 주세요.`
      : "외부 이메일도 가입할 수 있습니다. 문서 열람이 가능하며, 편집·저장은 학교 이메일 계정만 가능합니다.";
  }
}

function setAuthModalMode(mode = "login") {
  authModalMode = mode === "signup" ? "signup" : "login";
  const isSignup = authModalMode === "signup";

  document.getElementById("loginModalTitle").textContent = isSignup
    ? "회원가입"
    : "로그인";
  document.getElementById("signupExtraHint")?.classList.toggle("hidden", !isSignup);
  document.getElementById("signupProfileFields")?.classList.toggle("hidden", !isSignup);
  document.getElementById("signupPasswordConfirmLabel")?.classList.toggle("hidden", !isSignup);
  document.getElementById("signupPasswordConfirm")?.classList.toggle("hidden", !isSignup);

  const submitBtn = document.getElementById("authSubmitBtn");
  if (submitBtn) {
    submitBtn.textContent = isSignup ? "가입하기" : "로그인";
    submitBtn.dataset.action = isSignup ? "signup-submit" : "login-submit";
  }

  document.querySelectorAll(".auth-modal-tab").forEach((tab) => {
    const active = tab.dataset.authMode === authModalMode;
    tab.classList.toggle("auth-modal-tab--active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (isSignup) {
    const email = document.getElementById("loginEmail")?.value?.trim() || "";
    updateSignupProfileFields(email);
  }
}

function openLoginModal(mode = "login") {
  const modal = document.getElementById("loginModal");
  const errorEl = document.getElementById("loginError");
  const successEl = document.getElementById("loginSuccess");
  const domainHint = document.getElementById("loginDomainHint");
  if (!modal) return;

  setAuthModalMode(mode);
  if (domainHint) domainHint.textContent = APP_CONFIG.allowedEmailDomain;
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  if (successEl) {
    successEl.textContent = "";
    successEl.classList.add("hidden");
  }

  const genInput = document.getElementById("signupGen");
  if (genInput && !genInput.value) {
    genInput.placeholder = `예: ${getCurrentGen()}`;
    genInput.value = String(getCurrentGen());
  }

  updateSignupProfileFields(document.getElementById("loginEmail")?.value?.trim() || "");

  modal.classList.remove("hidden");
}

async function completeAuthSuccess() {
  closeLoginModal();
  applyAuthToDocument();
  updateInlineSaveButton();
  updateSaveButtonState();

  if (pendingEditAfterLogin) {
    pendingEditAfterLogin = false;
    await enterInlineEditMode();
  }
}

function redirectToHomeWithAuthMessage() {
  stopDraftAutosave();
  currentEditTitle = null;
  sessionStorage.setItem(AUTH_NOTICE_KEY, "로그인이 필요한 서비스입니다.");

  if (window.location.hash !== "#/" && window.location.hash !== "#") {
    window.location.hash = "#/";
    return;
  }

  renderRoute("home");
}

function getAuthNoticeHTML() {
  const message = sessionStorage.getItem(AUTH_NOTICE_KEY);
  if (!message) return "";

  sessionStorage.removeItem(AUTH_NOTICE_KEY);
  return `<div class="auth-notice" role="alert">${escapeHtml(message)}</div>`;
}

function getMockModeBannerHTML() {
  if (!window.WikiAPI?.isMockMode?.()) return "";
  return `<div class="mock-notice" role="status">데모 모드: 더미 데이터로 화면을 미리볼 수 있습니다. Supabase를 연결하면 실제 DB를 사용합니다.</div>`;
}

function getSupabaseReadFallbackNoticeHTML() {
  if (window.WikiAPI?.isMockMode?.()) return "";
  if (!window.WikiAPI?.isReadFallbackActive?.()) return "";
  return `<div class="mock-notice" role="status">DB에 문서가 없거나 테이블 연결에 문제가 있어 <strong>로컬 문서</strong>로 표시 중입니다. SQL Editor에서 <code>supabase/schema.sql</code>과 <code>supabase/seed-school-intro.sql</code>을 실행한 뒤 새로고침하세요.</div>`;
}

function getViewNoticeHTML() {
  return `${getAuthNoticeHTML()}${getMockModeBannerHTML()}${getSupabaseReadFallbackNoticeHTML()}`;
}

function requireAuthForEdit() {
  if (canEdit()) return true;
  openLoginModal();
  return false;
}

let pendingEditAfterLogin = false;

function isStubArticle(article) {
  if (!article) return false;
  if (article.isMissing) return true;
  if (!(article.content || "").trim()) return true;
  return article.category === STUB_CATEGORY;
}

function getCategoryLabel(category) {
  if (!category) return "일반";
  return CATEGORY_LABELS[category] || category;
}

function getWikiDocFooterHTML(category, isStub = false) {
  const cat = isStub ? STUB_CATEGORY : category || "general";
  const label = isStub ? STUB_CATEGORY : getCategoryLabel(category);
  return `
    <footer class="wiki-doc-footer">
      <strong class="wiki-category-tag">[분류: <a href="#/category/${encodeURIComponent(cat)}" class="wiki-category-link">${escapeHtml(label)}</a>]</strong>
    </footer>
  `;
}

function getStubFooterHTML() {
  return getWikiDocFooterHTML(STUB_CATEGORY, true);
}

function buildWikiToolbarHTML(articleId, activeTab = "read") {
  const tabs = [
    { id: "read", action: "wiki-tab-read", label: "문서" },
    { id: "edit", action: "wiki-edit", label: "편집" },
    {
      id: "history",
      action: "wiki-history",
      label: "역사",
      disabled: !articleId,
      articleId,
    },
  ];

  const items = tabs
    .map((tab) => {
      const activeClass = tab.id === activeTab ? " wiki-tab--active" : "";
      const disabled = tab.disabled ? " disabled" : "";
      const articleAttr = tab.articleId
        ? ` data-article-id="${escapeHtml(String(tab.articleId))}"`
        : "";
      return `<button type="button" class="wiki-tab${activeClass}" data-action="${tab.action}"${articleAttr}${disabled}>[${tab.label}]</button>`;
    })
    .join("");

  return `<nav class="wiki-tab-nav" aria-label="문서 탭">${items}</nav>`;
}

function updateWikiTabState(activeTab) {
  document.querySelectorAll(".wiki-tab-nav .wiki-tab").forEach((btn) => {
    const action = btn.dataset.action;
    const isActive =
      (activeTab === "read" && action === "wiki-tab-read") ||
      (activeTab === "edit" && action === "wiki-edit") ||
      (activeTab === "history" && action === "wiki-history");
    btn.classList.toggle("wiki-tab--active", isActive);
  });
}

const WIKI_SYNTAX_SNIPPETS = {
  h2: { before: "== ", after: " ==", placeholder: "1. 섹션 제목" },
  h3: { before: "=== ", after: " ===", placeholder: "소제목" },
  bold: { before: "'''", after: "'''", placeholder: "굵게" },
  italic: { before: "''", after: "''", placeholder: "기울임" },
  link: { before: "[[", after: "]]", placeholder: "문서명" },
  linkAlias: { before: "[[", after: "|표시]]", placeholder: "문서명" },
  footnote: { before: "[* ", after: "]", placeholder: "각주 내용" },
  list: { before: "- ", after: "", placeholder: "목록 항목" },
  quote: { before: "> ", after: "", placeholder: "인용문" },
  hr: { before: "----\n", after: "", placeholder: "" },
  code: { before: "```\n", after: "\n```", placeholder: "코드" },
  image: { before: "![", after: "](https://)", placeholder: "이미지 설명" },
};

const WIKI_TABLE_TEMPLATE = `| 열1 | 열2 | 열3 |
|------|------|------|
| 내용 | 내용 | 내용 |
| 내용 | 내용 | 내용 |
`;

function isMarkdownTableLine(line) {
  const trimmed = (line || "").trim();
  return trimmed.startsWith("|") && trimmed.length > 1;
}

function isMarkdownTableSeparatorLine(line) {
  return /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line || "");
}

function getCursorLineIndex(text, cursorPos) {
  let line = 0;
  const limit = Math.min(cursorPos, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function findMarkdownTableBlockAtCursor(text, cursorPos) {
  const lines = text.split("\n");
  const cursorLine = getCursorLineIndex(text, cursorPos);
  if (!isMarkdownTableLine(lines[cursorLine])) return null;

  let startLine = cursorLine;
  let endLine = cursorLine;
  while (startLine > 0 && isMarkdownTableLine(lines[startLine - 1])) {
    startLine -= 1;
  }
  while (endLine < lines.length - 1 && isMarkdownTableLine(lines[endLine + 1])) {
    endLine += 1;
  }

  const blockLines = lines.slice(startLine, endLine + 1);
  if (blockLines.length < 2 || !blockLines.some(isMarkdownTableSeparatorLine)) {
    return null;
  }

  let startIndex = 0;
  for (let i = 0; i < startLine; i += 1) {
    startIndex += lines[i].length + 1;
  }
  const endIndex = startIndex + blockLines.join("\n").length;

  return {
    startLine,
    endLine,
    cursorLine,
    lines: blockLines,
    startIndex,
    endIndex,
  };
}

function countMarkdownTableColumns(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").length;
}

function replaceEditorTextRange(editor, start, end, replacement) {
  const scrollTop = editor.scrollTop;
  editor.setRangeText(replacement, start, end, "end");
  editor.scrollTop = scrollTop;
  editor.focus();
}

function addWikiTableRow(editorTarget = "articleEditor") {
  const editor = getWikiTextarea(editorTarget);
  if (!editor) return;

  const block = findMarkdownTableBlockAtCursor(editor.value, editor.selectionStart);
  if (!block) {
    alert("표 안에 커서를 놓은 뒤 행+ 버튼을 눌러주세요.");
    return;
  }

  const colCount = countMarkdownTableColumns(block.lines[0]);
  const newRow = `| ${Array(colCount).fill("내용").join(" | ")} |`;
  const rowIndexInBlock = block.cursorLine - block.startLine;
  const updatedLines = [...block.lines];
  updatedLines.splice(rowIndexInBlock + 1, 0, newRow);

  replaceEditorTextRange(
    editor,
    block.startIndex,
    block.endIndex,
    updatedLines.join("\n")
  );
}

function addWikiTableColumn(editorTarget = "articleEditor") {
  const editor = getWikiTextarea(editorTarget);
  if (!editor) return;

  const block = findMarkdownTableBlockAtCursor(editor.value, editor.selectionStart);
  if (!block) {
    alert("표 안에 커서를 놓은 뒤 열+ 버튼을 눌러주세요.");
    return;
  }

  const updatedLines = block.lines.map((line) => {
    if (isMarkdownTableSeparatorLine(line)) {
      return `${line.trimEnd()} ------ |`;
    }
    return `${line.trimEnd()} 내용 |`;
  });

  replaceEditorTextRange(
    editor,
    block.startIndex,
    block.endIndex,
    updatedLines.join("\n")
  );
}

function getWikiTextarea(editorTarget = "articleEditor") {
  return document.getElementById(editorTarget);
}

function insertTextIntoWikiEditor(editor, text, selectStart = null, selectEnd = null) {
  if (!editor) return;

  const start = editor.selectionStart;
  editor.setRangeText(text, start, start, "end");
  editor.focus();

  if (selectStart != null && selectEnd != null) {
    const from = start + selectStart;
    const to = start + selectEnd;
    editor.setSelectionRange(from, to);
  }
}

function insertWikiTable(editorTarget = "articleEditor") {
  const editor = getWikiTextarea(editorTarget);
  if (!editor) return;

  if (findMarkdownTableBlockAtCursor(editor.value, editor.selectionStart)) {
    alert("표 안에서는 행+ / 열+ 버튼으로 편집하세요.\n새 표는 표 밖에 커서를 두고 표 버튼을 눌러주세요.");
    return;
  }

  const prefix = editor.value.slice(0, editor.selectionStart).endsWith("\n") ? "" : "\n";
  const template = `${prefix}${WIKI_TABLE_TEMPLATE}\n`;
  insertTextIntoWikiEditor(editor, template, prefix.length + 2, prefix.length + 4);
}

function insertWikiImage(editorTarget = "articleEditor") {
  const editor = getWikiTextarea(editorTarget);
  if (!editor) return;

  const urlInput = window.prompt(
    "이미지 주소(URL)를 입력하세요.\n예: https://example.com/photo.jpg",
    "https://"
  );
  if (urlInput === null) return;

  const url = urlInput.trim();
  if (!url) return;

  const altInput = window.prompt("이미지 설명(캡션, 선택)", "이미지");
  const alt = (altInput || "이미지").trim() || "이미지";
  const prefix = editor.value.slice(0, editor.selectionStart).endsWith("\n") ? "" : "\n";
  const markdown = `${prefix}![${alt}](${url})\n`;
  insertTextIntoWikiEditor(editor, markdown);
}

function buildWikiSyntaxToolbarHTML(editorTarget = "") {
  const tools = [
    { key: "h2", label: "==" },
    { key: "h3", label: "===" },
    { key: "bold", label: "'''굵게'''" },
    { key: "italic", label: "''기울임''" },
    { key: "link", label: "[[링크]]" },
    { key: "linkAlias", label: "[[링크|표시]]" },
    { key: "footnote", label: "[*각주]" },
    { key: "list", label: "목록" },
    { key: "table", label: "표", action: "wiki-insert-table", title: "새 표 삽입" },
    { key: "tableRow", label: "행+", action: "wiki-table-add-row", title: "표에 행 추가" },
    { key: "tableCol", label: "열+", action: "wiki-table-add-col", title: "표에 열 추가" },
    { key: "image", label: "그림", action: "wiki-insert-image" },
    { key: "hr", label: "----" },
    { key: "quote", label: "인용" },
    { key: "code", label: "코드" },
  ];

  const targetAttr = editorTarget
    ? ` data-editor-target="${escapeHtml(editorTarget)}"`
    : "";

  return tools
    .map((tool) => {
      const action = tool.action || "wiki-insert-syntax";
      const snippetAttr = tool.key ? ` data-snippet="${tool.key}"` : "";
      const titleAttr = tool.title ? ` title="${escapeHtml(tool.title)}"` : ' title="문법 삽입"';
      return `<button type="button" class="wiki-syntax-btn" data-action="${action}"${snippetAttr}${targetAttr}${titleAttr}>${escapeHtml(tool.label)}</button>`;
    })
    .join("");
}

function buildWikiSyntaxHelpHTML() {
  return `
    <details class="wiki-syntax-help">
      <summary>나무위키형 문법 도움말</summary>
      <ul>
        <li><code>== 제목 ==</code> 섹션 제목 (나무위키 스타일)</li>
        <li><code>=== 소제목 ===</code> 하위 섹션</li>
        <li><code>[[문서명]]</code> 내부 링크 (없으면 빨간색)</li>
        <li><code>[[문서명|표시]]</code> 다른 이름으로 링크</li>
        <li><code>'''굵게'''</code>, <code>''기울임''</code> (또는 <code>**</code>, <code>*</code>)</li>
        <li><code>[* 각주 내용]</code> 각주 — 본문에 [1] 표시, 하단에 목록</li>
        <li><code>- 목록</code>, <code>&gt; 인용</code>, <code>----</code> 구분선</li>
        <li><code>| 열1 | 열2 |</code> 표 — <strong>표</strong>로 새 표 삽입, <strong>행+ / 열+</strong>로 기존 표 편집</li>
        <li><code>![설명](https://주소)</code> 그림 — 툴바 <strong>그림</strong> 버튼으로 URL 입력</li>
        <li>섹션이 2개 이상이면 자동 <strong>목차</strong> 생성</li>
      </ul>
    </details>
  `;
}

function buildWikiEditorPanelHTML(title) {
  return `
    <div id="wikiEditorPanel" class="wiki-editor-panel hidden">
      <header class="wiki-edit-header">
        <h3 class="wiki-edit-heading">문서 편집</h3>
        <p class="wiki-edit-doc-title">${escapeHtml(title)}</p>
      </header>

      <div id="wikiEditorEditView" class="wiki-editor-edit-view">
        <div class="wiki-syntax-toolbar" role="toolbar" aria-label="문법 도구">
          ${buildWikiSyntaxToolbarHTML()}
        </div>
        <textarea
          id="articleEditor"
          class="wiki-editor-textarea"
          spellcheck="false"
          placeholder="나무위키형 문법으로 작성하세요. == 제목 ==, [[링크]], [* 각주] 등을 사용할 수 있습니다."
        ></textarea>
        ${buildWikiSyntaxHelpHTML()}
      </div>

      <div id="wikiPreviewPanel" class="wiki-preview-panel hidden">
        <p class="wiki-preview-label">미리보기</p>
        <div id="wikiPreviewBody" class="wiki-markdown wiki-preview-body"></div>
      </div>

      <footer class="wiki-edit-footer">
        <label class="editor-label" for="editSummaryInput">편집 요약</label>
        <input
          id="editSummaryInput"
          class="editor-input edit-summary-input"
          type="text"
          maxlength="120"
          placeholder="예: 오타 수정, 내용 추가, 링크 보강"
        />
        <p id="draftStatus" class="editor-hint">편집 중 자동 저장: 1분마다 로컬에 저장됩니다.</p>
        <div class="wiki-edit-actions">
          <button type="button" class="wiki-tool-btn" data-action="wiki-preview" id="wikiPreviewBtn">[미리보기]</button>
          <button type="button" class="wiki-tool-btn hidden" data-action="wiki-back-edit" id="wikiBackEditBtn">[편집으로]</button>
          <button type="button" class="wiki-tool-btn" data-action="wiki-cancel-edit">[취소]</button>
          <button type="button" class="wiki-tool-btn wiki-tool-btn--primary" id="wikiSaveBtn" data-action="save-article" disabled>[저장]</button>
        </div>
      </footer>
    </div>
  `;
}

function insertWikiSyntax(snippetKey, editorTarget = "articleEditor") {
  const editor = getWikiTextarea(editorTarget);
  const snippet = WIKI_SYNTAX_SNIPPETS[snippetKey];
  if (!editor || !snippet) return;

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const text = selected || snippet.placeholder || "";
  const insertion = `${snippet.before}${text}${snippet.after}`;

  editor.setRangeText(insertion, start, end, "end");
  editor.focus();

  if (!selected && snippet.placeholder) {
    const selectStart = start + snippet.before.length;
    const selectEnd = selectStart + text.length;
    editor.setSelectionRange(selectStart, selectEnd);
    return;
  }

  if (snippetKey === "image" && !selected) {
    const urlStart = start + snippet.before.length + text.length + 2;
    editor.setSelectionRange(urlStart, urlStart + 8);
  }
}

async function showWikiPreview() {
  const editor = document.getElementById("articleEditor");
  const editView = document.getElementById("wikiEditorEditView");
  const previewPanel = document.getElementById("wikiPreviewPanel");
  const previewBody = document.getElementById("wikiPreviewBody");
  const previewBtn = document.getElementById("wikiPreviewBtn");
  const backEditBtn = document.getElementById("wikiBackEditBtn");
  if (!editor || !editView || !previewPanel || !previewBody) return;

  const { html } = await renderNamuMarkdownAsync(editor.value);
  previewBody.innerHTML = html;
  editView.classList.add("hidden");
  previewPanel.classList.remove("hidden");
  previewBtn?.classList.add("hidden");
  backEditBtn?.classList.remove("hidden");

  const pageDescription = document.getElementById("pageDescription");
  if (pageDescription) pageDescription.textContent = "미리보기 모드";
}

function showWikiEditView() {
  const editView = document.getElementById("wikiEditorEditView");
  const previewPanel = document.getElementById("wikiPreviewPanel");
  const previewBtn = document.getElementById("wikiPreviewBtn");
  const backEditBtn = document.getElementById("wikiBackEditBtn");
  const editor = document.getElementById("articleEditor");

  editView?.classList.remove("hidden");
  previewPanel?.classList.add("hidden");
  previewBtn?.classList.remove("hidden");
  backEditBtn?.classList.add("hidden");

  const pageDescription = document.getElementById("pageDescription");
  if (pageDescription) pageDescription.textContent = "문서 편집 모드";

  editor?.focus();
}

function closeLoginModal() {
  document.getElementById("loginModal")?.classList.add("hidden");
}

function updateInlineSaveButton() {
  const saveBtn = document.getElementById("wikiSaveBtn");
  if (!saveBtn) return;
  const canSave = canSaveContent();
  saveBtn.disabled = !canSave;
  saveBtn.title = canSave
    ? "문서를 저장합니다."
    : getSchoolEditRequiredMessage();
}

function hideWikiPanels() {
  document.getElementById("wikiHistoryPanel")?.classList.add("hidden");
  document.getElementById("wikiEditorPanel")?.classList.add("hidden");
  document.getElementById("wikiArticleBody")?.classList.remove("hidden");
  showWikiEditView();
  updateWikiTabState("read");
}

async function refreshWikiArticleBody() {
  const body = document.getElementById("wikiArticleBody");
  const tocEl = document.getElementById("wikiTOC");
  if (!body || !currentArticleState) return;

  if (currentArticleState.isMissing) {
    body.innerHTML =
      '<div class="wiki-empty-notice"><p>이 문서는 아직 작성되지 않았습니다.</p></div>';
    tocEl?.classList.add("hidden");
    if (tocEl) tocEl.innerHTML = "";
    return;
  }

  const { html, tocHtml } = await renderNamuMarkdownAsync(
    currentArticleState.content || ""
  );
  body.innerHTML = `<section class="wiki-markdown">${html}</section>`;
  if (tocEl) {
    if (tocHtml) {
      tocEl.innerHTML = tocHtml;
      tocEl.classList.remove("hidden");
    } else {
      tocEl.innerHTML = "";
      tocEl.classList.add("hidden");
    }
  }
}

function updateWikiMetaBar() {
  const meta = document.getElementById("wikiMetaBar");
  if (!meta || !currentArticleState) return;

  meta.textContent = currentArticleState.isMissing
    ? "마지막 수정일: 수정 이력 없음"
    : `마지막 수정일: ${formatDateTime(currentArticleState.updatedAt)}`;
}

function updateStubFooter() {
  const footer = document.getElementById("wikiDocFooter");
  if (!footer || !currentArticleState) return;

  const isStub = isStubArticle(currentArticleState);
  footer.innerHTML = getWikiDocFooterHTML(
    currentArticleState.category,
    isStub
  );
}

function updateHistoryButton() {
  const btn = document.querySelector('[data-action="wiki-history"]');
  if (!btn) return;
  const articleId = currentArticleState?.id;
  btn.toggleAttribute("disabled", !articleId);
  if (articleId) btn.dataset.articleId = String(articleId);
}

async function enterInlineEditMode() {
  const title = currentArticleState?.title;
  if (!title) return false;

  const readBody = document.getElementById("wikiArticleBody");
  const editPanel = document.getElementById("wikiEditorPanel");
  const historyPanel = document.getElementById("wikiHistoryPanel");
  const editor = document.getElementById("articleEditor");
  if (!readBody || !editPanel || !editor) return false;

  historyPanel?.classList.add("hidden");
  editor.value = resolveEditContent(title, currentArticleState.content || "");
  readBody.classList.add("hidden");
  editPanel.classList.remove("hidden");
  showWikiEditView();

  currentEditTitle = title;
  startDraftAutosave(title);
  updateInlineSaveButton();
  updateWikiTabState("edit");

  const pageDescription = document.getElementById("pageDescription");
  const pageTitleEl = document.getElementById("pageTitle");
  if (pageDescription) pageDescription.textContent = "문서 편집 모드";
  if (pageTitleEl) pageTitleEl.textContent = `${title} 편집`;

  editor.focus();
  return true;
}

function exitInlineEditMode() {
  hideWikiPanels();
  currentEditTitle = null;
  stopDraftAutosave();

  const pageTitleEl = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  if (pageTitleEl && currentArticleState?.title) {
    pageTitleEl.textContent = currentArticleState.title;
  }
  if (pageDescription && currentArticleState) {
    if (currentCategorySlug) {
      pageDescription.textContent = `${getCategoryLabel(currentCategorySlug)} 카테고리 · [편집]에서 분류 설명을 작성할 수 있습니다.`;
    } else {
      pageDescription.textContent = currentArticleState.isMissing
        ? "아직 작성되지 않은 문서입니다."
        : "문서 읽기 모드";
    }
  }
}

function formatEditorLabel(nickname, gen) {
  const safeNickname = escapeHtml(nickname || "익명");
  if (gen) return `${escapeHtml(String(gen))}기 ${safeNickname}`;
  return safeNickname;
}

function getEditorProfile() {
  return (
    window.WikiAuth?.getEditorProfile?.() ?? {
      nickname: "익명",
      gen: null,
    }
  );
}

function buildRevisionTimelineHTML(revisions, article) {
  const currentVersion = revisions.length + 1;
  const editor = getEditorProfile();

  const currentItem = `
    <li class="revision-timeline-item revision-timeline-item--current">
      <span class="revision-dot" aria-hidden="true"></span>
      <article class="revision-card">
        <header class="revision-card-head">
          <span class="revision-version">r${currentVersion} (현재)</span>
          <time class="revision-time">${escapeHtml(formatDateTime(article?.updatedAt))}</time>
        </header>
        <p class="revision-editor">${formatEditorLabel(editor.nickname, editor.gen)}</p>
        <p class="revision-summary">현재 문서 내용</p>
      </article>
    </li>
  `;

  const historyItems = revisions
    .map(
      (rev) => `
      <li class="revision-timeline-item">
        <span class="revision-dot" aria-hidden="true"></span>
        <article class="revision-card">
          <header class="revision-card-head">
            <span class="revision-version">r${rev.version}</span>
            <time class="revision-time">${escapeHtml(formatDateTime(rev.created_at))}</time>
          </header>
          <p class="revision-editor">${formatEditorLabel(rev.editor_nickname, rev.editor_gen)}</p>
          <p class="revision-summary">${escapeHtml(rev.edit_summary || "(요약 없음)")}</p>
        </article>
      </li>
    `
    )
    .join("");

  return `
    <div class="revision-history-wrap">
      <div class="wiki-inline-actions">
        <button type="button" class="wiki-tool-btn" data-action="wiki-close-history">[문서로 돌아가기]</button>
      </div>
      <h3 class="revision-history-title">${escapeHtml(article?.title || "문서")} 역사</h3>
      <p class="revision-history-desc">총 ${currentVersion}개 버전 · 아래는 저장 시점 기록입니다.</p>
      <ol class="revision-timeline">${currentItem}${historyItems}</ol>
    </div>
  `;
}

async function showArticleHistory(articleId) {
  const panel = document.getElementById("wikiHistoryPanel");
  const readBody = document.getElementById("wikiArticleBody");
  const editPanel = document.getElementById("wikiEditorPanel");
  const pageDescription = document.getElementById("pageDescription");
  if (!panel || !articleId) return;

  readBody?.classList.add("hidden");
  editPanel?.classList.add("hidden");
  panel.classList.remove("hidden");
  panel.innerHTML = "<p>역사를 불러오는 중...</p>";

  if (pageDescription) {
    pageDescription.textContent = "문서 수정 역사";
  }
  updateWikiTabState("history");

  try {
    const revisions = await window.WikiAPI.getArticleRevisionHistory(articleId);
    const article = currentArticleState || { title: "", updatedAt: null };
    panel.innerHTML = buildRevisionTimelineHTML(revisions, {
      title: article.title,
      updatedAt: article.updatedAt,
    });
  } catch (error) {
    console.error("Failed to load history:", error);
    panel.innerHTML = "<p>역사를 불러오지 못했습니다.</p>";
  }
}

function initLoginModal() {
  const loginEmailInput = document.getElementById("loginEmail");
  loginEmailInput?.addEventListener("input", () => {
    if (authModalMode !== "signup") return;
    updateSignupProfileFields(loginEmailInput.value.trim());
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;

    if (action === "close-login-modal") {
      closeLoginModal();
      pendingEditAfterLogin = false;
      return;
    }

    if (action === "open-auth-modal") {
      openLoginModal(target.dataset.authMode || "login");
      return;
    }

    if (action === "switch-auth-mode") {
      setAuthModalMode(target.dataset.authMode || "login");
      return;
    }

    if (action === "logout-submit") {
      try {
        await window.WikiAuth.signOut();
        applyAuthToDocument();
        updateInlineSaveButton();
        updateSaveButtonState();
      } catch (error) {
        console.error("Failed to sign out:", error);
        alert("로그아웃에 실패했습니다.");
      }
      return;
    }

    if (action === "login-submit" || action === "signup-submit") {
      const email = document.getElementById("loginEmail")?.value?.trim();
      const password = document.getElementById("loginPassword")?.value || "";
      const errorEl = document.getElementById("loginError");
      const successEl = document.getElementById("loginSuccess");

      const showError = (message) => {
        if (errorEl) {
          errorEl.textContent = message;
          errorEl.classList.remove("hidden");
        }
        successEl?.classList.add("hidden");
      };

      if (!email || !password) {
        showError("이메일과 비밀번호를 입력해주세요.");
        return;
      }

      try {
        if (action === "signup-submit") {
          const confirmPassword =
            document.getElementById("signupPasswordConfirm")?.value || "";
          if (password !== confirmPassword) {
            showError("비밀번호 확인이 일치하지 않습니다.");
            return;
          }

          const nickname =
            document.getElementById("signupNickname")?.value?.trim() || "";
          const gen = document.getElementById("signupGen")?.value?.trim() || "";
          const isSchool = window.WikiAuth?.isSchoolEmail?.(email);

          if (isSchool) {
            if (!nickname) {
              showError("이름을 입력해주세요.");
              return;
            }
            if (!gen) {
              showError("기수를 입력해주세요.");
              return;
            }
            const genNumber = Number(gen);
            if (!Number.isInteger(genNumber) || genNumber < 1 || genNumber > getMaxGen()) {
              showError(`기수는 1~${getMaxGen()} 사이 숫자로 입력해주세요.`);
              return;
            }
          }

          const result = await window.WikiAuth.signUpWithEmail(email, password, {
            nickname,
            gen: gen ? String(Number(gen)) : "",
          });

          if (result.needsEmailConfirmation) {
            if (successEl) {
              successEl.textContent =
                "가입 메일을 보냈습니다. 이메일 인증 후 로그인하면 편집할 수 있습니다.";
              successEl.classList.remove("hidden");
            }
            errorEl?.classList.add("hidden");
            return;
          }

          if (!window.WikiAuth.hasActiveSession()) {
            showError(
              "가입은 완료됐지만 로그인 세션이 없습니다. 로그인 탭에서 다시 시도해주세요."
            );
            setAuthModalMode("login");
            return;
          }

          await completeAuthSuccess();
          return;
        }

        await window.WikiAuth.signInWithEmail(email, password);
        await completeAuthSuccess();
      } catch (error) {
        showError(error.message || "인증에 실패했습니다.");
      }
    }
  });
}

function getDraftKey(title) {
  return `jshs-wiki-draft:${title}`;
}

function saveDraftToLocal(title, content) {
  localStorage.setItem(
    getDraftKey(title),
    JSON.stringify({
      content,
      savedAt: Date.now(),
    })
  );
}

function loadDraftFromLocal(title) {
  const raw = localStorage.getItem(getDraftKey(title));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft(title) {
  localStorage.removeItem(getDraftKey(title));
}

function stopDraftAutosave() {
  if (draftAutosaveTimer) {
    clearInterval(draftAutosaveTimer);
    draftAutosaveTimer = null;
  }
}

function updateDraftStatusMessage(title) {
  const statusEl = document.getElementById("draftStatus");
  if (!statusEl) return;

  const draft = loadDraftFromLocal(title);
  if (!draft?.savedAt) {
    statusEl.textContent = "편집 중 자동 저장: 1분마다 로컬에 저장됩니다.";
    return;
  }

  statusEl.textContent = `마지막 자동 저장: ${formatDateTime(new Date(draft.savedAt).toISOString())}`;
}

function startDraftAutosave(title) {
  stopDraftAutosave();
  draftAutosaveTimer = setInterval(() => {
    const editor = document.getElementById("articleEditor");
    if (!editor || currentEditTitle !== title) return;

    saveDraftToLocal(title, editor.value);
    updateDraftStatusMessage(title);
  }, DRAFT_AUTOSAVE_MS);
}

function updateSaveButtonState() {
  updateInlineSaveButton();
  updateGenSaveButtons();
}

function createGenerationLinks() {
  const listEl = document.getElementById("generationList");
  if (!listEl) return;

  listEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (let start = 1; start <= getMaxGen(); start += GEN_GROUP_SIZE) {
    const end = Math.min(start + GEN_GROUP_SIZE - 1, getMaxGen());
    const groupLi = document.createElement("li");
    groupLi.className = "gen-group";
    groupLi.dataset.start = String(start);
    groupLi.dataset.end = String(end);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "gen-group-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent =
      start === end ? `${start}기` : `${start}~${end}기`;

    const subList = document.createElement("ul");
    subList.className = "gen-sub-list link-list hidden";

    for (let gen = start; gen <= end; gen += 1) {
      const itemLi = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#/generation/${gen}`;
      link.className = "gen-sub-link";
      link.dataset.gen = String(gen);
      const entranceYear = getGenEntranceYear(gen);
      link.textContent = `${gen}기 (${entranceYear})`;
      if (gen === getCurrentGen()) link.classList.add("gen-sub-link--current");
      itemLi.appendChild(link);
      subList.appendChild(itemLi);
    }

    toggle.addEventListener("click", () => {
      const isOpen = groupLi.classList.contains("gen-group--open");
      collapseAllGenerationGroups();
      if (!isOpen) openGenerationGroup(groupLi);
    });

    groupLi.appendChild(toggle);
    groupLi.appendChild(subList);
    fragment.appendChild(groupLi);
  }

  listEl.appendChild(fragment);
  openGenerationGroupForGen(getCurrentGen());
}

function collapseAllGenerationGroups() {
  document.querySelectorAll(".gen-group").forEach((group) => {
    group.classList.remove("gen-group--open");
    group.querySelector(".gen-sub-list")?.classList.add("hidden");
    group
      .querySelector(".gen-group-toggle")
      ?.setAttribute("aria-expanded", "false");
  });
}

function openGenerationGroup(groupEl) {
  if (!groupEl) return;
  groupEl.classList.add("gen-group--open");
  groupEl.querySelector(".gen-sub-list")?.classList.remove("hidden");
  groupEl
    .querySelector(".gen-group-toggle")
    ?.setAttribute("aria-expanded", "true");
}

function openGenerationGroupForGen(genNumber) {
  const start = getGenGroupStart(genNumber);
  const group = document.querySelector(`.gen-group[data-start="${start}"]`);
  collapseAllGenerationGroups();
  openGenerationGroup(group);
}

function highlightGenerationNav(genNumber) {
  document.querySelectorAll(".gen-sub-link").forEach((link) => {
    link.classList.toggle(
      "gen-sub-link--active",
      link.dataset.gen === String(genNumber)
    );
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(rawDate) {
  if (!rawDate) return "수정일 정보 없음";
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return "수정일 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function setViewLoading(message = "불러오는 중...") {
  const viewContainer = document.getElementById("viewContainer");
  if (!viewContainer) return;
  viewContainer.innerHTML = `<article class="wiki-card loading-state"><p>${escapeHtml(message)}</p></article>`;
}

async function ensureArticleTitleCache() {
  if (articleTitleCache) return articleTitleCache;

  if (!articleTitleCachePromise) {
    articleTitleCachePromise = window.WikiAPI.getAllArticleTitles()
      .then((titles) => {
        articleTitleCache = titles;
        return titles;
      })
      .catch((error) => {
        console.error("Failed to load article titles:", error);
        articleTitleCache = new Set();
        return articleTitleCache;
      });
  }

  return articleTitleCachePromise;
}

function invalidateArticleTitleCache() {
  articleTitleCache = null;
  articleTitleCachePromise = null;
}

const SEARCH_SUGGESTION_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 120;

let searchDebounceTimer = null;
let searchActiveIndex = -1;
let searchCurrentMatches = [];

function normalizeSearchQuery(value) {
  return (value || "").trim().toLowerCase();
}

function filterArticleTitles(titles, query) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];

  return Array.from(titles)
    .filter((title) => title.toLowerCase().includes(normalized))
    .sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aStarts = aLower.startsWith(normalized);
      const bStarts = bLower.startsWith(normalized);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.localeCompare(b, "ko");
    })
    .slice(0, SEARCH_SUGGESTION_LIMIT);
}

function highlightSearchMatch(title, query) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return escapeHtml(title);

  const lowerTitle = title.toLowerCase();
  const start = lowerTitle.indexOf(normalized);
  if (start === -1) return escapeHtml(title);

  const end = start + normalized.length;
  return `${escapeHtml(title.slice(0, start))}<mark>${escapeHtml(title.slice(start, end))}</mark>${escapeHtml(title.slice(end))}`;
}

function hideSearchSuggestions() {
  const list = document.getElementById("searchSuggestions");
  const input = document.getElementById("searchInput");
  if (!list) return;

  list.classList.add("hidden");
  list.innerHTML = "";
  searchActiveIndex = -1;
  searchCurrentMatches = [];
  input?.setAttribute("aria-expanded", "false");
}

function navigateToWikiTitle(title) {
  const normalized = (title || "").trim();
  if (!normalized) return;

  hideSearchSuggestions();
  const input = document.getElementById("searchInput");
  if (input) input.value = normalized;

  window.location.hash = buildWikiLinkHref(normalized);
}

function renderSearchSuggestions(matches, query) {
  const list = document.getElementById("searchSuggestions");
  const input = document.getElementById("searchInput");
  if (!list || !input) return;

  searchCurrentMatches = matches;
  searchActiveIndex = matches.length ? 0 : -1;

  if (!matches.length) {
    hideSearchSuggestions();
    return;
  }

  list.innerHTML = matches
    .map(
      (title, index) => `
      <li role="presentation">
        <button
          type="button"
          class="search-suggestion-item${index === searchActiveIndex ? " is-active" : ""}"
          role="option"
          aria-selected="${index === searchActiveIndex ? "true" : "false"}"
          data-title="${escapeHtml(title)}"
        >${highlightSearchMatch(title, query)}</button>
      </li>
    `
    )
    .join("");

  list.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
}

function updateSearchActiveItem() {
  const list = document.getElementById("searchSuggestions");
  if (!list) return;

  list.querySelectorAll(".search-suggestion-item").forEach((item, index) => {
    const isActive = index === searchActiveIndex;
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive) item.scrollIntoView({ block: "nearest" });
  });
}

async function refreshSearchSuggestions(query) {
  const titles = await ensureArticleTitleCache();
  const matches = filterArticleTitles(titles, query);
  renderSearchSuggestions(matches, query);
}

function initArticleSearch() {
  const input = document.getElementById("searchInput");
  const list = document.getElementById("searchSuggestions");
  if (!input || !list) return;

  ensureArticleTitleCache().catch((error) => {
    console.error("Failed to preload article titles for search:", error);
  });

  input.addEventListener("input", () => {
    const query = input.value;
    clearTimeout(searchDebounceTimer);

    if (!query.trim()) {
      hideSearchSuggestions();
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      refreshSearchSuggestions(query).catch((error) => {
        console.error("Failed to refresh search suggestions:", error);
        hideSearchSuggestions();
      });
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSearchSuggestions();
      return;
    }

    if (event.key === "ArrowDown") {
      if (!searchCurrentMatches.length) return;
      event.preventDefault();
      searchActiveIndex = Math.min(
        searchActiveIndex + 1,
        searchCurrentMatches.length - 1
      );
      updateSearchActiveItem();
      return;
    }

    if (event.key === "ArrowUp") {
      if (!searchCurrentMatches.length) return;
      event.preventDefault();
      searchActiveIndex = Math.max(searchActiveIndex - 1, 0);
      updateSearchActiveItem();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected =
        searchActiveIndex >= 0
          ? searchCurrentMatches[searchActiveIndex]
          : input.value.trim();
      navigateToWikiTitle(selected);
    }
  });

  list.addEventListener("mousedown", (event) => {
    const button = event.target.closest(".search-suggestion-item");
    if (!(button instanceof HTMLElement)) return;
    event.preventDefault();
    navigateToWikiTitle(button.dataset.title || "");
  });

  input.addEventListener("blur", () => {
    setTimeout(hideSearchSuggestions, 120);
  });

  document.addEventListener("click", (event) => {
    if (
      event.target instanceof Node &&
      !input.contains(event.target) &&
      !list.contains(event.target)
    ) {
      hideSearchSuggestions();
    }
  });
}

function buildWikiLinkHref(title) {
  return `#/wiki/${encodeURIComponent(title.trim())}`;
}

function syncWikiHashForTitle(title) {
  const nextHash = buildWikiLinkHref(title);
  if (window.location.hash === nextHash) return;
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  history.replaceState(null, "", nextUrl);
}

function preprocessWikiLinksToPlaceholders(markdown, titleSet) {
  const placeholders = [];
  const processed = (markdown || "")
    .split(MARKDOWN_CODE_SEGMENT_REGEX)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment.replace(WIKI_LINK_REGEX, (_match, target, alias) => {
        const docTitle = target.trim();
        const label = (alias || docTitle).trim();
        const exists = titleSet.has(docTitle);
        const tokenId = placeholders.length;

        placeholders.push({ docTitle, label, exists });
        return `⟦WIKILINK:${tokenId}⟧`;
      });
    })
    .join("");

  return { processed, placeholders };
}

function restoreWikiLinkPlaceholders(html, placeholders) {
  return html.replace(/⟦WIKILINK:(\d+)⟧/g, (_match, idText) => {
    const link = placeholders[Number(idText)];
    if (!link) return "";

    const href = buildWikiLinkHref(link.docTitle);
    const className = link.exists
      ? "wiki-link wiki-link--exists"
      : "wiki-link wiki-link--missing";

    return `<a href="${href}" class="${className}" data-wiki-title="${escapeHtml(link.docTitle)}">${escapeHtml(link.label)}</a>`;
  });
}

function preprocessNamuWikiSyntax(markdown) {
  const footnotes = [];

  let text = (markdown || "")
    .split(MARKDOWN_CODE_SEGMENT_REGEX)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      let seg = segment;
      seg = seg.replace(NAMU_FOOTNOTE_REGEX, (_match, content) => {
        const idx = footnotes.length;
        footnotes.push(content.trim());
        return `<sup class="wiki-fn-ref"><a href="#wiki-fn-${idx + 1}" id="wiki-fnref-${idx + 1}" title="각주 ${idx + 1}">[${idx + 1}]</a></sup>`;
      });
      seg = seg.replace(NAMU_BOLD_REGEX, "**$1**");
      seg = seg.replace(NAMU_ITALIC_REGEX, "*$1*");
      seg = seg.replace(NAMU_STRIKE_STRIP_REGEX, "$1");
      return seg;
    })
    .join("");

  text = text
    .split(MARKDOWN_CODE_SEGMENT_REGEX)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(NAMU_HEADING_REGEX, (_match, eq, title) => {
        const level = eq.length;
        return `${"#".repeat(level)} ${title.trim()}`;
      });
    })
    .join("");

  text = text
    .split(MARKDOWN_CODE_SEGMENT_REGEX)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(NAMU_HR_REGEX, "---");
    })
    .join("");

  return { text, footnotes };
}

function renderInlineNamuNote(noteText, titleSet) {
  const { processed, placeholders } = preprocessWikiLinksToPlaceholders(
    noteText,
    titleSet
  );

  let html;
  if (!window.marked) {
    html = escapeHtml(processed);
  } else if (typeof window.marked.parseInline === "function") {
    html = window.marked.parseInline(processed);
  } else {
    html = window.marked
      .parse(processed)
      .replace(/^<p>/, "")
      .replace(/<\/p>$/, "");
  }

  return restoreWikiLinkPlaceholders(html, placeholders);
}

function renderFootnotesSection(footnotes, titleSet) {
  if (!footnotes.length) return "";

  const items = footnotes
    .map((note, index) => {
      const num = index + 1;
      const noteHtml = renderInlineNamuNote(note, titleSet);
      return `<li id="wiki-fn-${num}" class="wiki-fn-item"><span class="wiki-fn-back"><a href="#wiki-fnref-${num}" aria-label="본문으로 돌아가기">↑</a></span><span class="wiki-fn-label">${num}.</span> <span class="wiki-fn-text">${noteHtml}</span></li>`;
    })
    .join("");

  return `<section class="wiki-footnotes" aria-label="각주"><h2 class="wiki-footnotes-title">각주</h2><ol class="wiki-fn-list">${items}</ol></section>`;
}

function applyNamuHeadingStyles(html) {
  return html
    .replace(
      /<h2>([\s\S]*?)<\/h2>/gi,
      '<h2 class="namu-section-heading"><span>$1</span></h2>'
    )
    .replace(/<h3>([\s\S]*?)<\/h3>/gi, '<h3 class="namu-subheading">$1</h3>')
    .replace(
      /<h1>([\s\S]*?)<\/h1>/gi,
      '<h1 class="namu-doc-heading">$1</h1>'
    );
}

function buildNamuTOCHTML(items) {
  const links = items
    .map((item) => {
      const depthClass =
        item.depth === 2 ? " wiki-toc-item wiki-toc-item--depth2" : " wiki-toc-item";
      return `<li class="${depthClass.trim()}"><a href="#${item.id}">${escapeHtml(item.label)}</a></li>`;
    })
    .join("");

  return `<nav class="wiki-toc" aria-label="목차"><div class="wiki-toc-inner"><strong class="wiki-toc-title">목차</strong><ol class="wiki-toc-list">${links}</ol></div></nav>`;
}

function injectHeadingIdsAndBuildTOC(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const headings = [
    ...wrap.querySelectorAll("h2.namu-section-heading, h3.namu-subheading"),
  ];

  if (headings.length < 2) {
    return { bodyHtml: wrap.innerHTML, tocHtml: "" };
  }

  const items = headings.map((heading, index) => {
    const id = `wiki-sec-${index}`;
    heading.id = id;
    return {
      id,
      label: heading.textContent.trim(),
      depth: heading.tagName === "H3" ? 2 : 1,
    };
  });

  return {
    bodyHtml: wrap.innerHTML,
    tocHtml: buildNamuTOCHTML(items),
  };
}

function renderNamuMarkdown(markdownText, titleSet = new Set()) {
  const { text, footnotes } = preprocessNamuWikiSyntax(markdownText);
  const { processed, placeholders } = preprocessWikiLinksToPlaceholders(
    text,
    titleSet
  );

  let html;
  if (!window.marked) {
    html = `<p>${escapeHtml(processed)}</p>`;
  } else {
    html = window.marked.parse(processed);
  }

  html = restoreWikiLinkPlaceholders(html, placeholders);
  html = applyNamuHeadingStyles(html);
  const { bodyHtml, tocHtml } = injectHeadingIdsAndBuildTOC(html);
  const footnotesHtml = renderFootnotesSection(footnotes, titleSet);

  return {
    html: bodyHtml + footnotesHtml,
    tocHtml,
  };
}

async function renderNamuMarkdownAsync(markdownText) {
  const titleSet = await ensureArticleTitleCache();
  return renderNamuMarkdown(markdownText, titleSet);
}

function renderMarkdown(markdownText, titleSet = new Set()) {
  return renderNamuMarkdown(markdownText, titleSet).html;
}

async function renderMarkdownAsync(markdownText) {
  const titleSet = await ensureArticleTitleCache();
  return renderMarkdown(markdownText, titleSet);
}

function normalizeGenCategory(category) {
  return (category || "archive").trim().toLowerCase().replace(/\s+/g, "");
}

function isGenCommentCategory(category) {
  const normalized = normalizeGenCategory(category);
  return (
    GEN_COMMENT_CATEGORIES.has(normalized) ||
    normalized.includes("댓글") ||
    normalized.includes("comment") ||
    normalized.includes("선배") ||
    normalized.includes("한마디")
  );
}

function partitionGenerationArchives(archives) {
  const sectionBuckets = Object.fromEntries(
    GEN_SECTION_DEFS.map((section) => [section.id, []])
  );
  const comments = [];

  for (const item of archives) {
    if (isGenCommentCategory(item.category)) {
      comments.push(item);
      continue;
    }

    const normalized = normalizeGenCategory(item.category);
    const matchedSection = GEN_SECTION_DEFS.find((section) =>
      section.categories.some((cat) => normalizeGenCategory(cat) === normalized)
    );

    if (matchedSection) {
      sectionBuckets[matchedSection.id].push(item);
    } else {
      sectionBuckets.archives.push(item);
    }
  }

  comments.sort((a, b) => (a.id || 0) - (b.id || 0));
  return { sectionBuckets, comments };
}

function buildNamuSectionHeading(title) {
  return `<h2 class="namu-section-heading"><span>${escapeHtml(title)}</span></h2>`;
}

function mergeArchiveSectionHTML(archives, titleSet, genNumber) {
  if (!archives.length) {
    return `<p class="gen-section-empty">아직 등록된 내용이 없습니다. 상단 <strong>글쓰기</strong>에서 기록을 추가할 수 있습니다.</p>`;
  }

  return archives
    .map((item) => {
      const subheading =
        archives.length > 1 && item.title
          ? `<h3 class="gen-subheading">${escapeHtml(item.title)}</h3>`
          : "";
      const editBtn = item.id
        ? `<button type="button" class="wiki-mini-btn" data-action="edit-gen-archive" data-gen="${escapeHtml(genNumber)}" data-archive-id="${escapeHtml(String(item.id))}">[편집]</button>`
        : "";
      return `
        <div class="gen-section-block-wrap">
          <div class="gen-section-block-head">
            ${subheading}
            ${editBtn}
          </div>
          <div class="wiki-markdown gen-section-block">${renderMarkdown(item.content || "", titleSet)}</div>
        </div>`;
    })
    .join("");
}

function buildSchoolInfoboxHTML() {
  return `
    <aside class="wiki-infobox wiki-infobox--school" aria-label="학교 정보 인포박스">
      <div class="infobox-title">제주과학고등학교</div>
      <div class="infobox-subtitle">濟州科學高等學校<br />Jeju Science High School</div>
      <figure class="infobox-image">
        <img
          src="https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&h=360&fit=crop"
          alt="제주과학고등학교 전경 (대표 이미지)"
        />
      </figure>
      <table class="infobox-table">
        <tbody>
          <tr><th scope="row">개교</th><td>1999년 3월 2일</td></tr>
          <tr><th scope="row">유형</th><td>과학고등학교</td></tr>
          <tr><th scope="row">성별</th><td>남녀공학</td></tr>
          <tr><th scope="row">형태</th><td>도립</td></tr>
          <tr><th scope="row">교훈</th><td>성실, 창의, 봉사</td></tr>
          <tr><th scope="row">교화</th><td>철쭉</td></tr>
          <tr><th scope="row">교목</th><td>구상나무</td></tr>
          <tr><th scope="row">관할</th><td>제주특별자치도교육청</td></tr>
          <tr><th scope="row">주소</th><td>제주시 산록북로 421-1</td></tr>
          <tr>
            <th scope="row">약칭</th>
            <td><a href="#/wiki/${encodeURIComponent(JEGWANG_WRITE_TITLE)}" class="infobox-link">제곽(JSHS)</a></td>
          </tr>
        </tbody>
      </table>
    </aside>
  `;
}

function highlightSidebarIntroLink(title) {
  document.querySelectorAll(".sidebar-intro-link").forEach((link) => {
    link.classList.toggle(
      "sidebar-intro-link--active",
      title ? link.dataset.wikiTitle === title : false
    );
  });
}

function buildGenDiscussionHTML(genNumber, comments, titleSet) {
  const showAdminDelete = isWikiAdmin();
  const listItems = comments.length
    ? comments
        .map((item) => {
          const deleteBtn =
            showAdminDelete && item.id
              ? `<button type="button" class="wiki-mini-btn discussion-delete-btn" data-action="delete-gen-comment" data-gen="${escapeHtml(genNumber)}" data-archive-id="${escapeHtml(String(item.id))}" title="댓글 삭제">[삭제]</button>`
              : "";
          return `
        <li class="discussion-comment" data-archive-id="${escapeHtml(String(item.id || ""))}">
          <div class="discussion-comment-head">
            <div class="discussion-comment-author-wrap">
              <span class="discussion-avatar" aria-hidden="true">${escapeHtml((item.title || "?")[0])}</span>
              <div class="discussion-comment-meta">
                <strong class="discussion-author">${escapeHtml(item.title || "익명")}</strong>
              </div>
            </div>
            ${deleteBtn}
          </div>
          <div class="discussion-comment-body wiki-markdown">${renderMarkdown(item.content || "", titleSet)}</div>
        </li>
      `;
        })
        .join("")
    : `<li class="discussion-empty"><p>아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p></li>`;

  return `
    <section class="gen-discussion" id="gen-discussion" aria-labelledby="genDiscussionTitle">
      <div class="discussion-head">
        <h2 class="namu-section-heading discussion-title" id="genDiscussionTitle">
          <span>댓글</span>
        </h2>
        <div class="discussion-tabs" role="tablist" aria-label="문서 영역">
          <span class="discussion-tab discussion-tab--muted" role="tab" aria-selected="false">문서</span>
          <span class="discussion-tab discussion-tab--active" role="tab" aria-selected="true">댓글 ${comments.length}</span>
        </div>
      </div>
      <ol class="discussion-list">${listItems}</ol>
      <div class="discussion-composer">
        <label class="editor-label" for="genCommentInput">댓글 작성</label>
        <textarea
          id="genCommentInput"
          class="discussion-input"
          rows="3"
          maxlength="2000"
          placeholder="댓글을 입력하세요."
        ></textarea>
        <div class="discussion-composer-actions">
          <p class="discussion-hint save-guest-only">로그인한 뒤 댓글을 등록할 수 있습니다. 등록은 ${APP_CONFIG.allowedEmailDomain} 학교 이메일 계정만 가능합니다.</p>
          <p class="discussion-hint school-editor-only">로그인한 제곽위키 계정으로 작성됩니다. 예의를 지켜 주세요.</p>
          <button type="button" class="btn-primary" data-action="save-gen-comment" data-gen="${escapeHtml(genNumber)}">등록</button>
        </div>
      </div>
    </section>
  `;
}

function buildGenerationDocHTML(
  genNumber,
  generation,
  archives,
  titleSet,
  introBodyHtml = "",
  genArticleId = null,
  genDocTitle = ""
) {
  const { sectionBuckets, comments } = partitionGenerationArchives(archives);
  const resolvedGenTitle = genDocTitle || getGenerationDocTitle(genNumber);

  const sectionsHTML = GEN_SECTION_DEFS.map((section) => {
    const items = sectionBuckets[section.id] || [];
    if (section.id === "archives" && !items.length) return "";

    return `
      <section class="gen-doc-section" id="gen-section-${section.id}">
        ${buildNamuSectionHeading(section.title)}
        ${mergeArchiveSectionHTML(items, titleSet, genNumber)}
      </section>
    `;
  }).join("");

  const entranceYear = getGenEntranceYear(genNumber);
  const gradeLabel = getGenGradeLabel(genNumber);
  const lead = generation?.slogan
    ? `${escapeHtml(generation.slogan)} · ${entranceYear}학년도 입학${gradeLabel ? ` · ${escapeHtml(gradeLabel)}` : ""}`
    : `${entranceYear}학년도 입학 기수 문서`;

  return `
    <article class="wiki-card gen-wiki-doc">
      ${buildWikiToolbarHTML(genArticleId)}
      <div id="wikiMetaBar" class="wiki-doc-meta-bar"></div>
      <header class="gen-wiki-header">
        <div class="gen-wiki-title-wrap">
          <h1 class="gen-wiki-title">제${escapeHtml(genNumber)}기</h1>
          <p class="gen-wiki-lead">${lead}</p>
        </div>
        <div class="gen-wiki-actions">
          <a href="#gen-discussion" class="wiki-tool-btn discussion-jump">[댓글]</a>
          <button type="button" class="btn-primary" data-action="start-gen-write" data-gen="${escapeHtml(genNumber)}">글쓰기</button>
        </div>
      </header>
      <div id="wikiArticleBody" class="wiki-article-body gen-wiki-intro-body">${introBodyHtml}</div>
      <div class="gen-wiki-main">
        ${sectionsHTML}
        ${buildGenDiscussionHTML(genNumber, comments, titleSet)}
      </div>
      ${buildWikiEditorPanelHTML(resolvedGenTitle)}
      <div id="wikiHistoryPanel" class="wiki-history-panel hidden"></div>
    </article>
  `;
}

async function renderGenerationArchive(genNumber) {
  stopDraftAutosave();
  currentEditTitle = null;

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (!pageTitle || !pageDescription || !viewContainer) return;

  if (window.WikiGenCalendar.isFutureGen(genNumber)) {
    const entranceYear = getGenEntranceYear(genNumber);
    pageTitle.textContent = `제${genNumber}기`;
    pageDescription.textContent = "아직 입학 전 기수입니다.";
    highlightSidebarIntroLink(null);
    viewContainer.innerHTML = `
      <article class="wiki-card">
        <p>제${escapeHtml(genNumber)}기는 ${entranceYear}학년도 입학 예정 기수입니다.</p>
        <p>한국시간 기준 ${entranceYear}년 3월 1일 이후 문서가 열립니다.</p>
      </article>
    `;
    return;
  }

  pageTitle.textContent = `제${genNumber}기`;
  pageDescription.textContent = ROUTE_META.generation.description;
  highlightSidebarIntroLink(null);
  setViewLoading(`제${genNumber}기 문서를 불러오는 중...`);

  if (window.WikiGenCalendar?.isFutureGen?.(genNumber)) {
    const entranceYear = getGenEntranceYear(genNumber);
    viewContainer.innerHTML = `
      <article class="wiki-card">
        <h3>제${escapeHtml(genNumber)}기</h3>
        <p>${entranceYear}학년도 입학 예정 기수입니다. 3월 1일(한국시간) 이후 문서가 열립니다.</p>
      </article>
    `;
    return;
  }

  try {
    const genDocTitle = getGenerationDocTitle(genNumber);
    const [{ generation, archives }, titleSet, genArticle] = await Promise.all([
      window.WikiAPI.getGenerationArchiveData(genNumber),
      ensureArticleTitleCache(),
      window.WikiAPI.getArticleByTitle(genDocTitle),
    ]);

    currentCategorySlug = null;
    currentArchiveEdit = null;

    if (genArticle) {
      currentArticleState = {
        id: genArticle.id,
        title: genArticle.title,
        content: genArticle.content || "",
        category: genArticle.category || "archives",
        updatedAt: genArticle.updated_at,
        isMissing: false,
      };
    } else {
      currentArticleState = {
        id: null,
        title: genDocTitle,
        content: "",
        category: "archives",
        updatedAt: null,
        isMissing: true,
      };
    }

    let introBodyHtml = "";
    if (!currentArticleState.isMissing) {
      const rendered = await renderNamuMarkdownAsync(currentArticleState.content);
      introBodyHtml = `<section class="wiki-markdown">${rendered.html}</section>`;
    } else {
      introBodyHtml =
        '<div class="wiki-empty-notice"><p>기수 소개 문서가 아직 작성되지 않았습니다. 상단 <strong>[편집]</strong>에서 작성할 수 있습니다.</p></div>';
    }

    viewContainer.innerHTML = buildGenerationDocHTML(
      genNumber,
      generation,
      archives,
      titleSet,
      introBodyHtml,
      currentArticleState.id,
      genDocTitle
    );
    updateWikiMetaBar();
    openGenerationGroupForGen(genNumber);
    highlightGenerationNav(genNumber);
    applyAuthToDocument();
    initIcons();
  } catch (error) {
    console.error("Failed to load generation archive:", error);
    viewContainer.innerHTML = `
      <article class="wiki-card">
        <p>아카이브 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      </article>
    `;
  }
}

async function renderArticleView({
  title,
  content,
  updatedAt,
  isMissing = false,
  articleId = null,
  category = "general",
}) {
  stopDraftAutosave();
  currentEditTitle = null;
  currentCategorySlug = null;
  currentArchiveEdit = null;

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (!pageTitle || !pageDescription || !viewContainer) return;

  const resolvedCategory =
    isMissing || !(content || "").trim() ? STUB_CATEGORY : category;

  pageTitle.textContent = title;
  pageDescription.textContent = isMissing
    ? "아직 작성되지 않은 문서입니다."
    : "문서 읽기 모드";

  currentArticleState = {
    id: articleId,
    title,
    content: content || "",
    category: resolvedCategory,
    updatedAt,
    isMissing,
  };

  const isStub = isStubArticle(currentArticleState);
  const metaText = isMissing
    ? "마지막 수정일: 수정 이력 없음"
    : `마지막 수정일: ${formatDateTime(updatedAt)}`;

  let bodyHtml = "";
  let tocHtml = "";
  if (!isMissing) {
    const rendered = await renderNamuMarkdownAsync(content || "");
    bodyHtml = `<section class="wiki-markdown">${rendered.html}</section>`;
    tocHtml = rendered.tocHtml;
  } else {
    const editHint = isSchoolIntroArticle(title)
      ? "<p>상단 <strong>[편집]</strong> 탭을 눌러 이 소개 문서를 작성·수정할 수 있습니다.</p>"
      : "";
    bodyHtml = `<div class="wiki-empty-notice"><p>이 문서는 아직 작성되지 않았습니다.</p>${editHint}</div>`;
  }

  const schoolIntroBanner = buildSchoolIntroEditBannerHTML(title);
  const schoolInfobox =
    title === SCHOOL_NAMU_WIKI_TITLE && !isMissing ? buildSchoolInfoboxHTML() : "";
  const docLayoutClass = schoolInfobox ? "namu-doc-layout" : "";

  viewContainer.innerHTML = `
    ${getViewNoticeHTML()}
    <article class="wiki-card wiki-article namu-doc${schoolInfobox ? " namu-doc--with-infobox" : ""}">
      ${buildWikiToolbarHTML(articleId)}
      ${schoolIntroBanner}
      <div id="wikiMetaBar" class="wiki-doc-meta-bar">${escapeHtml(metaText)}</div>
      <div class="${docLayoutClass || "namu-doc-standalone"}">
        <div class="namu-doc-main">
          <h1 class="namu-doc-title">${escapeHtml(title)}</h1>
          <div id="wikiTOC" class="${tocHtml ? "" : "hidden"}">${tocHtml}</div>
          <div id="wikiArticleBody" class="wiki-article-body">${bodyHtml}</div>
          <div id="wikiDocFooter" class="wiki-doc-footer-wrap">${getWikiDocFooterHTML(resolvedCategory, isStub)}</div>
        </div>
        ${schoolInfobox}
      </div>
      ${buildWikiEditorPanelHTML(title)}
      <div id="wikiHistoryPanel" class="wiki-history-panel hidden"></div>
    </article>
  `;

  updateInlineSaveButton();
  applyAuthToDocument();
  highlightSidebarIntroLink(title);
}

async function renderCategoryView(categorySlug) {
  stopDraftAutosave();
  currentEditTitle = null;
  currentArchiveEdit = null;
  currentCategorySlug = categorySlug;
  highlightSidebarIntroLink(null);

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (!pageTitle || !pageDescription || !viewContainer) return;

  const label = getCategoryLabel(categorySlug);
  const metaTitle = getCategoryMetaTitle(categorySlug);
  pageTitle.textContent = `${label} 분류`;
  pageDescription.textContent = `${label} 카테고리 · [편집]에서 분류 설명을 작성할 수 있습니다.`;
  setViewLoading(`${label} 문서를 불러오는 중...`);

  try {
    const [articles, metaArticle] = await Promise.all([
      window.WikiAPI.getArticlesByCategory(categorySlug),
      window.WikiAPI.getArticleByTitle(metaTitle),
    ]);

    if (metaArticle) {
      currentArticleState = {
        id: metaArticle.id,
        title: metaArticle.title,
        content: metaArticle.content || "",
        category: categorySlug,
        updatedAt: metaArticle.updated_at,
        isMissing: false,
      };
    } else {
      currentArticleState = {
        id: null,
        title: metaTitle,
        content: "",
        category: categorySlug,
        updatedAt: null,
        isMissing: true,
      };
    }

    const listHtml = articles.length
      ? articles
          .map(
            (article) => `
          <li class="wiki-category-doc-item">
            <div class="wiki-category-doc-main">
              <a href="${buildWikiLinkHref(article.title)}" class="wiki-link wiki-link--exists">${escapeHtml(article.title)}</a>
              <a href="${buildWikiEditHref(article.title)}" class="wiki-mini-btn">[편집]</a>
            </div>
            <span class="wiki-category-doc-meta">최근 수정: ${escapeHtml(formatDateTime(article.updated_at))}</span>
          </li>`
          )
          .join("")
      : `<li class="wiki-category-empty">이 분류에 등록된 문서가 없습니다. 아래 [편집]에서 새 문서를 만들거나, 문서에서 분류를 지정하세요.</li>`;

    let introBodyHtml = "";
    if (!currentArticleState.isMissing) {
      const rendered = await renderNamuMarkdownAsync(currentArticleState.content);
      introBodyHtml = `<section class="wiki-markdown">${rendered.html}</section>`;
    } else {
      introBodyHtml =
        '<div class="wiki-empty-notice"><p>분류 설명이 아직 작성되지 않았습니다. 상단 <strong>[편집]</strong>에서 이 분류에 대한 안내를 작성할 수 있습니다.</p></div>';
    }

    const metaText = currentArticleState.isMissing
      ? "마지막 수정일: 수정 이력 없음"
      : `마지막 수정일: ${formatDateTime(currentArticleState.updatedAt)}`;

    viewContainer.innerHTML = `
      ${getViewNoticeHTML()}
      <article class="wiki-card wiki-category-page wiki-article">
        ${buildWikiToolbarHTML(currentArticleState.id)}
        <div id="wikiMetaBar" class="wiki-doc-meta-bar">${escapeHtml(metaText)}</div>
        <h1 class="namu-doc-title">${escapeHtml(label)}</h1>
        <p class="wiki-category-lead">[분류: ${escapeHtml(label)}]에 속한 하위 문서 목록입니다.</p>
        <div id="wikiArticleBody" class="wiki-article-body">${introBodyHtml}</div>
        <section class="wiki-category-list-wrap">
          <h2 class="namu-section-heading"><span>1. 문서 목록</span></h2>
          <ul class="wiki-category-doc-list">${listHtml}</ul>
        </section>
        <footer class="wiki-doc-footer">
          <strong class="wiki-category-tag">[분류: <a href="#/category/${encodeURIComponent(categorySlug)}" class="wiki-category-link">${escapeHtml(label)}</a>]</strong>
        </footer>
        ${buildWikiEditorPanelHTML(metaTitle)}
        <div id="wikiHistoryPanel" class="wiki-history-panel hidden"></div>
      </article>
    `;
    updateInlineSaveButton();
    applyAuthToDocument();
  } catch (error) {
    console.error("Failed to load category articles:", error);
    viewContainer.innerHTML = `
      <article class="wiki-card">
        <p>카테고리 문서를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      </article>
    `;
  }
}

function renderRoute(routeType, value = "") {
  stopDraftAutosave();
  currentEditTitle = null;
  currentCategorySlug = null;
  currentArchiveEdit = null;

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (!pageTitle || !pageDescription || !viewContainer) return;

  if (routeType === "category") {
    void renderCategoryView(value);
    return;
  }

  pageTitle.textContent = ROUTE_META.home.title;
  pageDescription.textContent = ROUTE_META.home.description;
  highlightSidebarIntroLink(null);
  viewContainer.innerHTML = `
    ${getViewNoticeHTML()}
    <article class="wiki-card"><h3>JSHS-WIKI 시작</h3>${buildHomeContent()}</article>
  `;
  applyAuthToDocument();
}

function renderGenerationWriteView(genNumber, archiveItem = null) {
  stopDraftAutosave();
  currentEditTitle = null;
  currentArchiveEdit = archiveItem;
  currentCategorySlug = null;
  currentArticleState = null;

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (!pageTitle || !pageDescription || !viewContainer) return;

  const isEdit = Boolean(archiveItem?.id);
  pageTitle.textContent = isEdit ? `${genNumber}기 아카이브 편집` : `${genNumber}기 글쓰기`;
  pageDescription.textContent = isEdit
    ? "기수 아카이브 항목을 수정합니다."
    : "기수 아카이브에 새 기록을 작성합니다.";

  const categoryValue = archiveItem?.category || "archive";
  const archiveTitle = archiveItem?.title || "";
  const archiveContent = archiveItem?.content || "";

  viewContainer.innerHTML = `
    <article class="wiki-card">
      <header class="wiki-doc-header editor-actions">
        <div class="wiki-doc-meta">${escapeHtml(genNumber)}기${isEdit ? " · 편집" : ""}</div>
        <div class="editor-btn-group">
          <button type="button" class="btn-secondary" data-action="cancel-gen-write" data-gen="${escapeHtml(genNumber)}">돌아가기</button>
          <button type="button" class="btn-primary" data-action="save-archive" data-gen="${escapeHtml(genNumber)}">저장</button>
        </div>
      </header>
      <label class="editor-label" for="archiveCategory">문서 섹션</label>
      <select id="archiveCategory" class="editor-input">
        <option value="개요"${categoryValue === "개요" || categoryValue === "overview" ? " selected" : ""}>1. 개요</option>
        <option value="사건"${categoryValue === "사건" || categoryValue === "주요사건" ? " selected" : ""}>2. 주요 사건</option>
        <option value="R&E"${categoryValue === "R&E" || categoryValue === "R&amp;E" ? " selected" : ""}>3. R&amp;E 연구</option>
        <option value="archive"${categoryValue === "archive" || categoryValue === "아카이브" ? " selected" : ""}>4. 아카이브 (기타)</option>
      </select>
      <label class="editor-label" for="archiveTitle">제목</label>
      <input id="archiveTitle" class="editor-input" type="text" placeholder="아카이브 제목" />
      <label class="editor-label" for="archiveEditor">내용 (Markdown)</label>
      <div class="wiki-syntax-toolbar" role="toolbar" aria-label="문법 도구">
        ${buildWikiSyntaxToolbarHTML("archiveEditor")}
      </div>
      <textarea id="archiveEditor" class="editor-textarea" placeholder="아카이브 내용을 입력하세요..."></textarea>
      <p class="editor-hint save-guest-only">${getSchoolEditRequiredMessage()}</p>
      <p class="editor-hint school-editor-only">저장 시 Archives 테이블에 기록됩니다.</p>
    </article>
  `;

  const titleInput = document.getElementById("archiveTitle");
  const editor = document.getElementById("archiveEditor");
  if (titleInput) titleInput.value = archiveTitle;
  if (editor) editor.value = archiveContent;

  applyAuthToDocument();
}

async function renderGenerationWriteViewForRoute(genNumber, archiveId = null) {
  let archiveItem = null;
  if (archiveId) {
    try {
      const { archives } = await window.WikiAPI.getGenerationArchiveData(genNumber);
      archiveItem = archives.find((item) => String(item.id) === String(archiveId)) || null;
    } catch (error) {
      console.error("Failed to load archive for edit:", error);
    }
  }
  renderGenerationWriteView(genNumber, archiveItem);
}

async function openWikiEditByTitle(title) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return;

  await renderWikiDocumentByTitle(normalizedTitle);
  await enterInlineEditMode();
}

function resolveEditContent(title, fallbackContent) {
  const draft = loadDraftFromLocal(title);
  if (draft && typeof draft.content === "string") {
    return draft.content;
  }
  return fallbackContent || "";
}

function renderEditMode({ title, content = "" }) {
  if (!requireAuthForEdit()) return;

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (!pageTitle || !pageDescription || !viewContainer) return;

  currentEditTitle = title;
  const initialContent = resolveEditContent(title, content);
  const canSave = canSaveContent();

  pageTitle.textContent = `${title} 편집`;
  pageDescription.textContent = "문서를 수정한 뒤 저장하세요.";

  const safeTitle = escapeHtml(title);
  viewContainer.innerHTML = `
    <article class="wiki-card">
      <header class="wiki-doc-header editor-actions">
        <div class="wiki-doc-meta">${safeTitle}</div>
        <div class="editor-btn-group">
          <button type="button" class="btn-secondary" data-action="cancel-edit">취소</button>
          <button
            type="button"
            class="btn-primary"
            data-action="save-article"
            ${canSave ? "" : "disabled"}
            title="${canSave ? "문서를 서버에 저장합니다." : escapeHtml(getSchoolEditRequiredMessage())}"
          >저장</button>
        </div>
      </header>
      <label class="editor-label" for="articleEditor">본문 (Markdown)</label>
      <textarea id="articleEditor" class="editor-textarea" placeholder="문서 내용을 입력하세요...">${escapeHtml(initialContent)}</textarea>
      <p id="draftStatus" class="editor-hint">편집 중 자동 저장: 1분마다 로컬에 저장됩니다.</p>
      <p class="editor-hint">${canSave ? "저장 시 이전 버전은 Revisions에 백업됩니다." : escapeHtml(getSchoolEditRequiredMessage())}</p>
    </article>
  `;

  updateDraftStatusMessage(title);
  startDraftAutosave(title);
  updateSaveButtonState();
}

async function renderWikiDocumentByTitle(title) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    renderRoute("home");
    return;
  }

  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  const viewContainer = document.getElementById("viewContainer");
  if (pageTitle) pageTitle.textContent = normalizedTitle;
  if (pageDescription) pageDescription.textContent = "문서를 불러오는 중...";
  setViewLoading("문서를 불러오는 중...");

  try {
    const article = await window.WikiAPI.getArticleByTitle(normalizedTitle);
    if (!article) {
      await renderArticleView({
        title: normalizedTitle,
        content: "",
        updatedAt: null,
        isMissing: true,
      });
      return;
    }

    await renderArticleView({
      title: article.title,
      content: article.content || "",
      updatedAt: article.updated_at,
      isMissing: false,
      articleId: article.id,
      category: article.category || "general",
    });
  } catch (error) {
    console.error("Failed to load article:", error);
    const fallback = window.WikiMockStore?.articles?.find(
      (row) => row.title === normalizedTitle
    );
    if (fallback) {
      await renderArticleView({
        title: fallback.title,
        content: fallback.content || "",
        updatedAt: fallback.updated_at,
        isMissing: false,
        articleId: fallback.id,
        category: fallback.category || "general",
      });
      return;
    }

    if (viewContainer) {
      viewContainer.innerHTML = `
        ${getViewNoticeHTML()}
        <article class="wiki-card">
          <h3>${escapeHtml(normalizedTitle)}</h3>
          <p>문서를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
          <p class="editor-hint">Supabase를 사용 중이라면 <code>supabase/schema.sql</code> 실행 여부를 확인하세요.</p>
        </article>
      `;
    }
    highlightSidebarIntroLink(
      isSchoolIntroArticle(normalizedTitle) ? normalizedTitle : null
    );
  }
}

async function handleSaveArticle(title) {
  const isDemoSave = window.WikiAPI?.isMockMode?.() ?? false;
  if (!isDemoSave && !canSaveContent()) {
    promptForEditAuth();
    return;
  }

  const userId = window.WikiAuth.getCurrentUserId();
  const editor = document.getElementById("articleEditor");
  if (!editor) return;

  const newContent = editor.value;
  const resolvedUserId = userId || "demo-user";
  const editSummaryInput = document.getElementById("editSummaryInput");
  const editSummary = (editSummaryInput?.value || "").trim() || "내용 수정";
  const editorProfile = getEditorProfile();

  isArticleSaveInProgress = true;
  try {
    const previousArticle = currentArticleState?.id
      ? {
          id: currentArticleState.id,
          title: currentArticleState.title,
          content: currentArticleState.content,
          category: currentArticleState.category,
          updated_at: currentArticleState.updatedAt,
        }
      : null;

    const saved = await window.WikiAPI.saveArticle({
      title,
      content: newContent,
      category: (() => {
        if (
          currentCategorySlug &&
          currentArticleState?.title === getCategoryMetaTitle(currentCategorySlug)
        ) {
          return currentCategorySlug;
        }
        if (isSchoolIntroArticle(title)) {
          return getSchoolIntroCategory(title);
        }
        if (currentArticleState?.isMissing || !(newContent || "").trim()) {
          return STUB_CATEGORY;
        }
        return currentArticleState?.category || "general";
      })(),
      userId: resolvedUserId,
      previousArticle,
      editSummary,
      editorNickname: editorProfile.nickname,
      editorGen: editorProfile.gen,
    });

    clearDraft(title);
    stopDraftAutosave();
    invalidateArticleTitleCache();

    currentArticleState = {
      id: saved.id,
      title: saved.title,
      content: saved.content || "",
      category: saved.category || "general",
      updatedAt: saved.updated_at,
      isMissing: false,
    };

    currentEditTitle = null;
    exitInlineEditMode();

    updateWikiMetaBar();
    updateHistoryButton();
    await refreshWikiArticleBody();
    updateStubFooter();

    syncWikiHashForTitle(saved.title);
  } catch (error) {
    if (error?.name === "ContentValidationError") {
      alert(error.message);
      return;
    }
    console.error("Failed to save article:", error);
    alert("문서 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
  } finally {
    isArticleSaveInProgress = false;
  }
}

function getArchiveCategoryFromForm() {
  const select = document.getElementById("archiveCategory");
  return select?.value || "archive";
}

async function handleSaveGenComment(genNumber) {
  if (!promptForEditAuth()) return;

  const editor = document.getElementById("genCommentInput");
  if (!editor) return;

  const content = editor.value.trim();
  if (!content) {
    alert("댓글 내용을 입력해주세요.");
    return;
  }

  const profile = getEditorProfile();
  const authorLabel = profile.gen
    ? `${profile.gen}기 ${profile.nickname}`
    : profile.nickname;

  try {
    await window.WikiAPI.saveArchivePost({
      genNumber,
      title: authorLabel,
      content,
      category: "댓글",
      userId: window.WikiAuth.getCurrentUserId() || "demo-user",
    });

    editor.value = "";
    await renderGenerationArchive(genNumber);
    const discussion = document.getElementById("gen-discussion");
    discussion?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (error?.name === "ContentValidationError") {
      alert(error.message);
      return;
    }
    console.error("Failed to save comment:", error);
    alert("댓글 등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }
}

async function handleDeleteGenComment(genNumber, archiveId) {
  if (!promptForAdminAuth()) return;
  if (!archiveId) return;
  if (!window.confirm("이 댓글을 삭제할까요?")) return;

  try {
    await window.WikiAPI.deleteArchivePost(archiveId);
    await renderGenerationArchive(genNumber);
    document.getElementById("gen-discussion")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } catch (error) {
    console.error("Failed to delete comment:", error);
    alert("댓글 삭제에 실패했습니다. 관리자 권한과 DB 설정을 확인해주세요.");
  }
}

async function handleSaveArchive(genNumber) {
  if (!promptForEditAuth()) return;

  const titleInput = document.getElementById("archiveTitle");
  const editor = document.getElementById("archiveEditor");
  if (!titleInput || !editor) return;

  const archiveTitle = titleInput.value.trim();
  const content = editor.value;

  if (!archiveTitle) {
    alert("제목을 입력해주세요.");
    return;
  }

  try {
    await window.WikiAPI.saveArchivePost({
      genNumber,
      title: archiveTitle,
      content,
      category: getArchiveCategoryFromForm(),
      userId: window.WikiAuth.getCurrentUserId() || "demo-user",
      previousArchive: currentArchiveEdit,
    });

    currentArchiveEdit = null;

    const listHash = `#/generation/${encodeURIComponent(genNumber)}`;
    if (window.location.hash === listHash) {
      await renderGenerationArchive(genNumber);
    } else {
      window.location.hash = listHash;
    }
  } catch (error) {
    if (error?.name === "ContentValidationError") {
      alert(error.message);
      return;
    }
    console.error("Failed to save archive:", error);
    alert("아카이브 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }
}

function getWikiTitleFromHash(hash) {
  if (!hash || hash === "#/" || hash === "#") return "";

  const wikiRouteMatch = hash.match(/^#\/wiki\/(.+)$/);
  if (wikiRouteMatch) return decodeURIComponent(wikiRouteMatch[1]);

  if (hash.startsWith("#/")) return "";
  return decodeURIComponent(hash.slice(1));
}

function isProtectedEditHash(hash) {
  return false;
}

async function refreshViewForAuthChange() {
  applyAuthToDocument();
  updateSaveButtonState();
  updateInlineSaveButton();

  if (currentEditTitle || isArticleSaveInProgress) {
    return;
  }

  await parseHashRoute();
}

async function parseHashRoute() {
  await window.WikiAuth.whenReady();
  applyAuthToDocument();

  const hash = window.location.hash || "#/";

  const editMatch = hash.match(/^#\/edit\/(.+)$/);
  if (editMatch) {
    const editTitle = decodeURIComponent(editMatch[1]);
    await renderWikiDocumentByTitle(editTitle);
    await enterInlineEditMode();
    syncWikiHashForTitle(editTitle);
    return;
  }

  const genEditMatch = hash.match(/^#\/generation\/(\d+)\/edit\/(\d+)$/);
  if (genEditMatch) {
    await renderGenerationWriteViewForRoute(genEditMatch[1], genEditMatch[2]);
    return;
  }

  const genWriteMatch = hash.match(/^#\/generation\/(\d+)\/write$/);
  if (genWriteMatch) {
    await renderGenerationWriteViewForRoute(genWriteMatch[1]);
    return;
  }

  const wikiTitle = getWikiTitleFromHash(hash);

  if (wikiTitle) {
    await renderWikiDocumentByTitle(wikiTitle);
    return;
  }

  const [, route, param, subRoute] = hash.split("/");

  if (route === "category" && param) {
    await renderCategoryView(decodeURIComponent(param));
    return;
  }

  if (route === "generation" && param && subRoute !== "write" && subRoute !== "edit") {
    await renderGenerationArchive(decodeURIComponent(param));
    return;
  }

  renderRoute("home");
}

function initSidebarIntroLinks() {
  document.querySelectorAll(".sidebar-intro-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      const title = link.dataset.wikiTitle?.trim();
      if (!title) return;

      const href = buildWikiLinkHref(title);
      if (window.location.hash === href) {
        event.preventDefault();
        void renderWikiDocumentByTitle(title);
      }
    });
  });
}

function initRouting() {
  window.addEventListener("hashchange", parseHashRoute);
  parseHashRoute();
}

function initWikiLinkNavigation() {
  const viewContainer = document.getElementById("viewContainer");
  if (!viewContainer) return;

  viewContainer.addEventListener("click", async (event) => {
    const link = event.target.closest("a.wiki-link");
    if (!link) return;

    const title = link.dataset.wikiTitle;
    if (!title) return;

    if (!link.classList.contains("wiki-link--missing")) return;

    event.preventDefault();

    const readHash = buildWikiLinkHref(title);
    if (window.location.hash !== readHash) {
      window.location.hash = readHash;
      await renderWikiDocumentByTitle(title);
    }

    await enterInlineEditMode();
  });
}

function initViewActions() {
  const viewContainer = document.getElementById("viewContainer");
  if (!viewContainer) return;

  viewContainer.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest("a.wiki-link")) return;

    const action = target.dataset.action;
    if (!action) return;

    event.preventDefault();

    if (action === "start-gen-write") {
      const gen = target.dataset.gen;
      if (!gen) return;
      window.location.hash = `#/generation/${encodeURIComponent(gen)}/write`;
      return;
    }

    if (action === "edit-gen-archive") {
      const gen = target.dataset.gen;
      const archiveId = target.dataset.archiveId;
      if (!gen || !archiveId) return;
      window.location.hash = `#/generation/${encodeURIComponent(gen)}/edit/${encodeURIComponent(archiveId)}`;
      return;
    }

    if (action === "cancel-gen-write") {
      const gen = target.dataset.gen;
      window.location.hash = gen ? `#/generation/${encodeURIComponent(gen)}` : "#/";
      return;
    }

    const currentTitle = getWikiTitleFromHash(window.location.hash);
    if (!currentTitle && (action === "start-edit" || action === "cancel-edit" || action === "save-article")) {
      return;
    }

    if (action === "wiki-tab-read") {
      exitInlineEditMode();
      await refreshWikiArticleBody();
      updateWikiMetaBar();
      updateStubFooter();
      return;
    }

    if (action === "wiki-edit" || action === "start-edit") {
      await enterInlineEditMode();
      return;
    }

    if (action === "wiki-insert-syntax") {
      insertWikiSyntax(target.dataset.snippet || "", target.dataset.editorTarget);
      return;
    }

    if (action === "wiki-insert-table") {
      insertWikiTable(target.dataset.editorTarget);
      return;
    }

    if (action === "wiki-table-add-row") {
      addWikiTableRow(target.dataset.editorTarget);
      return;
    }

    if (action === "wiki-table-add-col") {
      addWikiTableColumn(target.dataset.editorTarget);
      return;
    }

    if (action === "wiki-insert-image") {
      insertWikiImage(target.dataset.editorTarget);
      return;
    }

    if (action === "wiki-preview") {
      await showWikiPreview();
      return;
    }

    if (action === "wiki-back-edit") {
      showWikiEditView();
      return;
    }

    if (action === "wiki-cancel-edit" || action === "cancel-edit") {
      exitInlineEditMode();
      await refreshWikiArticleBody();
      updateWikiMetaBar();
      updateStubFooter();
      return;
    }

    if (action === "wiki-history") {
      const articleId = target.dataset.articleId || currentArticleState?.id;
      if (articleId) await showArticleHistory(articleId);
      return;
    }

    if (action === "wiki-close-history") {
      hideWikiPanels();
      const pageDescription = document.getElementById("pageDescription");
      const pageTitleEl = document.getElementById("pageTitle");
      if (pageTitleEl && currentArticleState?.title) {
        pageTitleEl.textContent = currentArticleState.title;
      }
      if (pageDescription && currentArticleState) {
        pageDescription.textContent = currentArticleState.isMissing
          ? "아직 작성되지 않은 문서입니다."
          : "문서 읽기 모드";
      }
      return;
    }

    if (action === "save-article") {
      if (!promptForEditAuth()) return;
      const saveTitle = currentEditTitle || currentArticleState?.title || currentTitle;
      if (!saveTitle) return;
      await handleSaveArticle(saveTitle);
      return;
    }

    if (action === "save-archive") {
      if (!promptForEditAuth()) return;
      const gen = target.dataset.gen;
      if (!gen) return;
      await handleSaveArchive(gen);
      return;
    }

    if (action === "save-gen-comment") {
      if (!promptForEditAuth()) return;
      const gen = target.dataset.gen;
      if (!gen) return;
      await handleSaveGenComment(gen);
      return;
    }

    if (action === "delete-gen-comment") {
      const gen = target.dataset.gen;
      const archiveId = target.dataset.archiveId;
      if (!gen || !archiveId) return;
      await handleDeleteGenComment(gen, archiveId);
    }
  });
}

function initWikiEditorShortcuts() {
  document.addEventListener("keydown", async (event) => {
    if (!currentEditTitle) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    if (document.getElementById("wikiEditorPanel")?.classList.contains("hidden")) return;

    event.preventDefault();
    if (!promptForEditAuth()) return;
    const title = currentEditTitle || currentArticleState?.title;
    if (title) await handleSaveArticle(title);
  });
}

function initMarkdown() {
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }
}

function initIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

let trackedAcademicGen = null;

function initGenCalendarWatcher() {
  if (!window.WikiGenCalendar) return;

  trackedAcademicGen = getCurrentGen();

  const refreshIfGenChanged = () => {
    const nextGen = getCurrentGen();
    if (nextGen === trackedAcademicGen) return;
    trackedAcademicGen = nextGen;

    createGenerationLinks();

    const hash = window.location.hash || "#/";
    if (hash === "#/" || hash === "#") {
      renderRoute("home");
      return;
    }

    const genMatch = hash.match(/^#\/generation\/(\d+)$/);
    if (genMatch) {
      renderGenerationArchive(genMatch[1]);
    }
  };

  const scheduleRolloverCheck = () => {
    const nextRollover = window.WikiGenCalendar.getNextRolloverDate();
    const delay = Math.max(1000, nextRollover.getTime() - Date.now() + 500);
    window.setTimeout(() => {
      refreshIfGenChanged();
      scheduleRolloverCheck();
    }, delay);
  };

  window.setInterval(refreshIfGenChanged, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfGenChanged();
  });
  scheduleRolloverCheck();
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.WikiAuth.init(APP_CONFIG);
  await window.WikiAPI?.checkSupabaseReadiness?.();
  applyAuthToDocument();
  createGenerationLinks();
  initGenCalendarWatcher();
  initMarkdown();
  initIcons();
  initLoginModal();
  initWikiLinkNavigation();
  initArticleSearch();
  initWikiEditorShortcuts();
  initViewActions();
  initSidebarIntroLinks();
  window.WikiAuth.onSessionChange(() => {
    applyAuthToDocument();
    updateSaveButtonState();
    updateInlineSaveButton();
    refreshViewForAuthChange();
  });
  initRouting();
});
