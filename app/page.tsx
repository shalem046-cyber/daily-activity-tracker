'use client';

import { useEffect, useMemo, useState } from 'react';

type ActivityType = 'Gym' | 'Meal' | 'Sleep' | 'Hydration' | 'Walk' | 'Work' | 'Study' | 'Mindfulness';

type Activity = {
  id: string;
  type: ActivityType;
  title: string;
  duration: number;
  intensity: number;
  note: string;
  date: string;
  time: string;
};

type FormState = {
  type: ActivityType;
  title: string;
  duration: number;
  intensity: number;
  note: string;
  time: string;
};

const activityOptions: { value: ActivityType; label: string }[] = [
  { value: 'Gym', label: 'Gym' },
  { value: 'Meal', label: 'Meal' },
  { value: 'Sleep', label: 'Sleep' },
  { value: 'Hydration', label: 'Hydration' },
  { value: 'Walk', label: 'Walk' },
  { value: 'Work', label: 'Work' },
  { value: 'Study', label: 'Study' },
  { value: 'Mindfulness', label: 'Mindfulness' },
];

const formatDay = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });

const getDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRecentDayKey = (daysAgo: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return getDateKey(date);
};

const createSampleActivities = (): Activity[] => {
  const today = getDateKey(new Date());
  const yesterday = getRecentDayKey(1);
  const past3 = getRecentDayKey(3);

  return [
    {
      id: 'demo-1',
      type: 'Gym',
      title: 'Strength training',
      duration: 50,
      intensity: 4,
      note: 'Upper body and core work',
      date: today,
      time: '07:15',
    },
    {
      id: 'demo-2',
      type: 'Meal',
      title: 'Healthy lunch',
      duration: 1,
      intensity: 3,
      note: 'Chicken, rice and vegetables',
      date: today,
      time: '13:00',
    },
    {
      id: 'demo-3',
      type: 'Hydration',
      title: 'Water intake',
      duration: 2,
      intensity: 3,
      note: '2 litres consumed',
      date: today,
      time: '18:30',
    },
    {
      id: 'demo-4',
      type: 'Sleep',
      title: 'Night rest',
      duration: 8,
      intensity: 5,
      note: 'Good sleep routine',
      date: yesterday,
      time: '22:30',
    },
    {
      id: 'demo-5',
      type: 'Walk',
      title: 'Evening walk',
      duration: 30,
      intensity: 3,
      note: 'Fresh air and movement',
      date: past3,
      time: '19:10',
    },
  ];
};

const defaultForm: FormState = {
  type: 'Gym',
  title: '',
  duration: 30,
  intensity: 3,
  note: '',
  time: '08:00',
};

const unitFor = (type: ActivityType) => {
  switch (type) {
    case 'Sleep':
      return 'hrs';
    case 'Hydration':
      return 'L';
    case 'Meal':
      return 'meals';
    default:
      return 'min';
  }
};

export default function Home() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState('08:30');

  useEffect(() => {
    const savedActivities = localStorage.getItem('vitalflow-activities');
    if (savedActivities) {
      try {
        setActivities(JSON.parse(savedActivities));
      } catch {
        setActivities(createSampleActivities());
      }
    } else {
      setActivities(createSampleActivities());
    }
  }, []);

  useEffect(() => {
    if (activities.length > 0) {
      localStorage.setItem('vitalflow-activities', JSON.stringify(activities));
    }
  }, [activities]);

  useEffect(() => {
    if (!(typeof window !== 'undefined' && 'Notification' in window)) {
      return;
    }

    setNotificationsEnabled(Notification.permission === 'granted');
  }, []);

  useEffect(() => {
    if (!notificationsEnabled || !(typeof window !== 'undefined' && 'Notification' in window)) {
      return;
    }

    const interval = setInterval(() => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      if (currentTime === reminderTime && Notification.permission === 'granted') {
        new Notification('VitalFlow reminder', {
          body: 'Take a quick moment to log your progress and keep your routine on track.',
        });
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [notificationsEnabled, reminderTime]);

  const todayKey = getDateKey(new Date());
  const todayActivities = useMemo(
    () => activities.filter((item) => item.date === todayKey),
    [activities, todayKey],
  );

  const totalMinutes = todayActivities.reduce((sum, item) => sum + item.duration, 0);
  const workoutMinutes = todayActivities
    .filter((item) => item.type === 'Gym' || item.type === 'Walk')
    .reduce((sum, item) => sum + item.duration, 0);
  const sleepHours = todayActivities
    .filter((item) => item.type === 'Sleep')
    .reduce((sum, item) => sum + item.duration, 0);
  const hydrationLiters = todayActivities
    .filter((item) => item.type === 'Hydration')
    .reduce((sum, item) => sum + item.duration, 0);

  const consistencyScore = Math.min(100, Math.round((workoutMinutes / 90) * 45 + (sleepHours / 8) * 35 + (hydrationLiters / 2) * 20));

  const weeklyTrend = useMemo(() => {
    const labels: string[] = [];
    const values: number[] = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const label = formatDay(date);
      const key = getDateKey(date);
      const value = activities
        .filter((item) => item.date === key)
        .reduce((sum, item) => sum + item.duration, 0);

      labels.push(label);
      values.push(value);
    }

    return { labels, values };
  }, [activities]);

  const suggestions = useMemo(() => {
    const items: string[] = [];

    if (sleepHours < 8) {
      items.push('You are slightly below a healthy sleep target. Aim for 8 hours tonight to recover and stay focused.');
    } else {
      items.push('Excellent sleep routine. Your recovery quality is strong and your energy should stay balanced.');
    }

    if (workoutMinutes < 60) {
      items.push('Your activity level is a bit low. Adding a 20–30 minute movement session would help a lot.');
    } else {
      items.push('You are doing great with movement. Keep that momentum going to support your health and performance.');
    }

    if (hydrationLiters < 2) {
      items.push('Hydration is below target. Try to drink water regularly throughout the day for better focus and recovery.');
    } else {
      items.push('Hydration is on track. This supports your energy, focus, and daily performance.');
    }

    if (todayActivities.length < 3) {
      items.push('You have a lighter routine today. Logging at least 3 healthy habits can help you build a stronger pattern.');
    } else {
      items.push('Your daily rhythm is balanced. Staying consistent with your log will make it easier to spot long-term improvement.');
    }

    return items.slice(0, 4);
  }, [sleepHours, workoutMinutes, hydrationLiters, todayActivities.length]);

  const handleAddActivity = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const title = form.title.trim() || `${form.type} check-in`;

    const nextItem: Activity = {
      id: `${Date.now()}`,
      type: form.type,
      title,
      duration: Number(form.duration),
      intensity: Number(form.intensity),
      note: form.note.trim() || 'Logged from daily planner',
      date: todayKey,
      time: form.time,
    };

    setActivities((current) => [nextItem, ...current]);
    setForm({ ...defaultForm, type: form.type });
  };

  const handleEnableNotifications = async () => {
    if (!(typeof window !== 'undefined' && 'Notification' in window)) {
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === 'granted');
  };

  return (
    <main className="page-shell">
      <div className="container">
        <header className="topbar">
          <div>
            <p className="eyebrow">Daily wellness dashboard</p>
            <h1>VitalFlow</h1>
          </div>
          <button className="ghost-button" onClick={handleEnableNotifications}>
            {notificationsEnabled ? 'Notifications on' : 'Enable reminders'}
          </button>
        </header>

        <section className="hero-panel">
          <div className="hero-copy">
            <p className="subtitle">Track habits, improve consistency, and stay motivated every day.</p>
            <h2>Build a healthy routine you can actually stick to.</h2>
            <p>
              Log your gym sessions, meals, sleep, hydration, walks, and daily focus in one place — then let the app
aalyse your activity and suggest better patterns.
            </p>
          </div>

          <div className="score-box">
            <span>Consistency score</span>
            <strong>{consistencyScore}%</strong>
            <small>{todayActivities.length} activities logged today</small>
          </div>
        </section>

        <section className="metrics-grid">
          <article className="metric-card accent-blue">
            <label>Today</label>
            <strong>{totalMinutes}</strong>
            <span>minutes logged</span>
          </article>
          <article className="metric-card accent-green">
            <label>Sleep</label>
            <strong>{sleepHours || 0}</strong>
            <span>hours</span>
          </article>
          <article className="metric-card accent-purple">
            <label>Workout</label>
            <strong>{workoutMinutes}</strong>
            <span>minutes</span>
          </article>
          <article className="metric-card accent-orange">
            <label>Hydration</label>
            <strong>{hydrationLiters || 0}</strong>
            <span>litres</span>
          </article>
        </section>

        <section className="content-grid">
          <div className="left-column">
            <article className="card form-card">
              <div className="section-heading">
                <h3>Add daily activity</h3>
                <span>Track your progress</span>
              </div>

              <form onSubmit={handleAddActivity} className="activity-form">
                <div className="form-grid">
                  <label>
                    <span>Category</span>
                    <select
                      value={form.type}
                      onChange={(event) => setForm({ ...form, type: event.target.value as ActivityType })}
                    >
                      {activityOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Title</span>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                      placeholder="Morning workout"
                    />
                  </label>

                  <label>
                    <span>Duration</span>
                    <input
                      type="number"
                      min="1"
                      value={form.duration}
                      onChange={(event) => setForm({ ...form, duration: Number(event.target.value) || 0 })}
                    />
                  </label>

                  <label>
                    <span>Intensity</span>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={form.intensity}
                      onChange={(event) => setForm({ ...form, intensity: Number(event.target.value) })}
                    />
                    <small>{form.intensity}/5</small>
                  </label>

                  <label>
                    <span>Time</span>
                    <input
                      type="time"
                      value={form.time}
                      onChange={(event) => setForm({ ...form, time: event.target.value })}
                    />
                  </label>
                </div>

                <label>
                  <span>Note</span>
                  <textarea
                    value={form.note}
                    onChange={(event) => setForm({ ...form, note: event.target.value })}
                    rows={3}
                    placeholder="What did you do, and how did it feel?"
                  />
                </label>

                <button type="submit" className="primary-button">
                  Save activity
                </button>
              </form>
            </article>

            <article className="card chart-card">
              <div className="section-heading">
                <h3>7-day rhythm</h3>
                <span>Activity trend</span>
              </div>

              <div className="bar-chart" aria-label="Weekly activity trend">
                {weeklyTrend.labels.map((label, index) => {
                  const value = weeklyTrend.values[index];
                  const height = Math.max((value / 8) * 100, value === 0 ? 5 : 15);

                  return (
                    <div key={label + index} className="bar-column">
                      <div className="bar-track">
                        <div className="bar-fill" style={{ height: `${height}%` }} />
                      </div>
                      <small>{label}</small>
                    </div>
                  );
                })}
              </div>
            </article>
          </div>

          <div className="right-column">
            <article className="card suggestion-card">
              <div className="section-heading">
                <h3>Smart suggestions</h3>
                <span>Based on your routine</span>
              </div>

              <ul className="suggestion-list">
                {suggestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="card reminder-card">
              <div className="section-heading">
                <h3>Reminder setup</h3>
                <span>Stay on track</span>
              </div>

              <div className="reminder-row">
                <label>
                  <span>Daily reminder time</span>
                  <input
                    type="time"
                    value={reminderTime}
                    onChange={(event) => setReminderTime(event.target.value)}
                  />
                </label>
              </div>

              <p className="reminder-note">
                {notificationsEnabled
                  ? `You’ll receive a reminder each day at ${reminderTime}.`
                  : 'Enable browser notifications to receive activity reminders.'}
              </p>
            </article>

            <article className="card recent-card">
              <div className="section-heading">
                <h3>Recent entries</h3>
                <span>{todayActivities.length} today</span>
              </div>

              <ul className="recent-list">
                {todayActivities.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.type} · {item.time}
                      </small>
                    </div>
                    <span>
                      {item.type === 'Hydration' ? `${item.duration}L` : `${item.duration}${unitFor(item.type)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
