'use strict';
// Daily Log 화면 동작: 날짜 이동, 탭, 습관 체크, 가계부, 일기, 백업
(function () {
  const L = window.DailyLogLogic;
  const STORAGE_KEY = 'dailylog:data';
  const TAB_KEY = 'dailylog:tab';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const $ = id => document.getElementById(id);
  const tabButtons = [...document.querySelectorAll('[data-tab]')];
  const typeButtons = [...document.querySelectorAll('[data-type]')];
  const views = { habits: $('habitsView'), money: $('moneyView'), diary: $('diaryView'), settings: $('settingsView') };

  let data = loadData();
  let date = L.dateKey();          // 지금 보고 있는 날짜
  let month = L.monthOf(date);     // 가계부에서 보고 있는 달
  let tab = 'habits';
  let entryType = 'expense';
  let editingHabits = false;
  let diaryTimer = null;

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

  function renderHeader() {
    const today = L.dateKey();
    $('dateLabel').textContent = date === today ? `오늘 · ${formatDate(date)}` : formatDate(date, true);
    $('todayButton').hidden = date === today;
    $('nextDay').disabled = date >= today; // 미래 기록은 막습니다
    for (const b of tabButtons) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const [id, view] of Object.entries(views)) view.hidden = id !== tab;
  }

  // ── 습관 ───────────────────────────────────────────────
  function renderHabits() {
    const list = $('habitList');
    list.replaceChildren();
    const done = data.habits.filter(h => L.isChecked(data.checks, date, h.id)).length;
    const total = data.habits.length;
    $('habitProgress').textContent = total ? `${done} / ${total} 완료` : '';
    $('habitBar').style.width = total ? `${(done / total) * 100}%` : '0';
    $('habitEmpty').hidden = total > 0;
    $('habitEditToggle').hidden = total === 0;
    $('habitEditToggle').textContent = editingHabits ? '편집 끝내기' : '습관 편집';
    $('habitEditToggle').setAttribute('aria-pressed', String(editingHabits));

    data.habits.forEach((h, index) => {
      const checked = L.isChecked(data.checks, date, h.id);
      const li = el('li', `habit${checked ? ' done' : ''}`);

      const toggle = el('button', 'habit-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-pressed', String(checked));
      toggle.append(el('span', 'check', checked ? '✓' : ''), el('span', 'habit-emoji', h.emoji), el('span', 'habit-name', h.name));
      toggle.addEventListener('click', () => {
        data.checks = L.toggleCheck(data.checks, date, h.id);
        saveData();
        renderHabits();
      });

      const meta = el('div', 'habit-meta');
      const count = L.streak(data.checks, h.id, date);
      meta.append(el('span', `streak${count ? '' : ' zero'}`, count ? `🔥 ${count}일` : '—'));
      const week = el('span', 'week');
      week.setAttribute('aria-label', '최근 7일');
      for (const d of L.recentDays(data.checks, h.id, date)) {
        const dot = el('i', d.done ? 'on' : '');
        dot.title = `${formatDate(d.date)} ${d.done ? '완료' : '안 함'}`;
        week.append(dot);
      }
      meta.append(week);

      li.append(toggle, meta);
      if (editingHabits) li.append(habitEditButtons(h, index));
      list.append(li);
    });
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
    data.habits.push({ id: L.newId(), name: name.slice(0, 40), emoji: $('habitEmoji').value.trim() || '✅' });
    saveData();
    $('habitName').value = '';
    $('habitEmoji').value = '✅';
    renderHabits();
  });

  $('habitEditToggle').addEventListener('click', () => { editingHabits = !editingHabits; renderHabits(); });

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
      `지금 저장된 것: 습관 ${data.habits.length}개 · 가계부 ${data.entries.length}건 · 일기 ${Object.keys(data.diary).length}편 (기록한 날 ${days.size}일)`;
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
    const summary = `습관 ${imported.habits.length}개, 가계부 ${imported.entries.length}건, 일기 ${Object.keys(imported.diary).length}편`;
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
    renderHeader();
    if (tab === 'habits') renderHabits();
    else if (tab === 'money') renderMoney();
    else if (tab === 'diary') renderDiary();
    else renderSettings();
  }

  $('prevDay').addEventListener('click', () => setDate(L.addDays(date, -1)));
  $('nextDay').addEventListener('click', () => { if (date < L.dateKey()) setDate(L.addDays(date, 1)); });
  $('todayButton').addEventListener('click', () => setDate(L.dateKey()));
  for (const b of tabButtons) b.addEventListener('click', () => setTab(b.dataset.tab));

  // 다른 탭(브라우저 창)에서 바꾼 내용을 반영합니다.
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) { data = loadData(); render(); }
  });

  try { const saved = localStorage.getItem(TAB_KEY); if (views[saved]) tab = saved; } catch { /* 무시 */ }
  renderEntryType();
  render();
})();
