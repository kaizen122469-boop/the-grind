import { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, BookOpen, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, Dumbbell, Gamepad2, LayoutDashboard, Menu, Moon, Plus, Sun,
  Settings, Target, Timer, TrendingUp, X, Zap, Download
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from "recharts";
import { cloudEnabled, supabase } from "./lib/supabase";

const today = (() => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 10);
})();

const nav = [
  ["Dashboard", LayoutDashboard], ["Schedule", CalendarDays],
  ["Activity Tracker", Activity], ["Goals & Habits", Target],
  ["Focus Timer", Timer], ["Analytics", BarChart3],
  ["Daily Journal", BookOpen], ["Settings", Settings]
];

const initialGoals = [
  { name: "Study", target: 5, unit: "hours/day", weight: 40 },
  { name: "Gym", target: 1, unit: "session/day", weight: 25 },
  { name: "Healthy habits", target: 1, unit: "completion/day", weight: 15 }
];

const colors = ["#8b9cff", "#41c9a5", "#e6b86b", "#c08cff", "#ff8a8a", "#ffb84d", "#4dffb8"];

const normalizeStatus = (value) => String(value ?? "pending").trim().toLowerCase();
const displayStatus = (value) => {
  const next = normalizeStatus(value);
  if (next === "completed") return "Completed";
  if (next === "missed") return "Missed";
  if (next === "postponed") return "Postponed";
  return "Pending";
};
const addHours = (datetime, hours = 1) => {
  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) return datetime;
  date.setHours(date.getHours() + hours);
  return date.toISOString();
};

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatScheduleTime(datetimeStr) {
  if (!datetimeStr || !datetimeStr.includes(" ")) return datetimeStr;
  const [d, t] = datetimeStr.split(" ");
  const dateObj = new Date(d);
  const day = dateObj.toLocaleDateString(undefined, { weekday: "short" });
  return `${day}, ${d.slice(5).replace("-", "/")} · ${t}`;
}

function minutesFor(activities, category) {
  return (activities || []).filter((a) => a.date === today && a.category === category)
    .reduce((s, a) => s + Number(a.minutes || 0), 0);
}

function scoreFor(goals) {
  return Math.round((goals || []).reduce((sum, g) => {
    const ratio = g.target > 0 ? Math.min(1, g.done / g.target) : 0;
    return sum + ratio * g.weight;
  }, 0));
}

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

const fromDbActivity = (row) => ({
  id: row.id,
  date: row.activity_date || row.date || today,
  category: row.category,
  title: row.title,
  detail: row.detail || "",
  minutes: Number(row.duration_minutes ?? row.minutes ?? 0),
  user_id: row.user_id,
  created_at: row.created_at
});

const toDbActivity = (item, userId) => ({
  user_id: userId,
  category: item.category,
  title: item.title,
  detail: item.detail || "",
  activity_date: item.date || today,
  duration_minutes: Number(item.minutes || 0),
  source: "manual"
});

const fromDbSchedule = (row) => ({
  id: row.id,
  time: row.starts_at,
  title: row.title,
  category: row.category,
  status: displayStatus(row.status)
});

const toDbSchedule = (item, userId) => {
  const startsAt = item.time || `${item.date || today} ${item.time || "09:00"}`;
  const endsAt = addHours(startsAt, 1);
  return {
    user_id: userId,
    title: item.title,
    category: item.category,
    starts_at: startsAt,
    ends_at: endsAt,
    status: normalizeStatus(item.status || "pending")
  };
};

function Card({ children, className = "", style = {} }) {
  return <section className={`panel ${className}`} style={style}>{children}</section>;
}

function Stat({ label, value, sub, icon: Icon, tone = "blue" }) {
  return (
    <Card className="stat">
      <div className={`stat-icon ${tone}`}><Icon size={19} /></div>
      <div>
        <div className="muted small">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="muted tiny">{sub}</div>
      </div>
    </Card>
  );
}

function MainApp({ user, onSignOut }) {
  const [page, setPage] = useState("Dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState(() => load("thegrind.theme", "dark"));
  const [dataLoaded, setDataLoaded] = useState(false);

  const [activities, setActivities] = useState([]);
  const [goals, setGoals] = useState([]);
  const [allProgress, setAllProgress] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [journal, setJournal] = useState("");
  const [journalSaved, setJournalSaved] = useState(true);

  const [aiInsight, setAiInsight] = useState(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const [modal, setModal] = useState(false);
  const [modalMode, setModalMode] = useState("activity");
  const [scheduleForm, setScheduleForm] = useState({ date: today, time: "09:00", title: "", category: "Study" });
  const [form, setForm] = useState({ category: "Study", title: "", detail: "", minutes: 30, date: today });
  const [goalForm, setGoalForm] = useState({ name: "", target: 1, unit: "times/day", weight: 10, color: colors[0] });

  const [focusMinutes, setFocusMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSubject, setTimerSubject] = useState("Study");
  const [calDate, setCalDate] = useState(new Date());

  const score = scoreFor(goals);
  const studyMinutes = minutesFor(activities, "Study");
  const gameMinutes = minutesFor(activities, "Gaming");
  const gymMinutes = minutesFor(activities, "Gym");

  useEffect(() => {
    document.body.className = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("thegrind.theme", theme);
  }, [theme]);

  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().slice(0, 10);
      const dayName = d.toLocaleDateString(undefined, { weekday: "short" });
      const dayActivities = activities.filter((a) => a.date === dateStr);
      const studyMins = dayActivities.filter((a) => a.category === "Study").reduce((sum, a) => sum + Number(a.minutes), 0);
      const gameMins = dayActivities.filter((a) => a.category === "Gaming").reduce((sum, a) => sum + Number(a.minutes), 0);
      const dayProg = allProgress.filter((p) => p.progress_date === dateStr);
      const dayGoals = goals.map((g) => {
        const p = dayProg.find((x) => x.goal_id === g.id);
        return { ...g, done: p ? p.amount : 0 };
      });

      return {
        day: dayName,
        study: Number(((studyMins / 60) * 10 / 10).toFixed(1)),
        gaming: Number(((gameMins / 60) * 10 / 10).toFixed(1)),
        score: scoreFor(dayGoals)
      };
    });
  }, [activities, allProgress, goals]);

  const fetchAiInsight = async (currentActivities, currentScore) => {
    if (!supabase?.functions) return;
    setLoadingAi(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-insight", {
        body: { activities: currentActivities.slice(0, 10), score: currentScore }
      });
      if (error) throw error;
      if (data) setAiInsight(data);
    } catch (err) {
      console.error("AI Insight Error:", err);
      setAiInsight({
        title: "Keep pushing forward",
        body: "Your daily consistency is building a strong baseline for your long-term goals.",
        tip: "Log your next focus session to keep momentum."
      });
    } finally {
      setLoadingAi(false);
    }
  };

  useEffect(() => {
    const fetchCloudData = async () => {
      if (!user?.id || !supabase) return;

      const { data: actData } = await supabase
        .from("activities")
        .select("*")
        .eq("user_id", user.id)
        .order("activity_date", { ascending: false })
        .order("created_at", { ascending: false });

      setActivities((actData || []).map(fromDbActivity));

      const { data: dbGoals } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true);

      const { data: dbProgress } = await supabase
        .from("goal_progress")
        .select("*")
        .eq("user_id", user.id);

      setAllProgress(dbProgress || []);

      let currentGoals = [];
      if (dbGoals && dbGoals.length === 0) {
        const newGoals = initialGoals.map((g, i) => ({
          ...g,
          user_id: user.id,
          color: colors[i % colors.length],
          is_active: true
        }));

        const { data: insertedGoals } = await supabase.from("goals").insert(newGoals).select();
        currentGoals = (insertedGoals || []).map((g) => ({ ...g, done: 0, color: g.color || colors[0] }));
        setGoals(currentGoals);
      } else {
        currentGoals = (dbGoals || []).map((g) => {
          const p = (dbProgress || []).find((x) => x.goal_id === g.id && x.progress_date === today);
          return { ...g, done: p ? p.amount : 0, color: g.color || colors[0] };
        });
        setGoals(currentGoals);
      }

      const { data: dbSchedule } = await supabase
        .from("schedule_items")
        .select("*")
        .eq("user_id", user.id)
        .order("starts_at", { ascending: true });
      setSchedule((dbSchedule || []).map(fromDbSchedule));

      const { data: dbJournal } = await supabase
        .from("journal_entries")
        .select("content")
        .eq("user_id", user.id)
        .eq("entry_date", today)
        .maybeSingle();

      if (dbJournal) setJournal(dbJournal.content || "");

      setDataLoaded(true);

      if (actData && actData.length) {
        fetchAiInsight(actData.map(fromDbActivity), scoreFor(currentGoals));
      }
    };

    fetchCloudData();
  }, [user.id]);

  useEffect(() => {
    if (!dataLoaded || !user?.id || !supabase) return;
    setJournalSaved(false);
    const timeoutId = setTimeout(async () => {
      await supabase.from("journal_entries").upsert({
        user_id: user.id,
        entry_date: today,
        content: journal
      }, { onConflict: "user_id, entry_date" });
      setJournalSaved(true);
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [journal, dataLoaded, user.id]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setRemaining((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  useEffect(() => {
    if (!timerRunning || remaining !== 0 || !supabase || !user?.id) return;

    setTimerRunning(false);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      console.error(e);
    }

    supabase.from("activities").insert([
      {
        ...toDbActivity({
          category: timerSubject,
          title: `${timerSubject} focus session (Auto)`,
          detail: "Completed full focus timer",
          minutes: focusMinutes,
          date: today
        }, user.id)
      }
    ]).select().then(({ data, error }) => {
      if (!error && data) {
        const nextActs = [fromDbActivity(data[0]), ...activities];
        setActivities(nextActs);
        setRemaining(focusMinutes * 60);
        fetchAiInsight(nextActs, score);
      }
    });
  }, [remaining, timerRunning, focusMinutes, timerSubject, user.id, activities, score]);

  const addActivity = async () => {
    if (!form.title.trim() || Number(form.minutes) <= 0 || !supabase) return;

    const { data, error } = await supabase.from("activities").insert([
      toDbActivity(form, user.id)
    ]).select();

    if (error) {
      alert("Error: " + error.message);
      return;
    }

    if (data) {
      const nextActs = [fromDbActivity(data[0]), ...activities];
      setActivities(nextActs);
      setForm({ category: "Study", title: "", detail: "", minutes: 30, date: today });
      setModal(false);
      fetchAiInsight(nextActs, score);
    }
  };

  const deleteActivity = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (!error) {
      const nextActs = activities.filter((x) => x.id !== id);
      setActivities(nextActs);
      fetchAiInsight(nextActs, score);
    }
  };

  const saveFocus = async () => {
    if (!supabase || !user?.id) return;
    const elapsed = Math.max(1, focusMinutes - Math.ceil(remaining / 60));
    const { data, error } = await supabase.from("activities").insert([
      {
        ...toDbActivity({
          category: timerSubject,
          title: `${timerSubject} focus session`,
          detail: "Partial timer",
          minutes: elapsed,
          date: today
        }, user.id)
      }
    ]).select();

    if (!error && data) {
      const nextActs = [fromDbActivity(data[0]), ...activities];
      setActivities(nextActs);
      setTimerRunning(false);
      setRemaining(focusMinutes * 60);
      fetchAiInsight(nextActs, score);
    }
  };

  const addGoal = async () => {
    if (!goalForm.name.trim() || Number(goalForm.target) <= 0 || Number(goalForm.weight) <= 0 || !supabase) return;

    const newGoal = {
      user_id: user.id,
      name: goalForm.name,
      target: Number(goalForm.target),
      unit: goalForm.unit,
      weight: Number(goalForm.weight),
      is_active: true
    };

    const { data, error } = await supabase.from("goals").insert([newGoal]).select();
    if (error) {
      alert("Error: " + error.message);
      return;
    }

    if (data) {
      setGoals((prev) => [...prev, { ...data[0], done: 0, color: goalForm.color }]);
      setModal(false);
    }
  };

  const updateGoal = async (id, doneValue) => {
    const val = Math.max(0, Number(doneValue));
    const nextGoals = goals.map((g) => (g.id === id ? { ...g, done: val } : g));
    setGoals(nextGoals);
    const nextScore = scoreFor(nextGoals);

    setAllProgress((prev) => {
      const idx = prev.findIndex((p) => p.goal_id === id && p.progress_date === today);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount: val };
        return next;
      }
      return [...prev, { user_id: user.id, goal_id: id, progress_date: today, amount: val }];
    });

    const { data: existing } = await supabase.from("goal_progress").select("*")
      .eq("user_id", user.id).eq("goal_id", id).eq("progress_date", today);

    if (existing && existing.length > 0) {
      await supabase.from("goal_progress").update({ amount: val }).eq("user_id", user.id).eq("goal_id", id).eq("progress_date", today);
    } else {
      await supabase.from("goal_progress").insert([{ user_id: user.id, goal_id: id, progress_date: today, amount: val }]);
    }

    fetchAiInsight(activities, nextScore);
  };

  const deleteGoal = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from("goals").delete().eq("id", id);
    if (!error) {
      setGoals((prev) => prev.filter((x) => x.id !== id));
      setAllProgress((prev) => prev.filter((x) => x.goal_id !== id));
    }
  };

  const addSchedule = async () => {
    if (!scheduleForm.title.trim() || !supabase) return;

    const datetime = `${scheduleForm.date} ${scheduleForm.time}`;
    const newItem = toDbSchedule({ ...scheduleForm, title: scheduleForm.title, time: datetime, status: "pending" }, user.id);

    const { data, error } = await supabase.from("schedule_items").insert([newItem]).select();
    if (error) {
      alert("Error: " + error.message);
      return;
    }

    if (data) {
      const nextSchedule = [...schedule, fromDbSchedule(data[0])].sort((a, b) => a.time.localeCompare(b.time));
      setSchedule(nextSchedule);
      setModal(false);
    }
  };

  const toggleSchedule = async (id) => {
    const item = schedule.find((s) => s.id === id);
    if (!item || !supabase) return;
    const newStatus = normalizeStatus(item.status) === "completed" ? "pending" : "completed";
    setSchedule((prev) => prev.map((s) => (s.id === id ? { ...s, status: displayStatus(newStatus) } : s)));
    await supabase.from("schedule_items").update({ status: newStatus }).eq("id", id);
  };

  const deleteSchedule = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from("schedule_items").delete().eq("id", id);
    if (!error) setSchedule((prev) => prev.filter((x) => x.id !== id));
  };

  const exportCSV = () => {
    const rows = [["Date", "Category", "Title", "Detail", "Minutes"], ...activities.map((a) => [a.date, a.category, a.title, a.detail, a.minutes])];
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "thegrind-data.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openAdd = (category) => {
    setModalMode("activity");
    setForm((f) => ({ ...f, category: category || "Study" }));
    setModal(true);
  };

  const openSchedule = (dateStr) => {
    setModalMode("schedule");
    setScheduleForm({ date: dateStr || today, time: "09:00", title: "", category: "Study" });
    setModal(true);
  };

  const openGoal = () => {
    setModalMode("goal");
    setGoalForm({ name: "", target: 1, unit: "times/day", weight: 10, color: colors[Math.floor(Math.random() * colors.length)] });
    setModal(true);
  };

  const calYear = calDate.getFullYear();
  const calMonth = calDate.getMonth();
  const calDays = getCalendarDays(calYear, calMonth);
  const monthName = calDate.toLocaleString("default", { month: "long" });
  const scheduleByDate = schedule.reduce((acc, s) => {
    const d = s.time.split(" ")[0];
    if (!acc[d]) acc[d] = [];
    acc[d].push(s);
    return acc;
  }, {});

  return (
    <div className={`app-shell ${theme}`}>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Zap size={20} /></div>
          <div><b>THE GRIND</b></div>
          <button className="icon-btn mobile-close" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button key={label} className={`nav-item ${page === label ? "active" : ""}`} onClick={() => { setPage(label); setMobileNav(false); }}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{user?.email?.[0]?.toUpperCase() || "U"}</div>
            <div>
              <b>Workspace</b>
              <small>Personal account</small>
            </div>
          </div>
          <button className="secondary-btn" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="top-left">
            <button className="icon-btn menu-btn" onClick={() => setMobileNav(true)}><Menu /></button>
            <div>
              <div className="eyebrow">WORKSPACE / {page.toUpperCase()}</div>
              <h1>{page}</h1>
            </div>
          </div>
          <div className="top-actions">
            <div className="date-chip"><CalendarDays size={15} />{new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
            <button className="icon-btn" title="Toggle theme" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="primary-btn" onClick={() => openAdd()}><Plus size={17} /> Add activity</button>
          </div>
        </header>

        {page === "Dashboard" && (
          <div className="content">
            <div className="welcome-row">
              <div>
                <h2>Make today count.</h2>
                <p className="muted">A little progress every day adds up.</p>
              </div>
              <div className="score-pill">
                <span className="score-orb"><Zap size={17} /></span>
                <div><small>DISCIPLINE SCORE</small><b>{score}/100</b></div>
              </div>
            </div>

            <div className="stats-grid">
              <Stat label="Study today" value={`${(studyMinutes / 60).toFixed(1)}h`} sub="Logged study time" icon={BookOpen} tone="blue" />
              <Stat label="Gaming today" value={`${(gameMinutes / 60).toFixed(1)}h`} sub="Personal time tracked" icon={Gamepad2} tone="purple" />
              <Stat label="Gym today" value={gymMinutes ? "Done" : "Not logged"} sub={`${gymMinutes} minutes recorded`} icon={Dumbbell} tone="green" />
              <Stat label="Activities logged" value={activities.filter((a) => a.date === today).length} sub="Entries today" icon={Activity} tone="orange" />
            </div>

            <Card className="insight-card">
              <div className="insight-symbol"><Zap size={18} /></div>
              <div className="insight-copy">
                <div className="insight-kicker">THE GRIND INTELLIGENCE · AI INSIGHT</div>
                {loadingAi ? (
                  <h3 style={{ opacity: 0.6 }}>Analyzing your day with AI...</h3>
                ) : aiInsight ? (
                  <>
                    <h3>{aiInsight.title}</h3>
                    <p>{aiInsight.body}</p>
                    <div className="insight-tip"><span>Suggested next step</span>{aiInsight.tip}</div>
                  </>
                ) : (
                  <>
                    <h3>Keep building momentum</h3>
                    <p>Log your activities today to unlock personalized AI analysis.</p>
                  </>
                )}
              </div>
            </Card>

            <div className="dashboard-grid">
              <Card className="chart-card">
                <div className="section-head">
                  <div><h3>Study progress</h3></div>
                </div>
                <div className="chart-legend"><span className="legend-blue" /> Study hours</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeklyData}>
                      <defs>
                        <linearGradient id="studyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b9cff" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#8b9cff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: "#8490a5", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#8490a5", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="study" stroke="#8b9cff" strokeWidth={2.5} fill="url(#studyFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="calendar-card" style={{ gridRow: "span 2" }}>
                <div className="section-head" style={{ marginBottom: 16 }}>
                  <div><h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><CalendarDays size={18} /> Calendar</h3></div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="icon-btn" onClick={() => setCalDate(new Date(calYear, calMonth - 1, 1))}><ChevronLeft size={16} /></button>
                    <button className="icon-btn" onClick={() => setCalDate(new Date(calYear, calMonth + 1, 1))}><ChevronRight size={16} /></button>
                  </div>
                </div>
                <div style={{ textAlign: "center", fontWeight: "bold", marginBottom: 12 }}>{monthName} {calYear}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: 12, color: "#8490a5", marginBottom: 8 }}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                  {calDays.map((d, i) => {
                    if (!d) return <div key={i} />;
                    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const isToday = dateStr === today;
                    const hasItems = (scheduleByDate[dateStr] || []).length > 0;
                    return (
                      <div key={i} onClick={() => openSchedule(dateStr)} style={{ padding: "8px 0", textAlign: "center", fontSize: 14, borderRadius: 8, cursor: "pointer", background: isToday ? "rgba(139, 156, 255, 0.15)" : "rgba(255,255,255,0.03)", border: isToday ? "1px solid #8b9cff" : "1px solid rgba(255,255,255,0.05)", position: "relative", color: isToday ? "#8b9cff" : "inherit" }}>
                        {d}
                        {hasItems && <div style={{ width: 4, height: 4, background: "#41c9a5", borderRadius: "50%", margin: "2px auto 0" }} />}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 16 }}>
                  <h4 style={{ fontSize: 13, color: "#8490a5", marginBottom: 12 }}>Upcoming events</h4>
                  {(schedule.filter((s) => normalizeStatus(s.status) !== "completed" && s.time >= today).slice(0, 4).map((s) => (
                    <div className="schedule-row" key={s.id} style={{ padding: "8px 0" }}>
                      <span className="schedule-time" style={{ fontSize: 12, minWidth: 90 }}>{formatScheduleTime(s.time)}</span>
                      <div className="schedule-info"><b>{s.title}</b><small>{s.category}</small></div>
                    </div>
                  )))}
                  {schedule.filter((s) => normalizeStatus(s.status) !== "completed" && s.time >= today).length === 0 && <p className="muted tiny">No upcoming events planned.</p>}
                </div>
              </Card>

              <Card className="goals-card">
                <div className="section-head">
                  <div><h3>Today's goals</h3></div>
                  <button className="text-btn" onClick={() => setPage("Goals & Habits")}>View all</button>
                </div>
                {goals.slice(0, 3).map((g) => (
                  <div className="goal-row" key={g.id}>
                    <div className="goal-title"><span className="goal-dot" style={{ background: g.color || colors[0] }} /> <b>{g.name}</b><small>{g.done} / {g.target} {g.unit}</small></div>
                    <div className="goal-progress"><span style={{ width: `${Math.min(100, (g.done / g.target) * 100)}%`, background: g.color || colors[0] }} /></div>
                    <input type="number" min="0" step="0.25" value={g.done} onChange={(e) => updateGoal(g.id, e.target.value)} />
                  </div>
                ))}
              </Card>

              <Card className="recent-card">
                <div className="section-head">
                  <div><h3>Recent activity</h3></div>
                  <button className="text-btn" onClick={() => setPage("Activity Tracker")}>See all</button>
                </div>
                {activities.slice(0, 4).map((a) => (
                  <div className="activity-row" key={a.id}>
                    <div className={`activity-icon ${a.category.toLowerCase()}`}>
                      {a.category === "Study" ? <BookOpen size={16} /> : a.category === "Gaming" ? <Gamepad2 size={16} /> : a.category === "Gym" ? <Dumbbell size={16} /> : <Activity size={16} />}
                    </div>
                    <div className="activity-info">
                      <b>{a.title}</b>
                      <small>{a.category} · {a.date}</small>
                    </div>
                    <strong>{a.minutes}m</strong>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}

        {page === "Schedule" && (
          <div className="content">
            <div className="page-intro">
              <div><h2>Your plan, your pace.</h2></div>
              <button className="primary-btn" onClick={() => openSchedule(today)}><Plus size={17} /> Add to schedule</button>
            </div>
            <Card>
              <div className="section-head"><div><h3>All schedule items</h3></div></div>
              {schedule.map((s) => (
                <div className="schedule-row" key={s.id}>
                  <span className="schedule-time">{formatScheduleTime(s.time)}</span>
                  <div className="schedule-info"><b>{s.title}</b><small>{s.category}</small></div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className={`status-btn ${normalizeStatus(s.status) === "completed" ? "done" : ""}`} onClick={() => toggleSchedule(s.id)}>{s.status}</button>
                    <button className="icon-btn" onClick={() => deleteSchedule(s.id)}><X size={16} /></button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {page === "Activity Tracker" && (
          <div className="content">
            <div className="page-intro">
              <div><h2>Every session counts.</h2></div>
              <button className="primary-btn" onClick={() => openAdd()}><Plus size={17} /> Add activity</button>
            </div>
            <Card>
              <table>
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Category</th>
                    <th>Date</th>
                    <th>Duration</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr key={a.id}>
                      <td><b>{a.title}</b><small>{a.detail}</small></td>
                      <td><span className="category-tag">{a.category}</span></td>
                      <td>{a.date}</td>
                      <td>{a.minutes} min</td>
                      <td><button className="icon-btn" onClick={() => deleteActivity(a.id)}><X size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {page === "Goals & Habits" && (
          <div className="content">
            <div className="page-intro">
              <div><h2>Consistency over perfection.</h2></div>
              <button className="primary-btn" onClick={openGoal}><Plus size={17} /> New goal</button>
            </div>
            <Card>
              {goals.map((g) => (
                <div className="goal-card" key={g.id}>
                  <div className="goal-title"><span className="goal-dot" style={{ background: g.color || colors[0] }} /><b>{g.name}</b></div>
                  <div className="goal-progress"><span style={{ width: `${Math.min(100, (g.done / g.target) * 100)}%`, background: g.color || colors[0] }} /></div>
                  <div className="goal-inputs">
                    <input type="number" min="0" step="0.25" value={g.done} onChange={(e) => updateGoal(g.id, e.target.value)} />
                    <button className="icon-btn" onClick={() => deleteGoal(g.id)}><X size={16} /></button>
                  </div>
                  <p className="muted tiny">Target: {g.target} {g.unit}</p>
                </div>
              ))}
            </Card>
          </div>
        )}

        {page === "Focus Timer" && (
          <div className="content timer-page">
            <div className="timer-copy"><span className="eyebrow">DEEP WORK MODE</span><h2>Protect your focus.</h2></div>
            <Card className="timer-card">
              <div className="timer-select">
                <label>Activity<select value={timerSubject} onChange={(e) => setTimerSubject(e.target.value)}>
                  <option>Study</option>
                  <option>Gaming</option>
                  <option>Gym</option>
                </select></label>
                <label>Session length<select value={focusMinutes} onChange={(e) => { const next = Number(e.target.value); setFocusMinutes(next); setRemaining(next * 60); setTimerRunning(false); }}>
                  <option value={15}>15 minutes</option>
                  <option value={25}>25 minutes</option>
                  <option value={45}>45 minutes</option>
                </select></label>
              </div>
              <div className="timer-ring">
                <div className="timer-inner"><span>{formatTime(remaining)}</span><small>{timerRunning ? "FOCUSING" : "READY"}</small></div>
              </div>
              <div className="timer-actions">
                <button className="primary-btn" onClick={() => setTimerRunning((v) => !v)}>{timerRunning ? "Pause" : "Start focus"}</button>
                <button className="secondary-btn" onClick={saveFocus}>Save session</button>
              </div>
            </Card>
          </div>
        )}

        {page === "Analytics" && (
          <div className="content">
            <div className="page-intro">
              <div><h2>See the bigger picture.</h2></div>
              <button className="secondary-btn" onClick={exportCSV}><Download size={15} /> Export CSV</button>
            </div>
            <Card className="chart-card">
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#8490a5", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#8490a5", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Line dataKey="score" stroke="#41c9a5" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}

        {page === "Daily Journal" && (
          <div className="content">
            <div className="page-intro"><div><h2>Reflect, reset, repeat.</h2></div></div>
            <Card className="journal-card">
              <textarea value={journal} onChange={(e) => setJournal(e.target.value)} placeholder="Write a few lines about your day..." />
              <div className="journal-foot">
                <span className="save-label">{journalSaved ? <><Check size={14} /> Cloud saved</> : "Saving..."}</span>
              </div>
            </Card>
          </div>
        )}

        {page === "Settings" && (
          <div className="content">
            <div className="page-intro"><div><h2>Your workspace, your rules.</h2></div></div>
            <Card className="settings-card">
              <div className="setting-row">
                <div>
                  <b>Signed in</b>
                  <p className="muted tiny">{user?.email || "Authenticated account"}</p>
                </div>
                <button className="secondary-btn" onClick={onSignOut}>Sign out</button>
              </div>
              <div className="setting-row">
                <div>
                  <b>Export your data</b>
                  <p className="muted tiny">Download your activity history as a CSV file.</p>
                </div>
                <button className="secondary-btn" onClick={exportCSV}><Download size={15} /> Export</button>
              </div>
            </Card>
          </div>
        )}
      </main>

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><h3>{modalMode === "activity" ? "Log an activity" : modalMode === "schedule" ? "Add to schedule" : "Create a new goal"}</h3></div>
              <button className="icon-btn" onClick={() => setModal(false)}><X size={18} /></button>
            </div>

            {modalMode === "activity" && (
              <div className="form-grid">
                <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {['Study', 'Gaming', 'Gym', 'Sleep', 'Custom'].map((x) => <option key={x}>{x}</option>)}
                </select></label>
                <label>Date<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
                <label className="full">Activity name<input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
                <label className="full">Subject / notes<input value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></label>
                <label className="full">Duration (minutes)<input type="number" min="1" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} /></label>
              </div>
            )}

            {modalMode === "schedule" && (
              <div className="form-grid">
                <label>Date<input type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })} /></label>
                <label>Time<input type="time" value={scheduleForm.time} onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })} /></label>
                <label className="full">Category<select value={scheduleForm.category} onChange={(e) => setScheduleForm({ ...scheduleForm, category: e.target.value })}>
                  {['Study', 'Gaming', 'Gym', 'Other'].map((x) => <option key={x}>{x}</option>)}
                </select></label>
                <label className="full">Activity name<input autoFocus value={scheduleForm.title} onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })} /></label>
              </div>
            )}

            {modalMode === "goal" && (
              <div className="form-grid">
                <label className="full">Goal name<input autoFocus value={goalForm.name} onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })} /></label>
                <label>Daily target<input type="number" min="0.1" step="0.1" value={goalForm.target} onChange={(e) => setGoalForm({ ...goalForm, target: Number(e.target.value) })} /></label>
                <label>Unit<input value={goalForm.unit} onChange={(e) => setGoalForm({ ...goalForm, unit: e.target.value })} /></label>
                <label>Score weight (%)<input type="number" min="1" max="100" value={goalForm.weight} onChange={(e) => setGoalForm({ ...goalForm, weight: Number(e.target.value) })} /></label>
                <label>Color<select value={goalForm.color} onChange={(e) => setGoalForm({ ...goalForm, color: e.target.value })}>
                  {colors.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              </div>
            )}

            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={modalMode === "activity" ? addActivity : modalMode === "schedule" ? addSchedule : addGoal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthGate() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let active = true;
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data?.session ?? null);
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!supabase) return;

    try {
      if (mode === "signup") {
        await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() || email.trim().split("@")[0] }
          }
        });
        setMode("signin");
      } else {
        await supabase.auth.signInWithPassword({ email: email.trim(), password });
      }
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return null;
  if (session) return <MainApp user={session.user} onSignOut={async () => await supabase.auth.signOut()} />;

  return (
    <div className="app-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="panel" style={{ width: "min(100%, 440px)", padding: 28 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          <div className="brand-mark"><Zap size={20} /></div>
          <div><b>THE GRIND</b></div>
        </div>
        <h1 style={{ margin: "0 0 24px", fontSize: 28 }}>{mode === "signin" ? "Welcome back." : "Create account."}</h1>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          {mode === "signup" && (
            <label>
              Display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="primary-btn" type="submit">{mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>
        <p className="muted tiny" style={{ marginTop: 18 }}>
          <button type="button" className="text-btn" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Create an account instead" : "Sign in instead"}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return cloudEnabled ? <AuthGate /> : <div style={{ padding: 24 }}>Supabase setup needed. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.</div>;
}

