'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '@/lib/supabase';

type DiaryEntry = {
  id: string;
  date: string;
  title: string;
  body: string;
  createdAt: string;
};

type GweenProfile = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  created_at: string;
};

type LocalVaultRecord = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
};

type AdminUsageRow = {
  user_id: string;
  started_at: string;
  last_seen_at: string;
  active_seconds: number;
  is_active: boolean;
};

type AdminMemberSummary = GweenProfile & {
  total_seconds: number;
  last_seen_at: string | null;
  active_now: boolean;
};

type AuthMode = 'signin' | 'signup';
type AppTab = 'diary' | 'profile' | 'admin';

const LOCAL_VAULT_PREFIX = 'gween-private-diary-v1:';
const LEGACY_VAULT_KEY = 'vitalflow-encrypted-vault-v1';
const AVATAR_COLORS = ['#225c47', '#497da1', '#8567a8', '#ba8050', '#bd6873', '#4d8b82'];

function getDateKey(date: Date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function dateFromKey(key: string) {
  return new Date(key + 'T12:00:00');
}

function formatLongDate(key: string) {
  if (!key) return 'Today';
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(start, Math.min(start + 0x8000, bytes.length))),
    );
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string) {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

async function deriveDiaryKey(password: string, salt: string) {
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

async function encryptEntries(entries: DiaryEntry[], key: CryptoKey, salt: string): Promise<LocalVaultRecord> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    version: 1,
    salt,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptEntries(record: LocalVaultRecord, key: CryptoKey): Promise<DiaryEntry[]> {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
  if (!Array.isArray(parsed)) throw new Error('Invalid diary data');
  return parsed as DiaryEntry[];
}

function vaultStorageKey(userId: string) {
  return LOCAL_VAULT_PREFIX + userId;
}

async function loadOrCreateLocalVault(userId: string, username: string, password: string) {
  const storageKey = vaultStorageKey(userId);
  const saved = window.localStorage.getItem(storageKey);

  if (saved) {
    const record = JSON.parse(saved) as LocalVaultRecord;
    const key = await deriveDiaryKey(password, record.salt);
    try {
      const entries = await decryptEntries(record, key);
      return { entries, key, salt: record.salt };
    } catch {
      throw new Error(
        'Your GWEEN account signed in, but this browser’s encrypted diary could not be unlocked with that password. If you changed your account password, the older encrypted notes still require the previous password.',
      );
    }
  }

  // Migrate the single-account encrypted diary created by the earlier version, when its username matches.
  const legacyRaw = window.localStorage.getItem(LEGACY_VAULT_KEY);
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw) as LocalVaultRecord & { username?: string };
      if (legacy.username && legacy.username.toLowerCase() === username.toLowerCase()) {
        const legacyKey = await deriveDiaryKey(password, legacy.salt);
        const oldEntries = await decryptEntries(legacy, legacyKey);
        const salt = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
        const key = await deriveDiaryKey(password, salt);
        const migrated = await encryptEntries(oldEntries, key, salt);
        window.localStorage.setItem(storageKey, JSON.stringify(migrated));
        window.localStorage.removeItem(LEGACY_VAULT_KEY);
        return { entries: oldEntries, key, salt };
      }
    } catch {
      // Keep any legacy record untouched if it cannot safely be migrated.
    }
  }

  const salt = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveDiaryKey(password, salt);
  const emptyVault = await encryptEntries([], key, salt);
  window.localStorage.setItem(storageKey, JSON.stringify(emptyVault));
  return { entries: [] as DiaryEntry[], key, salt };
}

function analyzeDiary(text: string) {
  const value = text.trim();
  if (!value) {
    return {
      headline: 'Your page is ready',
      summary: 'Write naturally about your day. GWEEN will help you notice patterns in what you record.',
      observations: [
        'Write about what you did, learned, enjoyed, or found difficult.',
        'Mention sleep, meals, water, exercise, study, hobbies, or mood in your own words.',
        'A few honest sentences are enough. There is no perfect format.',
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
    observations.push(hours < 7
      ? 'You recorded about ' + hours + ' hours of sleep. Consider making room for a calm wind-down and a consistent bedtime tonight.'
      : 'You recorded about ' + hours + ' hours of sleep. Notice how rest affects your focus and energy tomorrow.');
  } else if (/\b(sleep|slept|tired|rest|bedtime)\b/i.test(value)) {
    observations.push('You mentioned rest or sleep. Adding the approximate hours can help you notice your patterns over time.');
  }

  if (waterMatch) {
    observations.push('Your entry mentions about ' + waterMatch[1] + ' litres of water. Recording it consistently makes weekly comparisons easier.');
  } else if (/\b(water|hydration|drink|drank)\b/i.test(value)) {
    observations.push('You mentioned drinking water. A rough amount can make your diary more useful when you review the week.');
  }

  if (movementMatch) {
    observations.push('You recorded around ' + movementMatch[1] + ' minutes of movement. Note how it felt, not just how long it lasted.');
  } else if (/\b(gym|workout|exercise|walk|walking|ran|running|cycling|sport|badminton|volleyball|training)\b/i.test(value)) {
    observations.push('Movement or sport showed up in your entry. You could note the activity and duration for clearer comparisons.');
  }

  if (/\b(studied|study|studying|homework|assignment|exam|learned|learning|practised|practiced|practice|coding|piano|music|reading)\b/i.test(value)) {
    observations.push('You made space for learning or a skill. Capture one thing you understood or improved, not just the time spent.');
  }
  if (/\b(stressed|stressful|overwhelmed|tired|anxious|worried|upset|low|difficult|hard day)\b/i.test(value)) {
    observations.push('Your entry describes a difficult or tiring moment. Keep tomorrow’s plan realistic, and talk with someone you trust if you need support.');
  } else if (/\b(happy|proud|grateful|enjoyed|fun|confident|good day|progress|success)\b/i.test(value)) {
    observations.push('You recorded a positive moment. Notice what helped make it happen; that may be worth repeating.');
  }

  if (observations.length === 0) {
    observations.push('Your entry is saved as a record of the day. Add what went well or what felt difficult to get a more useful reflection.');
  }
  if (countWords(value) >= 45) {
    observations.push('You captured a detailed entry. Look for patterns over time rather than judging one day in isolation.');
  }

  return {
    headline: 'A reflection on your day',
    summary: 'These prompts use simple patterns in your entry. They are not medical advice or an AI assessment.',
    observations: observations.slice(0, 4),
  };
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return hours + 'h ' + remainingMinutes + 'm';
  return remainingMinutes + 'm';
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('') || 'G';
}

export default function Home() {
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [activeTab, setActiveTab] = useState<AppTab>('diary');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupColor, setSignupColor] = useState(AVATAR_COLORS[0]);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<GweenProfile | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [todayKey, setTodayKey] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileUsernameDraft, setProfileUsernameDraft] = useState('');
  const [profileColorDraft, setProfileColorDraft] = useState(AVATAR_COLORS[0]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [adminMembers, setAdminMembers] = useState<AdminMemberSummary[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState('');
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const vaultSaltRef = useRef<string | null>(null);

  useEffect(() => {
    setTodayKey(getDateKey(new Date()));
  }, []);

  const todayEntries = useMemo(
    () => entries.filter((entry) => entry.date === todayKey),
    [entries, todayKey],
  );
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [entries],
  );
  const todayText = todayEntries.map((entry) => entry.title + '\n' + entry.body).join('\n\n');
  const liveText = [todayText, draft].filter(Boolean).join('\n\n');
  const reflection = useMemo(() => analyzeDiary(liveText), [liveText]);
  const todayWordCount = countWords(liveText);

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

  const finishSignIn = async (user: User, password: string) => {
    if (!supabase) throw new Error('GWEEN authentication is not configured yet.');

    const { data: profileData, error: profileFetchError } = await supabase
      .from('gween_profiles')
      .select('user_id, username, display_name, avatar_color, created_at')
      .eq('user_id', user.id)
      .single();

    if (profileFetchError || !profileData) {
      throw new Error('Your profile could not be loaded. The GWEEN database schema may not have been installed yet.');
    }

    const result = await loadOrCreateLocalVault(user.id, profileData.username, password);
    vaultKeyRef.current = result.key;
    vaultSaltRef.current = result.salt;
    setEntries(result.entries);
    setAuthUser(user);
    setProfile(profileData as GweenProfile);
    setProfileNameDraft(profileData.display_name);
    setProfileUsernameDraft(profileData.username);
    setProfileColorDraft(profileData.avatar_color);
    setIsUnlocked(true);
    setAuthError('');
    setAuthMessage('');
    setSaveMessage('Your private diary is unlocked on this device.');

    const { data: adminResult, error: adminCheckError } = await supabase.rpc('is_gween_admin');
    setIsAdmin(!adminCheckError && adminResult === true);
    setActiveTab('diary');
    setAuthPassword('');
  };

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');

    if (!supabase || !supabaseConfigured) {
      setAuthError('GWEEN’s shared account service is not configured. Follow the setup guide in the GitHub repository.');
      setAuthBusy(false);
      return;
    }

    try {
      if (!window.crypto?.subtle || !window.isSecureContext) {
        throw new Error('Secure diary encryption is unavailable. Open GWEEN over HTTPS in a modern browser.');
      }
      if (authMode === 'signup') {
        const displayName = signupName.trim();
        const username = signupUsername.trim().toLowerCase();
        if (displayName.length < 2 || displayName.length > 40) {
          throw new Error('Display name must be between 2 and 40 characters.');
        }
        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
          throw new Error('Username must be 3–20 characters using letters, numbers, or underscores.');
        }
        if (authPassword.length < 8) throw new Error('Use a password with at least 8 characters.');

        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: {
              username,
              display_name: displayName,
              avatar_color: signupColor,
            },
          },
        });
        if (error) {
          if (/duplicate key|already exists|unique constraint/i.test(error.message)) {
            throw new Error('That username may already be taken. Choose another username and try again.');
          }
          throw error;
        }

        if (data.session && data.user) {
          await finishSignIn(data.user, authPassword);
        } else {
          setAuthMessage('Account created. Check your email to confirm it, then sign in to open your private diary.');
          setAuthMode('signin');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw new Error('Email or password is incorrect, or the email has not been confirmed.');
        if (!data.user) throw new Error('Your account could not be opened.');
        await finishSignIn(data.user, authPassword);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (supabase) await supabase.auth.signOut();
    vaultKeyRef.current = null;
    vaultSaltRef.current = null;
    setAuthUser(null);
    setProfile(null);
    setIsAdmin(false);
    setIsUnlocked(false);
    setEntries([]);
    setDraft('');
    setActiveTab('diary');
    setAuthPassword('');
    setAuthError('');
    setAuthMessage('');
    setSaveMessage('');
  };

  const handleSaveEntry = (event: React.FormEvent<HTMLFormElement>) => {
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
    setSaveMessage('Entry saved. GWEEN encrypts it before storing it in this browser.');
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setSaveMessage('Diary entry deleted.');
  };

  const addPrompt = (prompt: string) => {
    setDraft((current) => current.trim() ? current.trimEnd() + '\n\n' + prompt : prompt);
    setSaveMessage('');
  };

  useEffect(() => {
    if (!isUnlocked || !authUser || !supabase) return;

    const client = supabase;
    let sessionId: string | null = null;
    let activeSeconds = 0;
    let lastTick = Date.now();
    let alive = true;

    const updateSession = async (active: boolean) => {
      if (!sessionId) return;
      const now = Date.now();
      if (document.visibilityState === 'visible') {
        activeSeconds += Math.min(30, Math.max(0, (now - lastTick) / 1000));
      }
      lastTick = now;
      await client
        .from('gween_usage_sessions')
        .update({
          last_seen_at: new Date(now).toISOString(),
          active_seconds: Math.floor(activeSeconds),
          is_active: active,
        })
        .eq('id', sessionId);
    };

    const startSession = async () => {
      const { data, error } = await client
        .from('gween_usage_sessions')
        .insert({ user_id: authUser.id, is_active: document.visibilityState === 'visible' })
        .select('id')
        .single();
      if (error || !data) return;
      sessionId = data.id as string;
      if (!alive) await updateSession(false);
    };

    const interval = window.setInterval(() => {
      void updateSession(document.visibilityState === 'visible');
    }, 15000);

    const handleVisibility = () => {
      lastTick = Date.now();
      void updateSession(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleVisibility);
    void startSession();

    return () => {
      alive = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleVisibility);
      void updateSession(false);
    };
  }, [isUnlocked, authUser?.id]);

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !authUser || !profile) return;
    setProfileBusy(true);
    setProfileMessage('');
    try {
      const username = profileUsernameDraft.trim().toLowerCase();
      const displayName = profileNameDraft.trim();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        throw new Error('Username must be 3–20 characters using letters, numbers, or underscores.');
      }
      if (displayName.length < 2 || displayName.length > 40) {
        throw new Error('Display name must be between 2 and 40 characters.');
      }
      const { data, error } = await supabase
        .from('gween_profiles')
        .update({ username, display_name: displayName, avatar_color: profileColorDraft })
        .eq('user_id', authUser.id)
        .select('user_id, username, display_name, avatar_color, created_at')
        .single();
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) {
          throw new Error('That username is already taken. Try a different one.');
        }
        throw error;
      }
      setProfile(data as GweenProfile);
      setProfileNameDraft(data.display_name);
      setProfileUsernameDraft(data.username);
      setProfileColorDraft(data.avatar_color);
      setProfileMessage('Profile updated successfully.');
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Could not update profile.');
    } finally {
      setProfileBusy(false);
    }
  };

  const loadAdminMembers = async () => {
    if (!supabase || !isAdmin) return;
    setAdminBusy(true);
    setAdminError('');
    try {
      const [profilesResult, usageResult] = await Promise.all([
        supabase
          .from('gween_profiles')
          .select('user_id, username, display_name, avatar_color, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('gween_usage_sessions')
          .select('user_id, started_at, last_seen_at, active_seconds, is_active'),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (usageResult.error) throw usageResult.error;

      const usageByUser = new Map<string, { total: number; lastSeen: string | null; active: boolean }>();
      const now = Date.now();
      (usageResult.data as AdminUsageRow[]).forEach((row) => {
        const existing = usageByUser.get(row.user_id) || { total: 0, lastSeen: null, active: false };
        const lastSeenTime = new Date(row.last_seen_at).getTime();
        existing.total += Math.max(0, Number(row.active_seconds) || 0);
        if (!existing.lastSeen || lastSeenTime > new Date(existing.lastSeen).getTime()) existing.lastSeen = row.last_seen_at;
        if (row.is_active && now - lastSeenTime < 90000) existing.active = true;
        usageByUser.set(row.user_id, existing);
      });

      const summaries = (profilesResult.data as GweenProfile[]).map((member) => {
        const usage = usageByUser.get(member.user_id);
        return {
          ...member,
          total_seconds: usage?.total || 0,
          last_seen_at: usage?.lastSeen || null,
          active_now: usage?.active || false,
        };
      });
      setAdminMembers(summaries);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Could not load admin information.');
    } finally {
      setAdminBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'admin' && isAdmin) void loadAdminMembers();
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isUnlocked || !authUser || !vaultKeyRef.current || !vaultSaltRef.current) return;
    let cancelled = false;
    const persist = async () => {
      try {
        const record = await encryptEntries(entries, vaultKeyRef.current as CryptoKey, vaultSaltRef.current as string);
        if (cancelled) return;
        window.localStorage.setItem(vaultStorageKey(authUser.id), JSON.stringify(record));
      } catch {
        if (!cancelled) setSaveMessage('Could not save your encrypted diary. Check this browser’s storage settings.');
      }
    };
    void persist();
    return () => { cancelled = true; };
  }, [entries, isUnlocked, authUser?.id]);

  if (!supabaseConfigured) {
    return (
      <main className="auth-shell">
        <div className="auth-orb auth-orb-one" aria-hidden="true" />
        <div className="auth-orb auth-orb-two" aria-hidden="true" />
        <section className="auth-card">
          <div className="gween-logo">g<span>✦</span></div>
          <p className="auth-kicker">GWEEN · PRIVATE DAILY JOURNAL</p>
          <h1>One last setup step.</h1>
          <p className="auth-description">Profiles and the admin dashboard need a shared database. The GWEEN code is ready, but this GitHub Pages build still needs your Supabase project URL and publishable key.</p>
          <div className="setup-steps">
            <p><strong>1.</strong> Create a free Supabase project.</p>
            <p><strong>2.</strong> Run <code>supabase/schema.sql</code> in its SQL Editor.</p>
            <p><strong>3.</strong> Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> as GitHub Actions repository variables or in the `github-pages` environment, then redeploy.</p>
          </div>
          <a className="auth-submit setup-link" href="https://github.com/shalem046-cyber/writeyourdiary/blob/main/SUPABASE_SETUP.md" target="_blank" rel="noreferrer">Open setup guide <span aria-hidden="true">↗</span></a>
          <p className="auth-warning">Never add a Supabase service-role key to this website. Only the public publishable key belongs in the browser; database security depends on the included row-level security policies.</p>
        </section>
      </main>
    );
  }

  if (!isUnlocked || !authUser || !profile) {
    return (
      <main className="auth-shell">
        <div className="auth-orb auth-orb-one" aria-hidden="true" />
        <div className="auth-orb auth-orb-two" aria-hidden="true" />
        <div className="auth-orb auth-orb-three" aria-hidden="true" />
        <section className="auth-card">
          <div className="gween-logo">g<span>✦</span></div>
          <p className="auth-kicker">GWEEN · PRIVATE DAILY JOURNAL</p>
          <h1>{authMode === 'signup' ? 'Make it yours.' : 'Welcome to your space.'}</h1>
          <p className="auth-description">
            {authMode === 'signup'
              ? 'Create a profile with your own display name and username. Your diary is encrypted locally and stays separate from the admin usage view.'
              : 'Sign in to your profile and unlock your private diary.'}
          </p>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === 'signup' ? (
              <>
                <label className="auth-label">
                  Display name
                  <input className="auth-input" value={signupName} onChange={(event) => setSignupName(event.target.value)} autoComplete="name" maxLength={40} required placeholder="The name people see" />
                </label>
                <label className="auth-label">
                  Username
                  <span className="input-help">3–20 letters, numbers, or underscores</span>
                  <input className="auth-input" value={signupUsername} onChange={(event) => setSignupUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} autoComplete="username" minLength={3} maxLength={20} required placeholder="your_username" />
                </label>
                <div className="avatar-picker-row">
                  <span>Choose your profile colour</span>
                  <div className="avatar-swatches">
                    {AVATAR_COLORS.map((color) => (
                      <button key={color} className={'avatar-swatch' + (signupColor === color ? ' selected' : '')} type="button" style={{ background: color }} onClick={() => setSignupColor(color)} aria-label={'Select profile colour ' + color} aria-pressed={signupColor === color} />
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            <label className="auth-label">
              Email
              <input className="auth-input" type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />
            </label>
            <label className="auth-label">
              Password
              <input className="auth-input" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required placeholder="At least 8 characters" />
            </label>
            <button className="auth-submit" type="submit" disabled={authBusy}>
              {authBusy ? 'Securing your space…' : authMode === 'signup' ? 'Create profile' : 'Sign in & unlock'}
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          {authError ? <p className="auth-error" role="alert">{authError}</p> : null}
          {authMessage ? <p className="auth-message" role="status">{authMessage}</p> : null}

          <p className="auth-switch">
            {authMode === 'signup' ? 'Already have a profile?' : 'New to GWEEN?'}
            {' '}
            <button type="button" onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setAuthError(''); setAuthMessage(''); }}>
              {authMode === 'signup' ? 'Sign in' : 'Create an account'}
            </button>
          </p>

          <div className="auth-assurance">
            <span className="assurance-icon" aria-hidden="true">✦</span>
            <p><strong>Your diary stays private</strong><br />Diary text is AES-GCM encrypted on this device. Admins can see usernames and usage time only—not diary entries.</p>
          </div>
          <p className="auth-warning">Diary notes are tied to this browser and the password used to encrypt them. They do not sync to other devices and cannot be recovered if the encryption password is lost.</p>
        </section>
        <p className="auth-footer">YOUR PROFILE <span>·</span> YOUR PAGES <span>·</span> YOUR PACE</p>
      </main>
    );
  }

  const navButton = (tab: AppTab, label: string) => (
    <button className={'nav-tab' + (activeTab === tab ? ' active' : '')} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined}>
      {label}
    </button>
  );

  return (
    <main className="page-shell gween-app">
      <div className="container">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark gween-mark">g<span>✦</span></div>
            <div>
              <p className="eyebrow">YOUR PRIVATE SPACE</p>
              <p className="brand-name">gween</p>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-date">
              <span className="date-dot" aria-hidden="true" />
              <span>{formatLongDate(todayKey)}</span>
            </div>
            <button className="lock-button" type="button" onClick={() => void handleSignOut()}>
              <span aria-hidden="true">↗</span> Sign out & lock
            </button>
          </div>
        </header>

        <section className="profile-banner">
          <div className="profile-avatar" style={{ background: profile.avatar_color }} aria-hidden="true">{initials(profile.display_name)}</div>
          <div className="profile-banner-copy">
            <p className="section-kicker">YOUR DAY, IN YOUR WORDS</p>
            <h1>Good to see you, {profile.display_name.split(' ')[0]}.</h1>
            <p>@{profile.username} <span>·</span> {formatLongDate(todayKey)}</p>
          </div>
          <div className="profile-banner-mark" aria-hidden="true">✦</div>
        </section>

        <nav className="app-navigation" aria-label="Main navigation">
          {navButton('diary', 'My diary')}
          {navButton('profile', 'My profile')}
          {isAdmin ? navButton('admin', 'Admin dashboard') : null}
        </nav>

        {activeTab === 'diary' ? (
          <>
            <section className="stats-grid" aria-label="Diary overview">
              <article className="stat-card"><span className="stat-label">Writing streak</span><div className="stat-value">{writingStreak}<span className="stat-unit"> {writingStreak === 1 ? 'day' : 'days'}</span></div><p>Consecutive days with an entry</p></article>
              <article className="stat-card"><span className="stat-label">This week</span><div className="stat-value">{recordedDays}<span className="stat-unit"> / 7 days</span></div><p>Days you have written something</p></article>
              <article className="stat-card"><span className="stat-label">Today’s words</span><div className="stat-value">{todayWordCount}</div><p>Saved notes plus your current draft</p></article>
            </section>

            <section className="dashboard-grid">
              <div className="main-column">
                <article className="panel editor-panel">
                  <div className="panel-heading">
                    <div><p className="section-kicker">TODAY’S PAGE</p><h2>Dear diary,</h2></div>
                    <span className="date-stamp">{todayKey ? dateFromKey(todayKey).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</span>
                  </div>
                  <p className="editor-guidance">No categories or long forms. Write naturally about what happened, how you felt, what you learned, or what you want to remember.</p>
                  <form onSubmit={handleSaveEntry}>
                    <label className="sr-only" htmlFor="diary-entry">Write your daily diary entry</label>
                    <textarea id="diary-entry" className="diary-textarea" value={draft} onChange={(event) => { setDraft(event.target.value); setSaveMessage(''); }} placeholder={'Today I woke up at…\n\nI spent time on…\n\nOne thing I learned or want to improve is…'} rows={10} required />
                    <div className="writing-prompts" aria-label="Writing prompts">
                      <span>Need a starting point?</span>
                      <button type="button" className="prompt-chip" onClick={() => addPrompt('A moment worth remembering: ')}>A moment to remember</button>
                      <button type="button" className="prompt-chip" onClick={() => addPrompt('Something I learned: ')}>Something I learned</button>
                      <button type="button" className="prompt-chip" onClick={() => addPrompt('Tomorrow, I want to: ')}>Tomorrow’s intention</button>
                    </div>
                    <div className="editor-footer"><span className="word-count">{countWords(draft)} words in this entry</span><button className="save-button" type="submit" disabled={!draft.trim()}>Save diary entry <span aria-hidden="true">↗</span></button></div>
                    {saveMessage ? <p className="save-message" role="status">{saveMessage}</p> : null}
                  </form>
                </article>

                <article className="panel history-panel">
                  <div className="panel-heading history-heading"><div><p className="section-kicker">YOUR JOURNAL</p><h2>Recent pages</h2></div><span className="entry-count">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span></div>
                  {sortedEntries.length === 0 ? (
                    <div className="empty-state"><div className="empty-mark" aria-hidden="true">✎</div><strong>Your story starts here.</strong><p>Save your first entry and it will appear here, ready for you to revisit.</p></div>
                  ) : (
                    <div className="entry-list">
                      {sortedEntries.map((entry) => (
                        <article className="entry-item" key={entry.id}>
                          <div className="entry-date">{formatEntryDate(entry.date)}</div>
                          <div className="entry-content"><h3>{entry.title}</h3><p>{entry.body}</p><span className="entry-meta">{countWords(entry.body)} words · {new Date(entry.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></div>
                          <button className="delete-button" type="button" onClick={() => handleDeleteEntry(entry.id)} aria-label={'Delete diary entry: ' + entry.title}>Delete</button>
                        </article>
                      ))}
                    </div>
                  )}
                </article>
              </div>

              <aside className="side-column">
                <article className="panel reflection-panel">
                  <div className="panel-heading"><div><p className="section-kicker">PERSONAL REFLECTION</p><h2>{reflection.headline}</h2></div><span className="reflection-symbol" aria-hidden="true">✦</span></div>
                  <p className="reflection-summary">{reflection.summary}</p>
                  <ul className="insight-list">{reflection.observations.map((observation, index) => <li key={observation}><span className="insight-number">0{index + 1}</span><p>{observation}</p></li>)}</ul>
                  <p className="insight-footnote">Diary analysis happens in this browser. Your diary text is not sent to the admin dashboard.</p>
                </article>

                <article className="panel rhythm-panel">
                  <div className="panel-heading"><div><p className="section-kicker">YOUR CONSISTENCY</p><h2>Weekly rhythm</h2></div><span className="chart-caption">Entries per day</span></div>
                  <div className="week-chart" aria-label="Diary entries over the last seven days">
                    {weekDays.map((day) => <div className="week-day" key={day.key} title={day.dateLabel + ': ' + day.count + ' entries'}><span className="bar-number">{day.count || ''}</span><div className="bar-track"><div className="bar-fill" style={{ height: (day.count === 0 ? 5 : Math.max(18, (day.count / maxDayCount) * 100)) + '%' }} /></div><span className="bar-label">{day.label}</span></div>)}
                  </div>
                  <div className="chart-legend"><span className="legend-dot" aria-hidden="true" /><span>{recordedDays} of 7 days recorded this week</span></div>
                </article>
                <div className="gentle-reminder"><span aria-hidden="true">“</span><p>You don’t need a perfect day to write a meaningful page.</p></div>
              </aside>
            </section>
          </>
        ) : null}

        {activeTab === 'profile' ? (
          <section className="profile-settings-grid">
            <article className="panel profile-edit-panel">
              <div className="panel-heading"><div><p className="section-kicker">YOUR IDENTITY</p><h2>Edit profile</h2></div><span className="reflection-symbol" aria-hidden="true">✦</span></div>
              <p className="editor-guidance">Set the name and username other people will see in GWEEN. Your diary remains private.</p>
              <form className="profile-edit-form" onSubmit={saveProfile}>
                <div className="profile-preview"><div className="profile-avatar profile-avatar-large" style={{ background: profileColorDraft }} aria-hidden="true">{initials(profileNameDraft || profile.display_name)}</div><div><strong>{profileNameDraft || profile.display_name}</strong><span>@{profileUsernameDraft || profile.username}</span></div></div>
                <label className="auth-label">Display name<input className="auth-input" value={profileNameDraft} onChange={(event) => setProfileNameDraft(event.target.value)} maxLength={40} required /></label>
                <label className="auth-label">Username<span className="input-help">3–20 letters, numbers, or underscores</span><input className="auth-input" value={profileUsernameDraft} onChange={(event) => setProfileUsernameDraft(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} minLength={3} maxLength={20} required /></label>
                <div className="avatar-picker-row"><span>Profile colour</span><div className="avatar-swatches">{AVATAR_COLORS.map((color) => <button key={color} className={'avatar-swatch' + (profileColorDraft === color ? ' selected' : '')} type="button" style={{ background: color }} onClick={() => setProfileColorDraft(color)} aria-label={'Select profile colour ' + color} aria-pressed={profileColorDraft === color} />)}</div></div>
                <button className="save-button profile-save" type="submit" disabled={profileBusy}>{profileBusy ? 'Saving profile…' : 'Save changes'} <span aria-hidden="true">↗</span></button>
                {profileMessage ? <p className="save-message" role="status">{profileMessage}</p> : null}
              </form>
            </article>
            <aside className="panel account-info-panel">
              <p className="section-kicker">ACCOUNT DETAILS</p><h2>Your GWEEN account</h2>
              <div className="account-detail"><span>Username</span><strong>@{profile.username}</strong></div>
              <div className="account-detail"><span>Display name</span><strong>{profile.display_name}</strong></div>
              <div className="account-detail"><span>Member since</span><strong>{new Date(profile.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
              <div className="account-privacy"><span aria-hidden="true">⌑</span><p><strong>Private by design</strong>Your diary is encrypted and stored in this browser. Admin users can see your public profile name, username, and usage time—not your diary entries.</p></div>
              <button className="lock-button profile-signout" type="button" onClick={() => void handleSignOut()}>Sign out & lock diary</button>
            </aside>
          </section>
        ) : null}

        {activeTab === 'admin' && isAdmin ? (
          <section className="admin-section">
            <div className="admin-heading-row"><div><p className="section-kicker">GWEEN CONTROL ROOM</p><h1>Member activity</h1><p>Account names and approximate time spent only. Diary entries are never queried here.</p></div><button className="refresh-button" type="button" onClick={() => void loadAdminMembers()} disabled={adminBusy}>{adminBusy ? 'Refreshing…' : '↻ Refresh'}</button></div>
            <div className="admin-metrics"><article className="stat-card"><span className="stat-label">Profiles</span><div className="stat-value">{adminMembers.length}</div><p>Registered GWEEN profiles</p></article><article className="stat-card"><span className="stat-label">Active now</span><div className="stat-value">{adminMembers.filter((member) => member.active_now).length}</div><p>Recent visible sessions</p></article><article className="stat-card"><span className="stat-label">Tracked time</span><div className="stat-value">{formatDuration(adminMembers.reduce((sum, member) => sum + member.total_seconds, 0))}</div><p>Approximate visible time across members</p></article></div>
            {adminError ? <p className="auth-error" role="alert">{adminError}</p> : null}
            <article className="panel admin-table-panel">
              <div className="panel-heading"><div><p className="section-kicker">PRIVACY-RESPECTING ANALYTICS</p><h2>Users</h2></div><span className="entry-count">{adminMembers.length} members</span></div>
              {adminBusy && adminMembers.length === 0 ? <p className="admin-empty">Loading member information…</p> : adminMembers.length === 0 ? <p className="admin-empty">No user profiles yet.</p> : (
                <div className="table-scroll"><table className="admin-table"><thead><tr><th>Member</th><th>Username</th><th>Total time</th><th>Last seen</th><th>Status</th></tr></thead><tbody>
                  {adminMembers.map((member) => <tr key={member.user_id}><td><div className="admin-member-name"><span className="admin-avatar" style={{ background: member.avatar_color }}>{initials(member.display_name)}</span><span><strong>{member.display_name}</strong><small>Joined {new Date(member.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span></div></td><td>@{member.username}</td><td>{formatDuration(member.total_seconds)}</td><td>{member.last_seen_at ? new Date(member.last_seen_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Not used yet'}</td><td><span className={'member-status' + (member.active_now ? ' is-active' : '')}><span />{member.active_now ? 'Active now' : 'Offline'}</span></td></tr>)}
                </tbody></table></div>
              )}
              <p className="admin-privacy-note"><span aria-hidden="true">⌑</span> Admin cannot access diary text, drafts, or private reflections. Usage time is approximate and depends on browser heartbeats.</p>
            </article>
          </section>
        ) : null}

        <footer className="page-footer"><span>GWEEN · PRIVATE DAILY JOURNAL</span><span>Diary text stays encrypted in this browser. Account and usage data are managed securely through Supabase.</span></footer>
      </div>
    </main>
  );
}
