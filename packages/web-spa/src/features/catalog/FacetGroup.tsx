import { useId } from 'react';

export type FacetOption = { value: string; label: string; count: number; selected: boolean };

type FacetGroupProps = {
  legend: string;
  type: 'checkbox' | 'radio';
  options: readonly FacetOption[];
  onToggle: (value: string, checked: boolean) => void;
  anyLabel?: string;
  onClear?: () => void;
};

/** One facet dimension with result counts per choice. */
export function FacetGroup({ legend, type, options, onToggle, anyLabel, onClear }: FacetGroupProps) {
  const name = useId();
  const noneSelected = options.every((option) => !option.selected);
  return (
    <fieldset className="facet">
      <legend>{legend}</legend>
      {type === 'radio' && anyLabel && onClear ? (
        <label className="facet-option">
          <input type="radio" name={name} checked={noneSelected} onChange={onClear} />
          <span>{anyLabel}</span>
        </label>
      ) : null}
      {options.map((option) => (
        <label key={option.value} className="facet-option">
          <input
            type={type}
            name={name}
            value={option.value}
            checked={option.selected}
            onChange={(e) => onToggle(option.value, e.target.checked)}
          />
          <span>{option.label}</span>
          <span className="facet-count" aria-label={`${option.count} results`}>
            {option.count}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
