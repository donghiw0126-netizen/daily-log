'use strict';
// Daily Log 화면 동작: 날짜 이동, 탭, 오늘(홈), 습관 체크, 공부, 가계부, 일기, 백업
(function () {
  const L = window.DailyLogLogic;
  const STORAGE_KEY = 'dailylog:data';
  const TAB_KEY = 'dailylog:tab';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const $ = id => document.getElementById(id);
  const tabButtons = [...document.querySelectorAll('[data-tab]')];
  const typeButtons = [...document.querySelectorAll('[data-type]')];
  const kindButtons = [...document.querySelectorAll('[data-kind]')];
  const views = { today: $('todayView'), habits: $('habitsView'), study: $('studyView'), money: $('moneyView'), diary: $('diaryView'), settings: $('settingsView') };

  let data = loadData();
  let date = L.dateKey();          // 지금 보고 있는 날짜
  let month = L.monthOf(date);     // 가계부에서 보고 있는 달
  let tab = 'today';
  let entryType = 'expense';
  let editingHabits = false;
  let diaryTimer = null;
  let goalKind = 'cards';
  let editingGoal = null; // 편집 칸을 연 목표 id
  let session = null;     // 카드 암기 중: { goalId, mode: 'new' | 'review', queue: [카드 id], index, flipped, results }

  // ── 저장 (사생활 보호 모드 등에서 저장소가 막혀 있어도 앱은 돌아가게) ──
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw === null ? L.emptyData() : L.normalizeData(JSON.parse(raw));
    } catch { return L.emptyData(); }
  }
  function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { toast('저장하지 못했어요. 저장 공간이나 브라우저 설정을 확인해 주세요.'); }
  }

  // ── 작은 도우미 ───────────────────────────────────────
  // 사용자가 쓴 글은 반드시 textContent 로만 넣습니다. (HTML 로 해석되지 않게)
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDate(d, withYear = false) {
    const [y, m, day] = d.split('-').map(Number);
    const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
    return `${withYear ? `${y}년 ` : ''}${m}월 ${day}일 (${weekday})`;
  }
  // 습관 횟수 표시: 단위가 숫자로 시작하면("1잔") 숫자와 붙어 "0/31잔" 처럼 보이지 않게 떼어 둡니다.
  const startsWithDigit = unit => /^\d/.test(unit);
  const countLabel = (count, target, unit) =>
    `${count}/${target}${unit ? (startsWithDigit(unit) ? ' · ' : ' ') + unit : ''}`;
  const timesLabel = (n, unit) => (startsWithDigit(unit) ? `${n}번 (${unit}씩)` : `${n}${unit || '번'}`);
  const formatMonth = mo => `${Number(mo.slice(0, 4))}년 ${Number(mo.slice(5))}월`;

  let toastTimer = null;
  function toast(message) {
    const t = $('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // ── 날짜와 탭 ─────────────────────────────────────────
  function setDate(next) {
    flushDiary();
    date = next;
    month = L.monthOf(date);
    render();
  }

  function setTab(next) {
    flushDiary();
    tab = next;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* 무시 */ }
    render();
  }

  // 화면마다 위쪽 제목: [앞, 강조, 설명]
  const PAGES = {
    today: ['오늘도, ', '나의 속도로', '작은 기록이 모여 나다운 하루가 돼요.'],
    habits: ['매일 조금씩, ', '꾸준히', '작은 습관이 쌓이면 큰 변화가 돼요.'],
    study: ['오늘 할 만큼, ', '차근차근', '목표일에 맞춰 매일 할 분량과 복습을 알려 드려요.'],
    money: ['오늘 쓴 돈, ', '한눈에', '적어 두기만 해도 씀씀이가 보여요.'],
    diary: ['하루를 ', '한 줄로', '오늘은 어떤 하루였나요? 몇 줄이면 충분해요.'],
    settings: ['', '설정', '기록은 이 브라우저에만 저장돼요.'],
  };
  const DATED_TABS = ['habits', 'money', 'diary']; // 지난 날짜로 옮겨 볼 수 있는 화면

  function longDate(d) {
    const [y, m, day] = d.split('-').map(Number);
    return `${y}년 ${m}월 ${day}일 ${WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]}요일`;
  }

  function renderHeader() {
    const today = L.dateKey();
    // 오늘·공부·설정은 언제나 진짜 오늘 기준이라 날짜 이동을 숨깁니다.
    const dated = DATED_TABS.includes(tab);
    const shown = dated ? date : today;
    $('dateLabel').textContent = longDate(shown);
    $('todayButton').hidden = shown === today;
    $('prevDay').hidden = $('nextDay').hidden = !dated;
    $('nextDay').disabled = date >= today; // 미래 기록은 막습니다
    const [before, marked, sub] = PAGES[tab];
    $('pageTitle').replaceChildren(before, el('mark', '', marked));
    $('pageSub').textContent = sub;
    renderStreak(today);
    for (const b of tabButtons) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const [id, view] of Object.entries(views)) view.hidden = id !== tab;
  }

  // 사이드바: 며칠째 기록 중인지
  function renderStreak(today) {
    $('recordStreak').textContent = String(L.recordStreak(data, today));
    const active = L.activeDates(data);
    $('recordDots').replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = L.addDays(today, i - 6);
      const dot = el('i', active.has(d) ? 'on' : '');
      dot.title = `${formatDate(d)} ${active.has(d) ? '기록함' : '기록 없음'}`;
      return dot;
    }));
  }

  // 다른 화면으로 옮겨 가기 (오늘 화면의 버튼들은 언제나 오늘 날짜로)
  function goTo(next, d = L.dateKey()) {
    flushDiary();
    date = d;
    month = L.monthOf(d);
    setTab(next);
    window.scrollTo(0, 0);
  }

  // ── 오늘 (홈) ──────────────────────────────────────────
  const MOOD_WORDS = { '😄': '신나요', '🙂': '좋아요', '😐': '그저 그래요', '😔': '지쳤어요', '😢': '슬퍼요' };
  const CATEGORY_ICONS = {
    식비: 'utensils', '카페·간식': 'cup', 교통: 'bus', 쇼핑: 'bag', 생활: 'home', '문화·여가': 'ticket',
    의료: 'heart', 교육: 'book', 월급: 'coin', 용돈: 'coin', 부수입: 'coin',
  };
  let todayGoalId = null; // 오늘 화면 공부 카드에서 고른 목표

  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function renderToday() {
    const today = L.dateKey();
    const rate = L.habitRate(data.habits, data.checks, today);
    const plans = data.goals.map(g => ({ g, p: L.dailyPlan(g, today) })).filter(({ p }) => !p.complete || p.reviewsDue > 0);
    const spent = data.entries.filter(e => e.date === today && e.type === 'expense');
    const diary = data.diary[today];

    // 요약 카드
    $('statHabits').textContent = data.habits.length ? `${rate.done} / ${rate.total}` : '—';
    $('statStudy').textContent = plans.length ? `${plans.filter(r => r.p.todayDone).length} / ${plans.length} 목표` : '—';
    $('statMoney').textContent = L.formatWon(spent.reduce((n, e) => n + e.amount, 0));
    $('statMood').textContent = diary && diary.mood ? `${diary.mood} ${MOOD_WORDS[diary.mood]}` : '아직이에요';

    renderTodayHabits(today, rate);
    renderTodayStudy(today, plans);
    renderWeek(today);
    renderTodayMoney(spent);
    renderTodayLine(today, diary);
  }

  function renderTodayHabits(today, rate) {
    $('todayHabitPct').textContent = data.habits.length ? `${rate.pct}%` : '';
    $('todayHabitBar').style.width = `${rate.pct}%`;
    $('todayHabitEmpty').hidden = data.habits.length > 0;
    $('todayHabitList').replaceChildren(...data.habits.map(h => {
      const target = h.target || 1;
      const count = L.checkCount(data.checks, today, h.id);
      const done = count >= target;
      const li = el('li', done ? 'done' : '');
      const b = el('button', 'today-habit');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(done));
      b.append(el('span', `tick${done ? ' on' : count ? ' part' : ''}`, done ? '✓' : count ? String(count) : ''),
        el('span', 'today-habit-name', `${h.emoji} ${h.name}`));
      if (target > 1) b.append(el('span', 'today-habit-count', countLabel(count, target, h.unit)));
      b.addEventListener('click', () => {
        if (target > 1 && done) { toast(`오늘 ${timesLabel(target, h.unit)} 다 채웠어요! 취소는 습관 화면의 − 로 할 수 있어요.`); return; }
        data.checks = L.tapHabit(data.checks, today, h);
        saveData();
        render();
      });
      li.append(b);
      return li;
    }));
  }

  function renderTodayStudy(today, plans) {
    const box = $('todayStudy');
    box.replaceChildren();
    if (!data.goals.length) {
      box.append(el('p', 'empty', '단어장이나 책을 목표로 넣으면 오늘 할 분량이 여기에 나와요.'),
        button('공부 목표 만들기 ›', 'link-btn', () => goTo('study')));
      return;
    }
    // 오늘 할 일이 남은 목표를 먼저 보여 줍니다.
    if (!findGoal(todayGoalId)) {
      const pending = plans.find(r => !r.p.todayDone) || plans[0];
      todayGoalId = (pending ? pending.g : data.goals[0]).id;
    }
    const chips = el('div', 'chip-tabs');
    for (const g of data.goals) {
      const c = button(g.name, `chip-tab${g.id === todayGoalId ? ' active' : ''}`, () => { todayGoalId = g.id; renderToday(); });
      c.setAttribute('aria-pressed', String(g.id === todayGoalId));
      chips.append(c);
    }
    const g = findGoal(todayGoalId);
    const p = L.dailyPlan(g, today);
    const panel = el('div', 'study-panel');
    const info = el('div', 'study-info');
    if (p.complete && !p.reviewsDue) {
      info.append(el('b', '', '🎉 다 끝냈어요'), el('small', '', `${qty(g, p.total)} 전부 공부했어요`));
    } else {
      info.append(el('b', '', p.newLeft ? `새로 ${qty(g, p.newLeft)}` : p.reviewsDue ? `복습 ${p.reviewsDue}개` : '오늘 분량 끝! ✓'));
      const sub = [];
      if (p.newLeft && p.reviewsDue) sub.push(`복습 ${p.reviewsDue}개`);
      sub.push(`${qty(g, p.learnedAll)} / ${qty(g, p.total)}`, `목표일 ${formatDate(g.deadline)}`);
      info.append(el('small', '', sub.join(' · ')));
    }
    let action;
    const start = (mode, count) => { goTo('study'); startSession(g.id, mode, count); };
    if (g.kind === 'cards' && p.reviewsDue) action = button('복습 시작', 'primary play', () => start('review'));
    else if (g.kind === 'cards' && p.newLeft) action = button('외우기 시작', 'primary play', () => start('new', p.newLeft));
    else if (p.todayDone) action = button('더 하기', 'secondary', () => goTo('study'));
    else action = button('공부하러 가기', 'primary play', () => goTo('study'));
    if (action.classList.contains('play')) action.prepend(icon('play'));
    panel.append(info, action);
    box.append(chips, panel);
  }

  function renderWeek(today) {
    const chart = $('weekChart');
    chart.replaceChildren();
    for (const d of L.weekOf(today)) {
      const future = d > today;
      const r = L.habitRate(data.habits, data.checks, d);
      const [y, m, day] = d.split('-').map(Number);
      const col = button('', `week-col${d === today ? ' today' : ''}`, () => goTo('habits', d));
      col.disabled = future;
      col.setAttribute('role', 'listitem');
      col.setAttribute('aria-label', `${formatDate(d)} ${future ? '아직' : `습관 ${r.pct}%`}`);
      const track = el('span', 'week-track');
      const fill = el('span', 'week-fill');
      fill.style.height = future ? '0' : `${r.pct}%`;
      track.append(fill);
      col.append(track, el('span', 'week-day', WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]),
        el('span', 'week-pct', future || !data.habits.length ? '·' : `${r.pct}%`));
      chart.append(col);
    }
  }

  function renderTodayMoney(spent) {
    const list = $('todayMoney');
    list.replaceChildren();
    $('todayMoneyEmpty').hidden = spent.length > 0;
    const shown = spent.slice(-4).reverse(); // 최근에 적은 것부터
    for (const e of shown) {
      const li = el('li');
      const ico = el('span', 'money-icon');
      ico.append(icon(CATEGORY_ICONS[e.category] || 'dots'));
      li.append(ico, el('span', 'money-name', e.memo || e.category), el('span', 'money-amount', L.formatWon(e.amount)));
      list.append(li);
    }
    if (spent.length > shown.length) {
      const li = el('li', 'more');
      li.append(button(`외 ${spent.length - shown.length}건 더 보기 ›`, 'link-btn inline', () => goTo('money')));
      list.append(li);
    }
  }

  function renderTodayLine(today, diary) {
    const row = $('todayMoods');
    row.replaceChildren();
    for (const mood of L.MOODS) {
      const on = Boolean(diary && diary.mood === mood);
      const b = el('button', `mood${on ? ' active' : ''}`, mood);
      b.type = 'button';
      b.title = MOOD_WORDS[mood];
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', MOOD_WORDS[mood]);
      b.addEventListener('click', () => {
        flushDiary();
        const cur = data.diary[today] || { mood: '', text: '' };
        const next = { ...cur, mood: cur.mood === mood ? '' : mood };
        if (next.text.trim() || next.mood) data.diary[today] = next;
        else delete data.diary[today];
        saveData();
        render();
      });
      row.append(b);
    }
    const line = diary && diary.text.trim() ? diary.text.trim().split('\n')[0] : '';
    $('todayLineText').textContent = line || '오늘은 어떤 하루였나요?';
    $('todayLineText').classList.toggle('placeholder', !line);
  }

  // ── 습관 ───────────────────────────────────────────────
  function renderHabits() {
    const list = $('habitList');
    list.replaceChildren();
    // 오늘이면 공부 목표의 오늘 분량도 할 일로 보여 줍니다.
    const today = L.dateKey();
    const studyRows = date !== today ? [] : data.goals
      .map(g => ({ g, p: L.dailyPlan(g, today) }))
      .filter(({ p }) => !p.complete || p.reviewsDue > 0);
    const done = data.habits.filter(h => L.isDone(data.checks, date, h)).length + studyRows.filter(r => r.p.todayDone).length;
    const total = data.habits.length + studyRows.length;
    $('habitProgress').textContent = total ? `${done} / ${total} 완료` : '';
    $('habitBar').style.width = total ? `${(done / total) * 100}%` : '0';
    $('habitEmpty').hidden = data.habits.length > 0;
    $('habitEditToggle').hidden = data.habits.length === 0;
    $('habitEditToggle').textContent = editingHabits ? '편집 끝내기' : '습관 편집';
    $('habitEditToggle').setAttribute('aria-pressed', String(editingHabits));

    data.habits.forEach((h, index) => {
      const target = h.target || 1;
      const count = L.checkCount(data.checks, date, h.id);
      const checked = count >= target;
      const multi = target > 1;
      const li = el('li', `habit${checked ? ' done' : ''}`);

      const toggle = el('button', 'habit-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-pressed', String(checked));
      const partial = multi && count > 0 && !checked;
      toggle.append(el('span', `check${partial ? ' partial' : ''}`, checked ? '✓' : partial ? `${count}/${target}` : ''),
        el('span', 'habit-emoji', h.emoji), el('span', 'habit-name', h.name));
      if (multi) {
        // 하루 여러 번: 몇 번 했는지 동그라미로 (10번 이하일 때만, 많으면 숫자만)
        if (target <= 10) {
          const pips = el('span', 'pips');
          for (let i = 0; i < target; i++) pips.append(el('i', i < count ? 'on' : ''));
          toggle.append(pips);
        }
        toggle.append(el('span', 'habit-count', countLabel(count, target, h.unit)));
        toggle.setAttribute('aria-label', `${h.name} ${countLabel(count, target, h.unit)}${checked ? ' 완료' : ', 누르면 한 번 추가'}`);
      }
      toggle.addEventListener('click', () => {
        if (multi && checked) { toast(`오늘 ${timesLabel(target, h.unit)} 다 채웠어요! 잘못 눌렀다면 − 로 취소하세요.`); return; }
        data.checks = L.tapHabit(data.checks, date, h);
        saveData();
        renderHabits();
        if (multi && L.isDone(data.checks, date, h)) toast(`${h.emoji} ${h.name} 오늘 목표 완료!`);
      });

      const meta = el('div', 'habit-meta');
      if (multi && count > 0) {
        const undo = button('−', 'icon-btn undo-btn', () => {
          data.checks = L.undoTap(data.checks, date, h);
          saveData();
          renderHabits();
        });
        undo.setAttribute('aria-label', `${h.name} 한 번 취소`);
        meta.append(undo);
      }
      const streakDays = L.streak(data.checks, h, date);
      meta.append(el('span', `streak${streakDays ? '' : ' zero'}`, streakDays ? `🔥 ${streakDays}일` : '—'));
      const week = el('span', 'week');
      week.setAttribute('aria-label', '최근 7일');
      for (const d of L.recentDays(data.checks, h, date)) {
        const dot = el('i', d.done ? 'on' : d.count ? 'part' : '');
        dot.title = `${formatDate(d.date)} ${d.done ? '완료' : d.count ? countLabel(d.count, target, h.unit) : '안 함'}`;
        week.append(dot);
      }
      meta.append(week);

      li.append(toggle, meta);
      if (editingHabits) li.append(habitEditButtons(h, index));
      list.append(li);
    });

    for (const { g, p } of studyRows) {
      const li = el('li', `habit study-row${p.todayDone ? ' done' : ''}`);
      const go = el('button', 'habit-toggle');
      go.type = 'button';
      const parts = [];
      if (p.newLeft) parts.push(`새로 ${qty(g, p.newLeft)}`);
      if (p.reviewsDue) parts.push(`복습 ${p.reviewsDue}개`);
      const name = el('span', 'habit-name', g.name);
      go.append(el('span', 'check', p.todayDone ? '✓' : ''), el('span', 'habit-emoji', g.emoji), name);
      go.addEventListener('click', () => setTab('study'));
      li.append(go, el('div', 'habit-meta', parts.length ? parts.join(' · ') : '오늘 분량 끝!'));
      list.append(li);
    }
  }

  function habitEditButtons(h, index) {
    const box = el('div', 'habit-edit');
    const button = (label, aria, onClick, disabled = false) => {
      const b = el('button', 'icon-btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      box.append(b);
    };
    button('↑', `${h.name} 위로`, () => moveHabit(index, -1), index === 0);
    button('↓', `${h.name} 아래로`, () => moveHabit(index, 1), index === data.habits.length - 1);
    button('✎', `${h.name} 이름 바꾸기`, () => {
      const name = prompt('새 이름', h.name);
      if (name && name.trim()) { h.name = name.trim().slice(0, 40); saveData(); renderHabits(); }
    });
    button('🔢', `${h.name} 하루 횟수 바꾸기`, () => {
      const input = prompt('하루에 몇 번 할까요? (1~20)\n예) 물 500ml 컵으로 1.5L → 3', String(h.target || 1));
      if (input === null) return;
      const target = Number(input.trim());
      if (!Number.isInteger(target) || target < 1 || target > L.MAX_TARGET) { toast('1부터 20까지 숫자로 적어 주세요.'); return; }
      const unit = target > 1 ? prompt('단위를 적어 주세요 (예: 잔, 번, 알). 비워 둬도 돼요.', h.unit || '') : '';
      data.checks = L.retarget(data.checks, h, target, L.dateKey());
      h.target = target;
      h.unit = (unit || '').trim().slice(0, 6);
      saveData();
      renderHabits();
      toast(target > 1 ? `하루 ${timesLabel(target, h.unit)}으로 바꿨어요.` : '하루 1번으로 바꿨어요.');
    });
    button('🗑', `${h.name} 삭제`, () => {
      if (!confirm(`'${h.name}' 습관과 체크 기록을 지울까요?`)) return;
      data = L.normalizeData({ ...data, habits: data.habits.filter(x => x.id !== h.id) }); // 체크 기록도 함께 정리
      saveData();
      renderHabits();
    });
    return box;
  }

  function moveHabit(index, delta) {
    const habits = [...data.habits];
    [habits[index], habits[index + delta]] = [habits[index + delta], habits[index]];
    data.habits = habits;
    saveData();
    renderHabits();
  }

  $('habitForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('habitName').value.trim();
    if (!name) return;
    const target = Number($('habitTarget').value);
    if (!Number.isInteger(target) || target < 1 || target > L.MAX_TARGET) { toast('하루 횟수는 1부터 20까지 적어 주세요.'); return; }
    data.habits.push({
      id: L.newId(), name: name.slice(0, 40), emoji: $('habitEmoji').value.trim() || '✅',
      target, unit: target > 1 ? $('habitUnit').value.trim().slice(0, 6) : '',
    });
    saveData();
    $('habitName').value = '';
    $('habitEmoji').value = '✅';
    $('habitTarget').value = '1';
    $('habitUnit').value = '';
    renderHabits();
  });

  $('habitEditToggle').addEventListener('click', () => { editingHabits = !editingHabits; renderHabits(); });

  // ── 공부 ───────────────────────────────────────────────
  const qty = (g, n) => `${n.toLocaleString('ko-KR')}${g.unit}`;
  const range = (g, it) => (it.from === it.to ? `${it.from}${g.unit}` : `${it.from}~${it.to}${g.unit}`);
  const findGoal = id => data.goals.find(g => g.id === id);

  function updateGoal(next) {
    data.goals = data.goals.map(g => (g.id === next.id ? next : g));
    saveData();
  }

  // 새 날이 되면 전날 복습 정답률로 분량 배율을 조절합니다.
  function refreshGoals() {
    const today = L.dateKey();
    let changed = false;
    data.goals = data.goals.map(g => {
      const next = L.adjustFactor(g, today);
      if (next !== g) changed = true;
      return next;
    });
    if (changed) saveData();
  }

  function button(label, className, onClick) {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderStudy() {
    const inSession = session !== null;
    const formOpen = !$('goalForm').hidden;
    $('cardSession').hidden = !inSession;
    $('goalList').hidden = inSession;
    $('goalAddToggle').hidden = inSession || formOpen;
    if (inSession) $('goalForm').hidden = true;
    $('studyEmpty').hidden = inSession || formOpen || data.goals.length > 0;
    if (inSession) { renderSession(); return; }
    const today = L.dateKey();
    $('goalList').replaceChildren(...data.goals.map(g => goalCard(g, today)));
  }

  function goalCard(g, today) {
    const p = L.dailyPlan(g, today);
    const card = el('article', 'card goal');

    const head = el('div', 'card-head');
    head.append(el('h2', '', `${g.emoji} ${g.name}`),
      button(editingGoal === g.id ? '닫기' : '편집', 'link-btn inline', () => {
        editingGoal = editingGoal === g.id ? null : g.id;
        renderStudy();
      }));
    card.append(head);

    const pct = p.total ? Math.round((p.learnedAll / p.total) * 100) : 0;
    const bar = el('div', 'progress');
    const fill = el('div', 'progress-bar');
    fill.style.width = `${pct}%`;
    bar.append(fill);
    const dday = L.daysBetween(today, g.deadline);
    card.append(bar, el('p', 'goal-stats muted small',
      `${qty(g, p.learnedAll)} / ${qty(g, p.total)} (${pct}%) · ${g.kind === 'cards' ? '완전히 외움' : '복습 끝'} ${p.mastered}${g.kind === 'cards' ? '개' : '번'}` +
      ` · 목표일 ${formatDate(g.deadline)} ${dday > 0 ? `D-${dday}` : dday === 0 ? 'D-day' : `${-dday}일 지남`}`));

    // 오늘 할 일
    const todayBox = el('div', 'goal-today');
    if (p.complete) {
      todayBox.append(el('p', 'good', p.reviewsDue ? '🎉 전부 공부했어요! 남은 복습만 하면 돼요.' : '🎉 전부 공부했어요! 복습할 때가 되면 여기에 알려 드릴게요.'));
    } else {
      const newLine = p.newLeft
        ? `새로 할 분량 ${qty(g, p.quota)}${p.doneToday ? ` (${p.doneToday} 완료)` : ''}`
        : `새 분량 ${qty(g, p.quota)} 끝! ✓`;
      todayBox.append(el('p', '', `오늘 · ${newLine} · 복습 ${p.reviewsDue}개`));
    }
    card.append(todayBox);

    if (p.overdue) card.append(el('p', 'warn', '⚠️ 목표일이 지났어요. 남은 분량이 모두 오늘로 잡혔으니 편집에서 목표일을 다시 정해 주세요.'));
    else if (p.late) {
      const lateBy = L.daysBetween(g.deadline, p.finishDate);
      card.append(el('p', 'warn', `⚠️ 지금 분량이면 ${formatDate(p.finishDate)}에 끝나요 (목표일보다 ${lateBy}일 늦어요). 복습 정답률이 낮아 새 분량을 줄였어요. 복습에 집중하거나 목표일을 미뤄 보세요.`));
    }
    if (!p.complete) {
      card.append(el('p', 'muted small', `내 수준 반영: 목표일에 딱 맞추는 분량(하루 ${qty(g, Math.ceil(p.required))})의 ${Math.round(g.factor * 100)}% · 전날 복습 정답률에 따라 매일 조절돼요`));
    }

    card.append(g.kind === 'cards' ? cardActions(g, p) : amountActions(g, p, today));
    if (editingGoal === g.id) card.append(goalEditor(g, p, today));
    return card;
  }

  function cardActions(g, p) {
    const row = el('div', 'button-row');
    if (p.reviewsDue) row.append(button(`복습하기 ${p.reviewsDue}개`, 'primary', () => startSession(g.id, 'review')));
    if (p.newLeft) row.append(button(`새 단어 외우기 ${p.newLeft}개`, p.reviewsDue ? 'secondary' : 'primary', () => startSession(g.id, 'new', p.newLeft)));
    else if (p.left) row.append(button('더 외우기 +5', 'secondary', () => startSession(g.id, 'new', 5)));
    return row;
  }

  function amountActions(g, p, today) {
    const box = el('div', 'amount-actions');
    const due = g.items.filter(it => it.due && it.due <= today);
    if (due.length) {
      box.append(el('p', 'small muted', '복습할 범위 — 다시 훑어보고 얼마나 기억나는지 골라 주세요.'));
      const list = el('ul', 'review-list');
      for (const it of due) {
        const li = el('li');
        li.append(el('span', 'review-range', `${range(g, it)} (${formatDate(it.learnedOn)} 공부)`));
        const rates = el('div', 'rate-mini');
        for (const [rating, label] of [['again', '까먹음'], ['hard', '헷갈림'], ['good', '기억남']]) {
          rates.append(button(label, `rate ${rating}`, () => { updateGoal(L.applyReview(findGoal(g.id), it.id, rating, L.dateKey())); render(); }));
        }
        li.append(rates);
        list.append(li);
      }
      box.append(list);
    }
    if (p.left) {
      const start = p.learnedAll + 1;
      const n = p.newLeft || Math.min(p.left, p.quota || p.left);
      const form = el('form', 'amount-form');
      form.append(el('span', 'small', p.newLeft ? `오늘: ${range(g, { from: start, to: start + p.newLeft - 1 })}` : '더 했다면:'));
      const input = el('input');
      input.inputMode = 'numeric';
      input.value = String(n);
      input.setAttribute('aria-label', `공부한 ${g.unit} 수`);
      form.append(input, el('span', 'small', g.unit), el('button', 'primary', '했어요'));
      form.addEventListener('submit', e => {
        e.preventDefault();
        const amount = L.parseAmount(input.value);
        if (amount === null) { toast('숫자로 적어 주세요.'); return; }
        updateGoal(L.addAmount(findGoal(g.id), amount, L.dateKey()));
        toast(`${qty(g, Math.min(amount, p.left))} 기록했어요. 내일 복습으로 다시 나와요.`);
        render();
      });
      box.append(form);
    }
    return box;
  }

  function goalEditor(g, p, today) {
    const box = el('div', 'goal-editor');

    const dateRow = el('form', 'add-row');
    const dateInput = el('input');
    dateInput.type = 'date';
    dateInput.min = today;
    dateInput.value = g.deadline;
    dateInput.setAttribute('aria-label', '새 목표일');
    dateRow.append(dateInput, el('button', 'secondary', '목표일 바꾸기'));
    dateRow.addEventListener('submit', e => {
      e.preventDefault();
      if (!L.isValidDate(dateInput.value) || dateInput.value < today) { toast('오늘이나 그 뒤 날짜를 골라 주세요.'); return; }
      updateGoal({ ...findGoal(g.id), deadline: dateInput.value });
      toast('목표일을 바꿨어요. 하루 분량을 다시 계산했어요.');
      render();
    });
    box.append(dateRow);

    if (g.kind === 'cards') {
      const addForm = el('form', 'field-stack');
      const text = el('textarea');
      text.rows = 3;
      text.placeholder = '단어 더 넣기: 한 줄에 하나씩 단어 - 뜻';
      text.setAttribute('aria-label', '추가할 단어');
      addForm.append(text, el('button', 'secondary', '단어 추가'));
      addForm.addEventListener('submit', e => {
        e.preventDefault();
        const { cards, skipped } = L.parseCards(text.value);
        if (!cards.length) { toast('단어와 뜻 사이에 - 를 넣어 주세요.'); return; }
        const goal = findGoal(g.id);
        updateGoal({ ...goal, items: [...goal.items, ...cards.map(L.newCard)] });
        toast(`단어 ${cards.length}개를 넣었어요.${skipped ? ` (못 읽은 줄 ${skipped}개)` : ''}`);
        render();
      });
      box.append(addForm);
    } else {
      const totalRow = el('form', 'add-row');
      const totalInput = el('input');
      totalInput.inputMode = 'numeric';
      totalInput.value = String(g.total);
      totalInput.setAttribute('aria-label', '전체 분량');
      totalRow.append(totalInput, el('button', 'secondary', '전체 분량 바꾸기'));
      totalRow.addEventListener('submit', e => {
        e.preventDefault();
        const total = L.parseAmount(totalInput.value);
        if (total === null || total > 100000 || total < p.learnedAll) { toast(`${qty(g, p.learnedAll)} 이상으로 적어 주세요.`); return; }
        updateGoal({ ...findGoal(g.id), total });
        toast('전체 분량을 바꿨어요.');
        render();
      });
      box.append(totalRow);
    }

    box.append(button('목표 삭제', 'danger-btn', () => {
      if (!confirm(`'${g.name}' 목표와 공부·복습 기록을 모두 지울까요?`)) return;
      data.goals = data.goals.filter(x => x.id !== g.id);
      editingGoal = null;
      saveData();
      render();
    }));
    return box;
  }

  // 단어 카드 암기·복습
  function startSession(goalId, mode, count) {
    const g = findGoal(goalId);
    const today = L.dateKey();
    const queue = (mode === 'review'
      ? g.items.filter(it => it.learnedOn && it.due && it.due <= today)
      : g.items.filter(it => !it.learnedOn).slice(0, count)).map(it => it.id);
    if (!queue.length) return;
    session = { goalId, mode, queue, index: 0, flipped: false, typed: null, results: { good: 0, hard: 0, again: 0, learned: 0, known: 0 } };
    renderStudy();
    if (!(mode === 'review' && g.typing)) $('flashcard').focus();
  }

  function sessionItem() {
    const g = session && findGoal(session.goalId);
    const item = g && g.items.find(it => it.id === session.queue[session.index]);
    return item ? { g, item } : null;
  }

  function renderSession() {
    const current = sessionItem();
    if (!current) { session = null; renderStudy(); return; } // 다른 창에서 목표를 지운 경우
    const { g, item } = current;
    const review = session.mode === 'review';
    $('sessionTitle').textContent = `${g.emoji} ${g.name} · ${review ? '복습' : '새 단어'}`;
    $('sessionBar').style.width = `${(session.index / session.queue.length) * 100}%`;
    $('sessionCount').textContent = `${session.index + 1} / ${session.queue.length}`;
    $('typingToggle').hidden = !review;
    $('typingToggle').setAttribute('aria-pressed', String(g.typing));
    $('typingToggle').textContent = `⌨️ ${g.typing ? '켬' : '끔'}`;
    $('typingToggle').title = `직접 쳐서 맞히기 ${g.typing ? '켜짐' : '꺼짐'}`;
    const typing = review && g.typing;
    // 쳐서 맞히기: 뜻을 먼저 보여 주고, 답한 뒤에 단어를 보여 줍니다.
    $('cardFront').textContent = typing ? item.back : item.front;
    $('cardBack').textContent = typing ? item.front : item.back;
    $('cardBack').hidden = typing ? !session.typed : !session.flipped;
    $('cardHint').hidden = typing || session.flipped;
    $('typeForm').hidden = !typing || session.typed !== null;
    $('typeResult').hidden = !typing || session.typed === null;

    const row = $('sessionButtons');
    row.replaceChildren();
    if (typing) {
      if (!session.typed) {
        row.append(button('모르겠어요', 'secondary', () => checkTyped('')));
        $('typeInput').value = '';
        $('typeInput').focus();
      } else {
        const { answer, result } = session.typed;
        const box = $('typeResult');
        box.className = `type-result ${result}`;
        box.replaceChildren(el('span', '', { good: '😊 정답!', hard: '🤔 거의 맞았어요. 철자를 확인해 보세요', again: '😣 틀렸어요' }[result]));
        if (answer) box.append(el('small', '', `내가 쓴 답: ${answer}`));
        if (result !== 'good' && answer) box.append(button('사실 맞았어요 (같은 뜻의 다른 단어를 썼어요)', 'link-btn override', () => answerTyped('good')));
        const next = button('다음 →', 'primary wide', () => answerTyped(result));
        row.append(next);
        next.focus();
      }
    } else if (review) {
      if (!session.flipped) row.append(button('뜻 보기', 'primary wide', flipCard));
      else {
        row.append(button('😣 까먹음 1', 'rate again', () => answer('again')),
          button('🤔 헷갈림 2', 'rate hard', () => answer('hard')),
          button('😊 기억남 3', 'rate good', () => answer('good')));
      }
    } else {
      row.append(button('이미 알아요 1', 'secondary', () => answer('known')));
      row.append(session.flipped
        ? button('외웠어요 ✓ 3', 'primary', () => answer('learned'))
        : button('뜻 보기', 'primary', flipCard));
    }
  }

  function checkTyped(typed) {
    const current = sessionItem();
    if (!current || session.typed) return;
    session.typed = { answer: typed.trim(), result: L.gradeTyped(typed, current.item.front) };
    renderSession();
  }

  function answerTyped(result) {
    session.typed = null;
    answer(result);
    if (session) $('typeInput').focus(); // 폰에서 키보드가 내려가지 않게
  }

  $('typeForm').addEventListener('submit', e => {
    e.preventDefault();
    checkTyped($('typeInput').value);
  });

  $('typingToggle').addEventListener('click', () => {
    const current = sessionItem();
    if (!current) return;
    updateGoal({ ...current.g, typing: !current.g.typing });
    session.typed = null;
    session.flipped = false;
    renderSession();
  });

  function flipCard() {
    if (!session || session.flipped || (session.mode === 'review' && findGoal(session.goalId).typing)) return;
    session.flipped = true;
    renderSession();
  }

  function answer(action) {
    const current = sessionItem();
    if (!current) return;
    const today = L.dateKey();
    const { g, item } = current;
    if (action === 'known' || action === 'learned') {
      updateGoal(L.learnCard(g, item.id, today, action === 'known'));
      session.results[action]++;
    } else {
      updateGoal(L.applyReview(g, item.id, action, today));
      session.results[action]++;
    }
    session.index++;
    session.flipped = false;
    if (session.index < session.queue.length) { renderSession(); return; }
    const r = session.results;
    toast(session.mode === 'review'
      ? `복습 끝! 기억남 ${r.good} · 헷갈림 ${r.hard} · 까먹음 ${r.again}`
      : `새 단어 ${r.learned}개 외웠어요!${r.known ? ` (이미 앎 ${r.known}개)` : ''} 내일 복습으로 다시 나와요.`);
    session = null;
    render();
  }

  $('flashcard').addEventListener('click', flipCard);
  $('sessionClose').addEventListener('click', () => { session = null; render(); });

  // 키보드: Space 뜻 보기 · 1/2/3 답하기
  document.addEventListener('keydown', e => {
    if (!session || tab !== 'study' || e.ctrlKey || e.metaKey || e.altKey) return;
    const review = session.mode === 'review';
    // 쳐서 맞히기 중에는 숫자·Space 가 글자 입력이라 단축키를 쓰지 않습니다. (Enter 는 확인·다음 버튼이 처리)
    if (review && findGoal(session.goalId)?.typing) {
      if (e.key === 'Escape') { session = null; render(); }
      return;
    }
    const keys = review
      ? { 1: 'again', 2: 'hard', 3: 'good' }
      : { 1: 'known', 3: 'learned' };
    if (e.key === ' ' || e.key === 'Enter') {
      if (!session.flipped) { e.preventDefault(); flipCard(); }
    } else if (keys[e.key] && (session.flipped || keys[e.key] === 'known')) {
      e.preventDefault();
      answer(keys[e.key]);
    } else if (e.key === 'Escape') {
      session = null;
      render();
    }
  });

  // 새 목표 만들기
  $('goalUnit').replaceChildren(...L.UNITS.map(u => el('option', '', u)));
  $('goalLevel').replaceChildren(...Object.entries(L.LEVELS).map(([id, lv]) => {
    const o = el('option', '', lv.name);
    o.value = id;
    return o;
  }));

  function goalFormTotal() {
    if (goalKind === 'cards') return L.parseCards($('goalCards').value).cards.length;
    const n = L.parseAmount($('goalTotal').value);
    return n !== null && n <= 100000 ? n : 0;
  }

  function renderGoalForm() {
    for (const b of kindButtons) {
      const on = b.dataset.kind === goalKind;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    $('goalCardsFields').hidden = goalKind !== 'cards';
    $('goalAmountFields').hidden = goalKind !== 'amount';
    if (goalKind === 'cards') {
      const { cards, skipped } = L.parseCards($('goalCards').value);
      $('goalCardsCount').textContent = cards.length || skipped
        ? `단어 ${cards.length}개${skipped ? ` · 못 읽은 줄 ${skipped}개 (단어와 뜻 사이에 - 를 넣어 주세요)` : ''}`
        : '';
    }
    const today = L.dateKey();
    const total = goalFormTotal();
    const deadline = $('goalDeadline').value;
    const unit = goalKind === 'cards' ? '단어' : $('goalUnit').value;
    if (!total || !L.isValidDate(deadline) || deadline < today) { $('goalPreview').textContent = ''; return; }
    const days = L.daysBetween(today, deadline) + 1;
    const perDay = Math.min(total, Math.ceil((total / days) * L.LEVELS[$('goalLevel').value].factor));
    $('goalPreview').textContent =
      `하루 약 ${perDay.toLocaleString('ko-KR')}${unit}씩 · 오늘 포함 ${days}일 · 공부한 다음 날부터 복습도 자동으로 잡혀요`;
  }

  function openGoalForm(open) {
    $('goalForm').hidden = !open;
    if (open) {
      $('goalForm').reset();
      $('goalEmoji').value = '📚';
      $('goalDeadline').min = L.dateKey();
      $('goalDeadline').value = L.addDays(L.dateKey(), 29);
      renderGoalForm();
      $('goalName').focus();
    }
    renderStudy();
  }

  for (const b of kindButtons) b.addEventListener('click', () => { goalKind = b.dataset.kind; renderGoalForm(); });
  for (const id of ['goalCards', 'goalTotal', 'goalDeadline', 'goalLevel', 'goalUnit']) {
    $(id).addEventListener('input', renderGoalForm);
  }
  $('goalAddToggle').addEventListener('click', () => openGoalForm(true));
  $('goalCancel').addEventListener('click', () => openGoalForm(false));

  $('goalForm').addEventListener('submit', e => {
    e.preventDefault();
    const today = L.dateKey();
    const name = $('goalName').value.trim();
    const deadline = $('goalDeadline').value;
    const total = goalFormTotal();
    if (!name) { toast('목표 이름을 적어 주세요.'); return; }
    if (!total) { toast(goalKind === 'cards' ? '단어를 한 줄에 하나씩 "단어 - 뜻"으로 넣어 주세요.' : '전체 분량을 숫자로 적어 주세요.'); return; }
    if (!L.isValidDate(deadline) || deadline < today) { toast('목표일은 오늘이나 그 뒤로 골라 주세요.'); return; }
    data.goals.push(L.createGoal({
      name, emoji: $('goalEmoji').value.trim(), kind: goalKind, unit: $('goalUnit').value, total,
      cards: goalKind === 'cards' ? L.parseCards($('goalCards').value).cards : [], deadline, level: $('goalLevel').value,
    }, today));
    saveData();
    openGoalForm(false);
    toast('목표를 만들었어요. 오늘 분량부터 시작해 보세요!');
  });

  // ── 가계부 ─────────────────────────────────────────────
  function renderEntryType() {
    for (const b of typeButtons) {
      const on = b.dataset.type === entryType;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    const select = $('entryCategory');
    select.replaceChildren(...L.CATEGORIES[entryType].map(c => el('option', '', c)));
  }

  function renderMoney() {
    renderShopping();
    $('monthLabel').textContent = formatMonth(month);
    $('nextMonth').disabled = month >= L.monthOf(L.dateKey());
    const s = L.summarizeMonth(data.entries, month);
    $('sumIncome').textContent = L.formatWon(s.income);
    $('sumExpense').textContent = L.formatWon(s.expense);
    $('sumBalance').textContent = L.formatWon(s.balance);
    $('sumBalance').className = s.balance < 0 ? 'bad' : '';

    const bars = $('categoryBars');
    bars.replaceChildren();
    const top = s.categories[0] ? s.categories[0].amount : 0;
    for (const c of s.categories) {
      const li = el('li');
      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${(c.amount / top) * 100}%`;
      track.append(fill);
      li.append(el('span', 'bar-label', c.category), track, el('span', 'bar-value', L.formatWon(c.amount)));
      bars.append(li);
    }

    const list = $('entryList');
    list.replaceChildren();
    const entries = L.entriesOfMonth(data.entries, month);
    $('entryEmpty').hidden = entries.length > 0;
    let lastDate = null;
    for (const e of entries) {
      if (e.date !== lastDate) {
        lastDate = e.date;
        list.append(el('li', `entry-date${e.date === date ? ' current' : ''}`, formatDate(e.date)));
      }
      const li = el('li', 'entry');
      const info = el('div', 'entry-info');
      info.append(el('span', 'entry-cat', e.category));
      if (e.memo) info.append(el('span', 'entry-memo', e.memo));
      const amount = el('span', `entry-amount ${e.type === 'income' ? 'good' : ''}`,
        `${e.type === 'income' ? '+' : '−'}${L.formatWon(e.amount)}`);
      const del = el('button', 'icon-btn', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `${e.category} ${L.formatWon(e.amount)} 삭제`);
      del.addEventListener('click', () => {
        if (!confirm(`${formatDate(e.date)} ${e.category} ${L.formatWon(e.amount)} 기록을 지울까요?`)) return;
        data.entries = data.entries.filter(x => x.id !== e.id);
        saveData();
        renderMoney();
      });
      li.append(info, amount, del);
      list.append(li);
    }
  }

  // 쇼핑 리스트: 마트별로 묶어 보여 주고, 체크하면 지금 보는 날짜 가계부에 적습니다.
  function renderShopping() {
    const groups = L.shopGroups(data.shopping);
    const left = groups.reduce((n, g) => n + g.left, 0);
    const total = groups.reduce((n, g) => n + g.total, 0);
    $('shopLeft').textContent = left ? `${left}개 남음${total ? ` · 예상 ${L.formatWon(total)}` : ''}` : '';
    $('shopEmpty').hidden = groups.length > 0;
    $('shopClear').hidden = !data.shopping.some(it => it.bought);
    $('shopStores').replaceChildren(...groups.filter(g => g.store !== L.NO_STORE).map(g => {
      const o = el('option');
      o.value = g.store;
      return o;
    }));
    $('shopList').replaceChildren(...groups.map(g => {
      const box = el('section', 'shop-group');
      const head = el('div', 'shop-store');
      const sub = g.left ? `${g.left}개 남음${g.total ? ` · 예상 ${L.formatWon(g.total)}` : ''}` : '다 샀어요 ✓';
      head.append(el('b', '', g.store), el('span', 'muted', sub));
      const ul = el('ul', 'shop-items');
      for (const it of g.items) {
        const li = el('li', `shop-item${it.bought ? ' done' : ''}`);
        const toggle = el('button', 'shop-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-pressed', String(it.bought));
        const name = el('span', 'shop-name', it.name);
        name.append(el('small', 'shop-cat', it.category));
        toggle.append(el('span', `check${it.bought ? ' on' : ''}`, it.bought ? '✓' : ''), name,
          el('span', 'shop-price', it.price ? L.formatWon(it.price) : ''));
        toggle.addEventListener('click', () => toggleShopItem(it));
        const del = el('button', 'icon-btn', '×');
        del.type = 'button';
        del.setAttribute('aria-label', `${it.name} 지우기`);
        del.addEventListener('click', () => {
          data.shopping = data.shopping.filter(x => x.id !== it.id);
          saveData();
          renderShopping();
        });
        li.append(toggle, del);
        ul.append(li);
      }
      box.append(head, ul);
      return box;
    }));
  }

  function toggleShopItem(it) {
    if (it.bought) {
      data = L.unbuyShopItem(data, it.id);
      if (it.entryId) toast(`가계부에서 ${it.name} 기록을 지웠어요.`);
    } else {
      let price;
      if (!it.price) {
        const answer = prompt(`${it.name}, 얼마였어요? (비워 두면 가계부에는 안 적어요)`, '');
        if (answer === null) return; // 취소
        if (answer.trim() && L.parseAmount(answer) === null) { toast('금액을 숫자로 적어 주세요.'); return; }
        price = answer;
      }
      data = L.buyShopItem(data, it.id, date, L.newId(), price);
      const bought = data.shopping.find(x => x.id === it.id);
      toast(bought.entryId ? `${formatDate(date)} 가계부에 ${L.formatWon(bought.price)} 적었어요.` : `${it.name} 샀어요 ✓`);
    }
    saveData();
    month = L.monthOf(date);
    render(); // 기록 연속 일수도 함께 바뀝니다
  }

  // 분류 고르기: 가계부 지출 분류와 같고, 장보기가 대부분이라 처음엔 식비
  $('shopCategory').replaceChildren(...L.CATEGORIES.expense.map(c => el('option', '', c)));
  $('shopCategory').value = '식비';

  $('shopPrice').addEventListener('input', e => {
    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
    e.target.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  });

  $('shopForm').addEventListener('submit', e => {
    e.preventDefault();
    const price = $('shopPrice').value;
    if (price && L.parseAmount(price) === null) { toast('가격을 숫자로 적어 주세요.'); return; }
    const before = data.shopping.length;
    data.shopping = L.addShopItem(data.shopping,
      { store: $('shopStore').value, name: $('shopName').value, category: $('shopCategory').value, price }, L.newId());
    if (data.shopping.length === before) { $('shopName').focus(); return; }
    saveData();
    // 같은 마트 품목을 이어서 적기 쉽게 마트 이름과 분류는 남겨 둡니다.
    $('shopName').value = '';
    $('shopPrice').value = '';
    $('shopName').focus();
    renderShopping();
  });

  $('shopClear').addEventListener('click', () => {
    const n = data.shopping.filter(it => it.bought).length;
    data.shopping = data.shopping.filter(it => !it.bought);
    saveData();
    renderShopping();
    toast(`산 것 ${n}개를 목록에서 치웠어요. 가계부 기록은 그대로예요.`);
  });

  for (const b of typeButtons) {
    b.addEventListener('click', () => { entryType = b.dataset.type; renderEntryType(); });
  }

  // 금액 칸에 쓰는 대로 천 단위 쉼표를 넣어 줍니다.
  $('entryAmount').addEventListener('input', e => {
    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
    e.target.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  });

  $('entryForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = L.parseAmount($('entryAmount').value);
    if (amount === null) { toast('금액을 숫자로 적어 주세요.'); $('entryAmount').focus(); return; }
    data.entries.push({
      id: L.newId(), date, type: entryType, amount,
      category: $('entryCategory').value, memo: $('entryMemo').value.trim().slice(0, 100),
    });
    saveData();
    $('entryAmount').value = '';
    $('entryMemo').value = '';
    month = L.monthOf(date);
    renderMoney();
    toast(`${entryType === 'income' ? '수입' : '지출'} ${L.formatWon(amount)} 기록했어요.`);
  });

  $('prevMonth').addEventListener('click', () => { month = L.addMonths(month, -1); renderMoney(); });
  $('nextMonth').addEventListener('click', () => { month = L.addMonths(month, 1); renderMoney(); });

  // ── 일기 ───────────────────────────────────────────────
  function currentDiary() {
    return data.diary[date] || { mood: '', text: '' };
  }

  function setDiary(changes) {
    const next = { ...currentDiary(), ...changes };
    if (next.text.trim() || next.mood) data.diary[date] = next;
    else delete data.diary[date];
  }

  function renderDiary() {
    const entry = currentDiary();
    const row = $('moodRow');
    row.replaceChildren();
    for (const mood of L.MOODS) {
      const b = el('button', `mood${entry.mood === mood ? ' active' : ''}`, mood);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(entry.mood === mood));
      b.addEventListener('click', () => {
        setDiary({ mood: currentDiary().mood === mood ? '' : mood, text: $('diaryText').value });
        saveData();
        renderDiary();
      });
      row.append(b);
    }
    const textarea = $('diaryText');
    if (document.activeElement !== textarea) textarea.value = entry.text;
    textarea.maxLength = L.MAX_TEXT;
    $('diaryCount').textContent = textarea.value.length.toLocaleString('ko-KR');
    $('diarySaved').textContent = data.diary[date] ? '저장됨' : '';
    renderDiaryList();
  }

  function renderDiaryList() {
    const mo = L.monthOf(date);
    $('diaryMonthLabel').textContent = `${formatMonth(mo)} 일기`;
    const dates = Object.keys(data.diary).filter(d => L.monthOf(d) === mo).sort().reverse();
    const list = $('diaryList');
    list.replaceChildren();
    $('diaryEmpty').hidden = dates.length > 0;
    for (const d of dates) {
      const entry = data.diary[d];
      const b = el('button', `diary-item${d === date ? ' current' : ''}`);
      b.type = 'button';
      b.append(el('span', 'diary-mood', entry.mood || '·'), el('span', 'diary-date', formatDate(d)),
        el('span', 'diary-preview', entry.text.split('\n')[0] || '(글 없음)'));
      b.addEventListener('click', () => setDate(d));
      const li = el('li');
      li.append(b);
      list.append(li);
    }
  }

  // 쓰는 중에는 잠깐 멈췄을 때 저장하고, 다른 날짜·탭으로 가거나 앱을 닫을 때 바로 저장합니다.
  function flushDiary() {
    if (diaryTimer === null) return;
    clearTimeout(diaryTimer);
    diaryTimer = null;
    setDiary({ text: $('diaryText').value });
    saveData();
  }

  $('diaryText').addEventListener('input', e => {
    $('diaryCount').textContent = e.target.value.length.toLocaleString('ko-KR');
    $('diarySaved').textContent = '쓰는 중…';
    clearTimeout(diaryTimer);
    diaryTimer = setTimeout(() => { flushDiary(); $('diarySaved').textContent = '저장됨'; renderDiaryList(); }, 600);
  });
  $('diaryText').addEventListener('blur', () => { if (diaryTimer !== null) { flushDiary(); renderDiary(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDiary(); });
  window.addEventListener('pagehide', flushDiary);

  // ── 설정: 백업 ─────────────────────────────────────────
  function renderSettings() {
    const days = new Set([...Object.keys(data.checks), ...Object.keys(data.diary), ...data.entries.map(e => e.date)]);
    $('storageInfo').textContent =
      `지금 저장된 것: 습관 ${data.habits.length}개 · 공부 목표 ${data.goals.length}개 · 가계부 ${data.entries.length}건 · 쇼핑 ${data.shopping.length}개 · 일기 ${Object.keys(data.diary).length}편 (기록한 날 ${days.size}일)`;
  }

  $('exportButton').addEventListener('click', () => {
    flushDiary();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily-log-backup-${L.dateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('백업 파일을 내려받았어요.');
  });

  $('importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let imported;
    try { imported = L.normalizeData(JSON.parse(await file.text())); }
    catch (err) { toast(err instanceof SyntaxError ? '파일을 읽을 수 없어요.' : err.message); return; }
    const summary = `습관 ${imported.habits.length}개, 공부 목표 ${imported.goals.length}개, 가계부 ${imported.entries.length}건, 일기 ${Object.keys(imported.diary).length}편`;
    if (!confirm(`백업(${summary})으로 지금 기록을 바꿀까요?\n지금 기록은 사라져요.`)) return;
    data = imported;
    saveData();
    render();
    toast('백업을 가져왔어요.');
  });

  $('resetButton').addEventListener('click', () => {
    if (!confirm('정말 모든 기록을 지울까요? 되돌릴 수 없어요.')) return;
    if (!confirm('마지막 확인이에요. 백업은 받아 두셨나요? 지우려면 확인을 눌러 주세요.')) return;
    clearTimeout(diaryTimer);
    diaryTimer = null;
    data = L.emptyData();
    saveData();
    render();
    toast('모든 기록을 지웠어요.');
  });

  // ── 시작 ───────────────────────────────────────────────
  function render() {
    refreshGoals();
    renderHeader();
    if (tab === 'today') renderToday();
    else if (tab === 'habits') renderHabits();
    else if (tab === 'study') renderStudy();
    else if (tab === 'money') renderMoney();
    else if (tab === 'diary') renderDiary();
    else renderSettings();
  }

  $('prevDay').addEventListener('click', () => setDate(L.addDays(date, -1)));
  $('nextDay').addEventListener('click', () => { if (date < L.dateKey()) setDate(L.addDays(date, 1)); });
  $('todayButton').addEventListener('click', () => setDate(L.dateKey()));
  for (const b of tabButtons) b.addEventListener('click', () => { closeQuick(); setTab(b.dataset.tab); window.scrollTo(0, 0); });

  // 오늘 화면의 카드·버튼에서 각 화면으로 (data-go="화면")
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) goTo(go.dataset.go);
  });

  // "+ 기록하기": 자주 쓰는 기록으로 바로 가기
  function closeQuick() {
    $('quickMenu').hidden = true;
    $('quickButton').setAttribute('aria-expanded', 'false');
  }
  $('quickButton').addEventListener('click', e => {
    e.stopPropagation();
    const open = $('quickMenu').hidden;
    $('quickMenu').hidden = !open;
    $('quickButton').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.quick')) closeQuick(); });
  for (const b of document.querySelectorAll('[data-quick]')) {
    b.addEventListener('click', () => {
      closeQuick();
      goTo(b.dataset.quick);
      if (b.dataset.quick === 'money') { entryType = 'expense'; renderEntryType(); $('entryAmount').focus(); }
      if (b.dataset.quick === 'diary') $('diaryText').focus();
    });
  }

  // 다른 탭(브라우저 창)에서 바꾼 내용을 반영합니다.
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) { data = loadData(); render(); }
  });

  try { const saved = localStorage.getItem(TAB_KEY); if (views[saved]) tab = saved; } catch { /* 무시 */ }
  renderEntryType();
  render();
})();
