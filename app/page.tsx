'use client';

import { useEffect, useMemo, useState } from 'react';

type DiaryEntry = {
  id: string;
  date: string;
  title: string;
  body: string;
  createdAt: string;
};

type InsightSet = {
  headline: string;
  summary: string;
  observations: string[];
};

const STORAGE_KEY = 'vitalflow-diary-entries';

function getDateKey(date: Date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function dateFromKey(key: string) {
  return new Date(key + 'T12:00:00');
}

function formatLongDate(key: string) {
  if (!key) return 'Preparing today’s page…';
  return dateFromKey(key).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatEntryDate(key: string) {
  return dateFromKey(key).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function countWords(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function makeTitle(body: string) {
  const firstLine = body.trim().split('\n')[0].replace(/\s+/g, ' ').trim();
  if (!firstLine) return 'Daily reflection';
  return firstLine.length > 58 ? firstLine.slice(0, 55) + '…' : firstLine;
}

function analyzeDiary(text: string): InsightSet {
  const value = text.trim();
  if (!value) {
    return {
      headline: 'Your page is ready',
      summary: 'Write naturally about how your day went. As you add details, this space will highlight patterns and practical next steps.',
      observations: [
        'Mention what you did, learned, enjoyed, or found difficult.',
        'You can include sleep, meals, water, exercise, study, hobbies, or mood in your own words.',
        'There is no perfect format. A few honest sentences are enough.',
      ],
    };
  }

  const observations: string[] = [];
  const sleepMatch = value.match(/\b(?:slept|sleep(?:ing)?)\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i)
    || value.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:of\s+)?sleep\b/i);

  const waterMatch = value.match(/\b(\d+(?:\.\d+)?)\s*(?:litres?|liters?|l)\s*(?:of\s+)?water\b/i)
    || value.match(/\bdrank\s+(\d+(?:\.\d+)?)\s*(?:litres?|liters?|l)\b/i);

  const movementMatch = value.match(/\b(\d+)\s*(?:minutes?|mins?)\s*(?:of\s+)?(?:walking|walk|exercise|workout|gym|running|run|cycling|training|movement)\b/i)
    || value.match(/\b(?:walked|ran|cycled|exercised|trained|worked out)\s+(?:for\s+)?(\d+)\s*(?:minutes?|mins?)\b/i)
    || value.match(/\b(?:gym|workout|exercise|walk|walking|run|running|cycle|cycling|training)\D{0,15}(\d+)\s*(?:minutes?|mins?)\b/i);

  if (sleepMatch) {
    const hours = Number(sleepMatch[1]);
    if (hours < 7) {
      observations.push('You recorded about ' + hours + ' hours of sleep. Consider making room for a calm wind-down and a consistent bedtime tonight.');
    } else {
      observations.push('You recorded about ' + hours + ' hours of sleep. Keep noticing how your rest affects your focus and energy the next day.');
    }
  } else if (/\b(sleep|slept|tired|rest|bedtime)\b/i.test(value)) {
    observations.push('You mentioned rest or sleep, but not a duration. Adding the approximate hours can help you notice your own patterns over time.');
  }

  if (waterMatch) {
    observations.push('Your entry mentions about ' + waterMatch[1] + ' litres of water. Keep recording it in the same way if you want to compare your routine across days.');
  } else if (/\b(water|hydration|drink|drank)\b/i.test(value)) {
    observations.push('You mentioned drinking water. A rough amount can make the diary more useful when you review your week.');
  }

  if (movementMatch) {
    observations.push('You recorded around ' + movementMatch[1] + ' minutes of movement. Note how it felt, not just how long it lasted.');
  } else if (/\b(gym|workout|exercise|walk|walking|ran|running|cycling|sport|badminton|volleyball|training)\b/i.test(value)) {
    observations.push('Movement or sport showed up in your entry. You could note the activity and approximate duration to make future comparisons clearer.');
  }

  if (/\b(studied|study|studying|homework|assignment|exam|learned|learning|practised|practiced|practice|coding|piano|music|reading)\b/i.test(value)) {
    observations.push('You made space for learning or a skill. Write down one thing you understood or improved, so the entry captures progress as well as time spent.');
  }

  if (/\b(stressed|stressful|overwhelmed|tired|anxious|worried|upset|low|difficult|hard day)\b/i.test(value)) {
    observations.push('Your entry describes a difficult or tiring moment. Keep tomorrow’s plan realistic, take a pause when you can, and speak with someone you trust if you need support.');
  } else if (/\b(happy|proud|grateful|enjoyed|fun|confident|good day|progress|success)\b/i.test(value)) {
    observations.push('You recorded a positive moment. Notice what helped make it happen; that may be worth repeating.');
  }

  if (observations.length === 0) {
    observations.push('Your entry is saved as a record of the day. Add a little detail about what went well or what felt difficult to get more useful reflections.');
  }

  if (countWords(value) >= 45) {
    observations.push('You captured a detailed entry. When you review it later, look for patterns rather than judging one day in isolation.');
  }

  return {
    headline: 'A reflection on your day',
    summary: 'These notes are based on the words and quantities in your diary entry. They are practical prompts, not a medical assessment.',
    observations: observations.slice(0, 4),
  };
}

export default function Home() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [todayKey, setTodayKey] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    setTodayKey(getDateKey(new Date()));
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setEntries(parsed);
      }
    } catch {
      setEntries([]);
    }
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      setSaveMessage('Your browser could not save the diary. Check its storage settings.');
    }
  }, [entries, isReady]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [entries],
  );

  const todayEntries = useMemo(
    () => entries.filter((entry) => entry.date === todayKey),
    [entries, todayKey],
  );

  const todayText = todayEntries.map((entry) => entry.title + '\n' + entry.body).join('\n\n');
  const liveText = [todayText, draft].filter(Boolean).join('\n\n');
  const todayWordCount = countWords(liveText);
  const reflection = useMemo(() => analyzeDiary(liveText), [liveText]);

  const weekDays = useMemo(() => {
    if (!todayKey) return [];
    const today = dateFromKey(todayKey);
    const days: { key: string; label: string; dateLabel: string; count: number }[] = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      const key = getDateKey(day);
      days.push({
        key,
        label: day.toLocaleDateString('en-IN', { weekday: 'short' }),
        dateLabel: day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        count: entries.filter((entry) => entry.date === key).length,
      });
    }
    return days;
  }, [entries, todayKey]);

  const recordedDays = weekDays.filter((day) => day.count > 0).length;
  const maxDayCount = Math.max(1, ...weekDays.map((day) => day.count));

  const writingStreak = useMemo(() => {
    if (!todayKey) return 0;
    const recorded = new Set(entries.map((entry) => entry.date));
    const cursor = dateFromKey(todayKey);
    if (!recorded.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (recorded.has(getDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [entries, todayKey]);

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !todayKey) return;

    const entry: DiaryEntry = {
      id: String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000)),
      date: todayKey,
      title: makeTitle(body),
      body,
      createdAt: new Date().toISOString(),
    };

    setEntries((current) => [entry, ...current]);
    setDraft('');
    setSaveMessage('Saved to your diary on this device.');
  };

  const handleDelete = (id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setSaveMessage('Diary entry deleted.');
  };

  const addPrompt = (prompt: string) => {
    setDraft((current) => current.trim() ? current.trimEnd() + '\n\n' + prompt : prompt);
    setSaveMessage('');
  };

  return (
    <main className="page-shell">
      <div className="container">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">V</div>
            <div>
              <p className="eyebrow">VITALFLOW · PERSONAL JOURNAL</p>
              <p className="brand-name">Daily Diary</p>
            </div>
          </div>
          <div className="header-date">
            <span className="date-dot" aria-hidden="true" />
            <span>{formatLongDate(todayKey)}</span>
          </div>
        </header>

        <section className="welcome-row">
          <div>
            <p className="section-kicker">YOUR SPACE, YOUR PACE</p>
            <h1>Make sense of your day.</h1>
            <p className="welcome-copy">Write what happened in your own words. Your diary will help you notice routines, small wins, and things to improve.</p>
          </div>
          <div className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">✦</span>
            <span><strong>Your pages stay on this device</strong><small>No account required</small></span>
          </div>
        </section>

        <section className="stats-grid" aria-label="Diary overview">
          <article className="stat-card">
            <span className="stat-label">Writing streak</span>
            <div className="stat-value">{writingStreak}<span className="stat-unit"> {writingStreak === 1 ? 'day' : 'days'}</span></div>
            <p>Consecutive days with an entry</p>
          </article>
          <article className="stat-card">
            <span className="stat-label">This week</span>
            <div className="stat-value">{recordedDays}<span className="stat-unit"> / 7 days</span></div>
            <p>Days you have written something</p>
          </article>
          <article className="stat-card">
            <span className="stat-label">Today’s words</span>
            <div className="stat-value">{todayWordCount}</div>
            <p>Saved notes plus your current draft</p>
          </article>
        </section>

        <section className="dashboard-grid">
          <div className="main-column">
            <article className="panel editor-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">TODAY’S PAGE</p>
                  <h2>Dear diary,</h2>
                </div>
                <span className="date-stamp">{todayKey ? dateFromKey(todayKey).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</span>
              </div>

              <p className="editor-guidance">No categories or long forms. Just write naturally about your day — what you did, how you felt, what you learned, or what you want to remember.</p>

              <form onSubmit={handleSave}>
                <label className="sr-only" htmlFor="diary-entry">Write your daily diary entry</label>
                <textarea
                  id="diary-entry"
                  className="diary-textarea"
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setSaveMessage(''); }}
                  placeholder={'Today I woke up at…\n\nI spent time on…\n\nOne thing I learned or want to improve is…'}
                  rows={10}
                  required
                />

                <div className="writing-prompts" aria-label="Writing prompts">
                  <span>Need a starting point?</span>
                  <button type="button" className="prompt-chip" onClick={() => addPrompt('A moment worth remembering: ')}>A moment to remember</button>
                  <button type="button" className="prompt-chip" onClick={() => addPrompt('Something I learned: ')}>Something I learned</button>
                  <button type="button" className="prompt-chip" onClick={() => addPrompt('Tomorrow, I want to: ')}>Tomorrow’s intention</button>
                </div>

                <div className="editor-footer">
                  <span className="word-count">{countWords(draft)} words in this entry</span>
                  <button className="save-button" type="submit" disabled={!draft.trim() || !todayKey}>
                    Save diary entry <span aria-hidden="true">↗</span>
                  </button>
                </div>
                {saveMessage ? <p className="save-message" role="status">{saveMessage}</p> : null}
              </form>
            </article>

            <article className="panel history-panel">
              <div className="panel-heading history-heading">
                <div>
                  <p className="section-kicker">YOUR JOURNAL</p>
                  <h2>Recent pages</h2>
                </div>
                <span className="entry-count">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
              </div>

              {sortedEntries.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-mark" aria-hidden="true">✎</div>
                  <strong>Your story starts here.</strong>
                  <p>Save your first entry and it will appear here, ready for you to revisit.</p>
                </div>
              ) : (
                <div className="entry-list">
                  {sortedEntries.map((entry) => (
                    <article className="entry-item" key={entry.id}>
                      <div className="entry-date">{formatEntryDate(entry.date)}</div>
                      <div className="entry-content">
                        <h3>{entry.title}</h3>
                        <p>{entry.body}</p>
                        <span className="entry-meta">{countWords(entry.body)} words · {new Date(entry.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <button className="delete-button" type="button" onClick={() => handleDelete(entry.id)} aria-label={'Delete diary entry: ' + entry.title}>Delete</button>
                    </article>
                  ))}
                </div>
              )}
            </article>
          </div>

          <aside className="side-column">
            <article className="panel reflection-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">PERSONAL REFLECTION</p>
                  <h2>{reflection.headline}</h2>
                </div>
                <span className="reflection-symbol" aria-hidden="true">✦</span>
              </div>
              <p className="reflection-summary">{reflection.summary}</p>
              <ul className="insight-list">
                {reflection.observations.map((observation, index) => (
                  <li key={observation}>
                    <span className="insight-number">0{index + 1}</span>
                    <p>{observation}</p>
                  </li>
                ))}
              </ul>
              <p className="insight-footnote">Insights update as you write. They use simple on-device text patterns, not an AI or medical assessment.</p>
            </article>

            <article className="panel rhythm-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">YOUR CONSISTENCY</p>
                  <h2>Weekly rhythm</h2>
                </div>
                <span className="chart-caption">Entries per day</span>
              </div>
              <div className="week-chart" aria-label="Diary entries over the last seven days">
                {weekDays.map((day) => (
                  <div className="week-day" key={day.key} title={day.dateLabel + ': ' + day.count + ' entries'}>
                    <span className="bar-number">{day.count || ''}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ height: (day.count === 0 ? 5 : Math.max(18, (day.count / maxDayCount) * 100)) + '%' }} />
                    </div>
                    <span className="bar-label">{day.label}</span>
                  </div>
                ))}
              </div>
              <div className="chart-legend">
                <span className="legend-dot" aria-hidden="true" />
                <span>{recordedDays} of 7 days recorded this week</span>
              </div>
            </article>

            <div className="gentle-reminder">
              <span aria-hidden="true">“</span>
              <p>You don’t need a perfect day to write a meaningful page.</p>
            </div>
          </aside>
        </section>

        <footer className="page-footer">
          <span>VITALFLOW · DAILY DIARY</span>
          <span>Your data is stored locally in this browser. It does not sync between devices.</span>
        </footer>
      </div>
    </main>
  );
}
