const AGENTS = [
  { name: 'receptionist', role: 'answers every missed call by SMS' },
  { name: 'onboarding', role: 'sets up new tenants end to end' },
  { name: 'support', role: 'handles owner questions & edge cases' },
  { name: 'prospector', role: 'finds businesses that need this' },
  { name: 'cfo', role: 'writes the weekly financial report' },
  { name: 'watchdog', role: 'monitors uptime & quality' },
  { name: 'qa', role: 'grades every conversation' },
];

export function AgentsStrip() {
  return (
    <section className="agents-strip" aria-labelledby="agents-heading">
      <div className="agents-strip-inner">
        <span className="agents-strip-label" id="agents-heading">
          Run by seven AI agents
        </span>
        <ul className="agents-strip-list">
          {AGENTS.map((agent) => (
            <li key={agent.name} title={agent.role}>
              {agent.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
