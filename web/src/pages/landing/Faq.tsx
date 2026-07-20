const FAQS = [
  {
    q: 'Does this replace my phone system?',
    a: "No — you keep your number. RingBack just catches calls that go unanswered and follows up by text within seconds.",
  },
  {
    q: 'What if the AI can\'t answer something?',
    a: 'It escalates to you and you can take over the text thread directly from the dashboard. The AI pauses the moment you reply.',
  },
  {
    q: 'Can callers opt out?',
    a: 'Yes. Every conversation honors STOP, and we follow carrier messaging compliance out of the box.',
  },
  {
    q: 'How is this different from a chatbot widget?',
    a: "There's no app, no widget, no download. It meets callers exactly where they already are — SMS.",
  },
];

export function Faq() {
  return (
    <section className="section" aria-labelledby="faq-heading">
      <div className="section-heading">
        <h2 id="faq-heading">Questions</h2>
      </div>
      <div className="faq-list">
        {FAQS.map((item) => (
          <details className="faq-item" key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
