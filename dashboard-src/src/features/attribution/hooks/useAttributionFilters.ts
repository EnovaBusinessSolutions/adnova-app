import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AttributionModel, RangePreset } from '../types';

const VALID_MODELS: AttributionModel[] = [
  'last_touch', 'first_touch', 'linear',
];
const VALID_RANGES: RangePreset[] = [7, 14, 30, 90];

function parseModel(raw: string | null): AttributionModel {
  return VALID_MODELS.includes(raw as AttributionModel) ? (raw as AttributionModel) : 'last_touch';
}

function parseRange(raw: string | null): RangePreset | 'custom' {
  if (raw === 'custom') return 'custom';
  const n = Number(raw);
  return VALID_RANGES.includes(n as RangePreset) ? (n as RangePreset) : 30;
}

export function useAttributionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const model = parseModel(searchParams.get('model'));
  const range = parseRange(searchParams.get('range'));
  const start = searchParams.get('start') ?? undefined;
  const end = searchParams.get('end') ?? undefined;

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value != null) n.set(key, value);
          else n.delete(key);
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setModel = useCallback((m: AttributionModel) => setParam('model', m), [setParam]);

  const setRange = useCallback(
    (r: RangePreset | 'custom') => {
      setParam('range', String(r));
      if (r !== 'custom') {
        setParam('start', null);
        setParam('end', null);
      }
    },
    [setParam],
  );

  const setStart = useCallback((s: string | null) => setParam('start', s), [setParam]);
  const setEnd = useCallback((e: string | null) => setParam('end', e), [setParam]);

  return { model, range, start, end, setModel, setRange, setStart, setEnd };
}
