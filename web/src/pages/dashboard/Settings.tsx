import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { getTenant, updateTenant } from '../../api';
import { useToast } from '../../components/Toast';
import { Skeleton } from '../../components/Skeleton';
import { ServicesEditor } from './settings/ServicesEditor';
import { FaqsEditor } from './settings/FaqsEditor';
import { HoursEditor, WEEK_DAYS } from './settings/HoursEditor';
import type { WeekHours } from './settings/HoursEditor';
import type { Tenant, TenantProfile } from '../../types';

function toWeekHours(hours: TenantProfile['hours']): WeekHours {
  const result: WeekHours = {};
  for (const day of WEEK_DAYS) {
    const windows = hours[day.key];
    const first = windows?.[0];
    result[day.key] = { open: first?.[0] ?? '', close: first?.[1] ?? '' };
  }
  return result;
}

function fromWeekHours(weekHours: WeekHours): TenantProfile['hours'] {
  const result: TenantProfile['hours'] = {};
  for (const day of WEEK_DAYS) {
    const window = weekHours[day.key];
    result[day.key] = window && window.open && window.close ? [[window.open, window.close]] : [];
  }
  return result;
}

export function Settings() {
  const { showToast } = useToast();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [forwardPhone, setForwardPhone] = useState('');
  const [services, setServices] = useState<TenantProfile['services']>([]);
  const [faqs, setFaqs] = useState<TenantProfile['faqs']>([]);
  const [weekHours, setWeekHours] = useState<WeekHours>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTenant()
      .then((res) => {
        if (cancelled) return;
        setTenant(res);
        setName(res.name);
        setForwardPhone(res.forwardPhone ?? '');
        setServices(res.profile.services);
        setFaqs(res.profile.faqs);
        setWeekHours(toWeekHours(res.profile.hours));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load business profile.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenant) return;
    setSaving(true);
    try {
      const updated = await updateTenant({
        name,
        forwardPhone: forwardPhone || undefined,
        profile: {
          ...tenant.profile,
          services,
          faqs,
          hours: fromWeekHours(weekHours),
        },
      });
      setTenant(updated);
      showToast('Settings saved.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div>
        <Skeleton height="1.5rem" width="10rem" />
        <div style={{ marginTop: '1rem' }}>
          <Skeleton height="16rem" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="dashboard-header">
        <h1>Business settings</h1>
      </div>
      <form onSubmit={handleSave}>
        <section className="settings-section" aria-labelledby="profile-heading">
          <h2 id="profile-heading">Business profile</h2>
          <div className="repeatable-row">
            <div className="field">
              <label htmlFor="settings-name">Business name</label>
              <input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="settings-forward">Forwarding phone</label>
              <input
                id="settings-forward"
                value={forwardPhone}
                onChange={(event) => setForwardPhone(event.target.value)}
                placeholder="+15551234567"
              />
            </div>
          </div>
        </section>

        <ServicesEditor services={services} onChange={setServices} />
        <FaqsEditor faqs={faqs} onChange={setFaqs} />
        <HoursEditor hours={weekHours} onChange={setWeekHours} />

        <button type="submit" className="btn btn-accent" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </>
  );
}
