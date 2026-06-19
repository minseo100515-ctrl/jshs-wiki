(function initWikiGenCalendar(global) {
  const BASE_GEN = 28;
  const BASE_ACADEMIC_YEAR = 2026;
  const KST = "Asia/Seoul";
  const ROLLOVER_MONTH = 3;
  const ROLLOVER_DAY = 1;

  const DEFAULT_REP_IMAGE =
    "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&h=400&fit=crop";

  function getKstParts(date = new Date()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: KST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }

  function hasPassedAcademicRollover(date = new Date()) {
    const { year, month, day, hour, minute, second } = getKstParts(date);
    if (month > ROLLOVER_MONTH) return true;
    if (month < ROLLOVER_MONTH) return false;
    if (day > ROLLOVER_DAY) return true;
    if (day < ROLLOVER_DAY) return false;
    return hour > 0 || minute > 0 || second > 0;
  }

  function getAcademicYear(date = new Date()) {
    const { year, month, day } = getKstParts(date);
    const afterRollover =
      month > ROLLOVER_MONTH ||
      (month === ROLLOVER_MONTH && day >= ROLLOVER_DAY);
    return afterRollover ? year : year - 1;
  }

  function getCurrentGen(date = new Date()) {
    return BASE_GEN + (getAcademicYear(date) - BASE_ACADEMIC_YEAR);
  }

  function getCurrentEntranceYear(date = new Date()) {
    return getAcademicYear(date);
  }

  function getGenEntranceYear(genNumber) {
    return BASE_ACADEMIC_YEAR + (Number(genNumber) - BASE_GEN);
  }

  function getGenGradeLabel(genNumber, date = new Date()) {
    const grade = getCurrentGen(date) - Number(genNumber) + 1;
    if (grade < 1 || grade > 3) return null;
    return `${grade}학년`;
  }

  function getMaxGen(date = new Date()) {
    return getCurrentGen(date);
  }

  function isFutureGen(genNumber, date = new Date()) {
    return Number(genNumber) > getCurrentGen(date);
  }

  function getNextRolloverDate(from = new Date()) {
    const { year } = getKstParts(from);
    const targetYear = hasPassedAcademicRollover(from) ? year + 1 : year;
    return new Date(`${targetYear}-03-01T00:00:00+09:00`);
  }

  function buildAutoGeneration(genNumber, date = new Date()) {
    const num = Number(genNumber);
    const current = getCurrentGen(date);

    return {
      gen_number: num,
      slogan: num === current ? "새 학년, 새 시작" : "",
      rep_image: num === current ? DEFAULT_REP_IMAGE : "",
    };
  }

  function buildAutoGenOverviewContent(genNumber, date = new Date()) {
    const num = Number(genNumber);
    const entranceYear = getGenEntranceYear(num);
    const gradeLabel = getGenGradeLabel(num, date);
    const gradeText = gradeLabel ? ` (현재 ${gradeLabel})` : "";

    return `제${num}기는 **${entranceYear}학년도 입학생**으로 구성된 기수입니다.${gradeText}

## 한 줄 요약
- **입학**: ${entranceYear}학년도
- ${num === getCurrentGen(date) ? "신입 기수 문서입니다. 소개·아카이브를 채워 주세요." : "기수 문서와 아카이브를 채워 나가세요."}`;
  }

  function formatKstLabel(date = new Date()) {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: KST,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  }

  global.WikiGenCalendar = {
    BASE_GEN,
    BASE_ACADEMIC_YEAR,
    KST,
    getKstParts,
    getAcademicYear,
    getCurrentGen,
    getCurrentEntranceYear,
    getGenEntranceYear,
    getGenGradeLabel,
    getMaxGen,
    isFutureGen,
    getNextRolloverDate,
    buildAutoGeneration,
    buildAutoGenOverviewContent,
    formatKstLabel,
  };
})(window);
