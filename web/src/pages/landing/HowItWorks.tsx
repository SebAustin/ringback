const STEPS = [
  {
    title: 'We catch the miss',
    body: 'Forward your business line to RingBack. When a call goes unanswered, we know within seconds.',
  },
  {
    title: 'The AI texts back',
    body: 'A Gemini-powered receptionist replies by SMS, answers questions from your FAQs and hours, and qualifies the caller.',
  },
  {
    title: 'It books the job',
    body: 'If it fits your calendar policy, RingBack books the appointment and notifies you — no app for the caller to download.',
  },
];

export function HowItWorks() {
  return (
    <section className="section" aria-labelledby="how-heading">
      <div className="section-heading">
        <h2 id="how-heading">How it works</h2>
        <span className="section-kicker">Three moves, five seconds</span>
      </div>
      <ol className="steps">
        {STEPS.map((step, index) => (
          <li className="step" key={step.title}>
            <span className="step-number" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
