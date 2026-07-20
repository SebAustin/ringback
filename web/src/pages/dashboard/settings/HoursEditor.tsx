export interface DayWindow {
  open: string;
  close: string;
}

export type WeekHours = Record<string, DayWindow>;

interface HoursEditorProps {
  hours: WeekHours;
  onChange: (hours: WeekHours) => void;
}

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

export function HoursEditor({ hours, onChange }: HoursEditorProps) {
  const update = (day: string, patch: Partial<DayWindow>) => {
    const current = hours[day] ?? { open: '', close: '' };
    onChange({ ...hours, [day]: { ...current, ...patch } });
  };

  return (
    <section className="settings-section" aria-labelledby="hours-heading">
      <h2 id="hours-heading">Hours</h2>
      {DAYS.map((day) => {
        const window = hours[day.key] ?? { open: '', close: '' };
        return (
          <div className="repeatable-row" key={day.key}>
            <div className="field" style={{ flex: '0 0 8rem' }}>
              <label htmlFor={`hours-${day.key}-open`}>{day.label}</label>
              <input
                id={`hours-${day.key}-open`}
                type="time"
                value={window.open}
                onChange={(event) => update(day.key, { open: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`hours-${day.key}-close`}>Close</label>
              <input
                id={`hours-${day.key}-close`}
                type="time"
                value={window.close}
                onChange={(event) => update(day.key, { close: event.target.value })}
              />
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>Leave both fields blank for a closed day.</p>
    </section>
  );
}

export { DAYS as WEEK_DAYS };
