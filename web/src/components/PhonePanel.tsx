import './PhonePanel.css';
import type { ReactNode } from 'react';

interface PhonePanelProps {
  contactName: string;
  contactMeta?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Pure-CSS phone chrome used to frame an SMS thread. */
export function PhonePanel({ contactName, contactMeta, children, footer }: PhonePanelProps) {
  return (
    <div className="phone-panel">
      <div className="phone-panel-screen">
        <div className="phone-panel-notch" aria-hidden="true" />
        <div className="phone-panel-header">
          <div className="contact-name">{contactName}</div>
          {contactMeta ? <div className="contact-meta">{contactMeta}</div> : null}
        </div>
        <div className="phone-panel-thread" aria-live="polite">
          {children}
        </div>
        {footer}
      </div>
    </div>
  );
}
