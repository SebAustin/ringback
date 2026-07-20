import type { TenantProfile } from '../../../types';

type Service = TenantProfile['services'][number];

interface ServicesEditorProps {
  services: Service[];
  onChange: (services: Service[]) => void;
}

const EMPTY_SERVICE: Service = { name: '', durationMin: 30, price: '' };

export function ServicesEditor({ services, onChange }: ServicesEditorProps) {
  const update = (index: number, patch: Partial<Service>) => {
    onChange(services.map((service, i) => (i === index ? { ...service, ...patch } : service)));
  };

  const remove = (index: number) => onChange(services.filter((_, i) => i !== index));
  const add = () => onChange([...services, { ...EMPTY_SERVICE }]);

  return (
    <section className="settings-section" aria-labelledby="services-heading">
      <h2 id="services-heading">Services</h2>
      {services.map((service, index) => (
        <div className="repeatable-row" key={index}>
          <div className="field">
            <label htmlFor={`service-name-${index}`}>Name</label>
            <input
              id={`service-name-${index}`}
              value={service.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
          </div>
          <div className="field" style={{ maxWidth: '8rem' }}>
            <label htmlFor={`service-duration-${index}`}>Minutes</label>
            <input
              id={`service-duration-${index}`}
              type="number"
              min={5}
              value={service.durationMin}
              onChange={(event) => update(index, { durationMin: Number(event.target.value) })}
            />
          </div>
          <div className="field" style={{ maxWidth: '8rem' }}>
            <label htmlFor={`service-price-${index}`}>Price</label>
            <input
              id={`service-price-${index}`}
              value={service.price ?? ''}
              onChange={(event) => update(index, { price: event.target.value })}
            />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(index)} aria-label={`Remove ${service.name || 'service'}`}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}>
        Add service
      </button>
    </section>
  );
}
