import { useEffect, useState } from 'react';
import { getAppointments } from '../../api';
import { Skeleton } from '../../components/Skeleton';
import { StatusChip } from '../../components/StatusChip';
import { formatDateTime } from '../../lib/time';
import type { Appointment } from '../../types';

export function Appointments() {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppointments()
      .then((res) => {
        if (!cancelled) setAppointments(res.appointments);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load appointments.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="dashboard-header">
        <h1>Appointments</h1>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : !appointments ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
        </div>
      ) : appointments.length === 0 ? (
        <div className="empty-state">
          <h3>No appointments yet</h3>
          <p>Once the AI books a job, it will show up here with the caller and time.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Caller</th>
              <th scope="col">Service</th>
              <th scope="col">Starts</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((appointment) => (
              <tr key={appointment.id}>
                <td>{appointment.callerName}</td>
                <td>{appointment.service}</td>
                <td>{formatDateTime(appointment.startsAt)}</td>
                <td>
                  <StatusChip status={appointment.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
