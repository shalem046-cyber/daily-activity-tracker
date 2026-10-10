'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

const STORAGE_KEY = 'vitalflow-encrypted-vault-v1';
const LEGACY_STORAGE_KEY = 'vitalflow-diary-entries';

type VaultRecord = {
  version: 1;
  username: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

type VaultMeta = { username: string; salt: string };

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string) {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

async function deriveVaultKey(password: string, salt: string) {
  const material = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(salt), iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptDiary(entries: DiaryEntry[], key: CryptoKey, meta: VaultMeta): Promise<VaultRecord> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    version: 1,
    username: meta.username,
    salt: meta.salt,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptDiary(record: VaultRecord, key: CryptoKey): Promise<DiaryEntry[]> {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
  if (!Array.isArray(parsed)) throw new Error('Invalid diary data');
  return parsed as DiaryEntry[];
}

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
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [bootChecked, setBootChecked] = useState(false);
  const [vaultExists, setVaultExists] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const vaultMetaRef = useRef<VaultMeta | null>(null);

  useEffect(() => {
    setTodayKey(getDateKey(new Date()));
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as VaultRecord;
        if (parsed.version === 1 && parsed.username && parsed.salt && parsed.iv && parsed.ciphertext) {
          setVaultExists(true);
          setAuthUsername(parsed.username);
        }
      }
    } catch {
      setAuthError('The saved vault could not be read. Do not clear site data if you need its contents.');
    }
    setBootChecked(true);
  }, []);

  useEffect(() => {
    if (!isUnlocked || !vaultKeyRef.current || !vaultMetaRef.current) return;
    let cancelled = false;
    const persistEncrypted = async () => {
      try {
        const record = await encryptDiary(entries, vaultKeyRef.current as CryptoKey, vaultMetaRef.current as VaultMeta);
        if (cancelled) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        setSaveMessage('Saved and encrypted in this browser.');
      } catch {
        if (!cancelled) setSaveMessage('Could not save the encrypted diary. Check browser storage settings.');
      }
    };
    void persistEncrypted();
    return () => { cancelled = true; };
  }, [entries, isUnlocked]);

  const handleVaultAccess = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);

    try {
      if (!window.crypto?.subtle || !window.isSecureContext) {
        throw new Error('Secure encryption is unavailable. Open this site over HTTPS in a modern browser.');
      }

      const username = authUsername.trim().toLowerCase();
      if (username.length < 3) throw new Error('Choose a username with at least 3 characters.');
      if (authPassword.length < 8) throw new Error('Use a password with at least 8 characters.');

      if (!vaultExists) {
        if (authPassword !== authConfirmPassword) throw new Error('The passwords do not match.');

        const salt = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
        const meta: VaultMeta = { username, salt };
        const key = await deriveVaultKey(authPassword, salt);

        // Migrate older unencrypted entries into the encrypted vault, if any exist.
        let startingEntries: DiaryEntry[] = [];
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          try {
            const parsed: unknown = JSON.parse(legacy);
            if (Array.isArray(parsed)) startingEntries = parsed as DiaryEntry[];
          } catch {
            startingEntries = [];
          }
        }

        const record = await encryptDiary(startingEntries, key, meta);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        if (legacy !== null) window.localStorage.removeItem(LEGACY_STORAGE_KEY);

        vaultKeyRef.current = key;
        vaultMetaRef.current = meta;
        setEntries(startingEntries);
        setVaultExists(true);
        setIsUnlocked(true);
        setSaveMessage('Your private diary is ready. Entries are encrypted on this device.');
      } else {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (!saved) throw new Error('This browser has no saved vault. Do not clear site data.');
        const record = JSON.parse(saved) as VaultRecord;
        if (record.username !== username) throw new Error('Username or password is incorrect.');

        const key = await deriveVaultKey(authPassword, record.salt);
        let decryptedEntries: DiaryEntry[];
        try {
          decryptedEntries = await decryptDiary(record, key);
        } catch {
          throw new Error('Username or password is incorrect.');
        }

        vaultKeyRef.current = key;
        vaultMetaRef.current = { username: record.username, salt: record.salt };
        setEntries(decryptedEntries);
        setIsUnlocked(true);
        setSaveMessage('Diary unlocked.');
      }

      setAuthPassword('');
      setAuthConfirmPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to open the private diary.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLockVault = () => {
    vaultKeyRef.current = null;
    vaultMetaRef.current = null;
    setDraft('');
    setEntries([]);
    setIsUnlocked(false);
    setAuthPassword('');
    setAuthConfirmPassword('');
    setSaveMessage('');
    setAuthError('');
  };

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

  if (!bootChecked) {
    return (
      <main className="auth-shell">
        <div className="auth-orb auth-orb-one" aria-hidden="true" />
        <div className="auth-orb auth-orb-two" aria-hidden="true" />
        <section className="auth-card auth-card-loading">
          <div className="auth-logo">V</div>
          <p className="auth-kicker">VITALFLOW · PRIVATE JOURNAL</p>
          <h1>Preparing your diary.</h1>
          <p className="auth-description">Checking this browser for your encrypted vault…</p>
          <div className="loading-line" />
        </section>
      </main>
    );
  }

  if (!isUnlocked) {
    return (
      <main className="auth-shell">
        <div className="auth-orb auth-orb-one" aria-hidden="true" />
        <div className="auth-orb auth-orb-two" aria-hidden="true" />
        <div className="auth-orb auth-orb-three" aria-hidden="true" />
        <section className="auth-card">
          <div className="auth-logo">V</div>
          <p className="auth-kicker">VITALFLOW · PRIVATE JOURNAL</p>
          <h1>{vaultExists ? 'Welcome back.' : 'A quiet place, just for you.'}</h1>
          <p className="auth-description">
            {vaultExists
              ? 'Unlock your diary to revisit your days, thoughts, routines, and progress.'
              : 'Create your private diary. Your entries will be encrypted before they are saved in this browser.'}
          </p>

          <form className="auth-form" onSubmit={handleVaultAccess}>
            <label className="auth-label">
              Username
              <input
                className="auth-input"
                value={authUsername}
                onChange={(event) => { setAuthUsername(event.target.value); setAuthError(''); }}
                autoComplete="username"
                minLength={3}
                maxLength={40}
                required
                placeholder="Choose a username"
              />
            </label>
            <label className="auth-label">
              Password
              <input
                className="auth-input"
                type="password"
                value={authPassword}
                onChange={(event) => { setAuthPassword(event.target.value); setAuthError(''); }}
                autoComplete={vaultExists ? 'current-password' : 'new-password'}
                minLength={8}
                required
                placeholder="At least 8 characters"
              />
            </label>
            {!vaultExists ? (
              <label className="auth-label">
                Confirm password
                <input
                  className="auth-input"
                  type="password"
                  value={authConfirmPassword}
                  onChange={(event) => { setAuthConfirmPassword(event.target.value); setAuthError(''); }}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  placeholder="Type the password again"
                />
              </label>
            ) : null}
            <button className="auth-submit" type="submit" disabled={authBusy}>
              {authBusy ? 'Securing your diary…' : vaultExists ? 'Unlock private diary' : 'Create private diary'}
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          {authError ? <p className="auth-error" role="alert">{authError}</p> : null}

          <div className="auth-assurance">
            <span className="assurance-icon" aria-hidden="true">✦</span>
            <p><strong>Encrypted on your device</strong><br />Your diary text is encrypted with AES-GCM. Your password is not stored.</p>
          </div>
          <p className="auth-warning">
            This vault is specific to this browser. There is no password reset: forgetting your password or clearing this site’s storage can permanently lock you out.
          </p>
        </section>
        <p className="auth-footer">PERSONAL BY DESIGN <span>·</span> PRIVATE BY DEFAULT</p>
      </main>
    );
  }

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
          <div className="header-actions">
            <div className="header-date">
              <span className="date-dot" aria-hidden="true" />
              <span>{formatLongDate(todayKey)}</span>
            </div>
            <button className="lock-button" type="button" onClick={handleLockVault}>
              <span aria-hidden="true">⌑</span> Lock diary
            </button>
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
