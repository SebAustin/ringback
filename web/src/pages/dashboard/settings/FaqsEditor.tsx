import type { TenantProfile } from '../../../types';

type Faq = TenantProfile['faqs'][number];

interface FaqsEditorProps {
  faqs: Faq[];
  onChange: (faqs: Faq[]) => void;
}

export function FaqsEditor({ faqs, onChange }: FaqsEditorProps) {
  const update = (index: number, patch: Partial<Faq>) => {
    onChange(faqs.map((faq, i) => (i === index ? { ...faq, ...patch } : faq)));
  };

  const remove = (index: number) => onChange(faqs.filter((_, i) => i !== index));
  const add = () => onChange([...faqs, { q: '', a: '' }]);

  return (
    <section className="settings-section" aria-labelledby="faqs-heading">
      <h2 id="faqs-heading">FAQs</h2>
      {faqs.map((faq, index) => (
        <div className="repeatable-row" key={index}>
          <div className="field">
            <label htmlFor={`faq-q-${index}`}>Question</label>
            <input id={`faq-q-${index}`} value={faq.q} onChange={(event) => update(index, { q: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`faq-a-${index}`}>Answer</label>
            <input id={`faq-a-${index}`} value={faq.a} onChange={(event) => update(index, { a: event.target.value })} />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(index)} aria-label={`Remove FAQ ${index + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}>
        Add FAQ
      </button>
    </section>
  );
}
