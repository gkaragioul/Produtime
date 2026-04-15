import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSales,
  SalesRange,
  SalesResponse,
  SalesTicket,
} from '../services/slack-sales-service';

const RANGES: { key: SalesRange; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const fmtCurrency = (value: number, currency?: string | null): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value}${currency ? ` ${currency}` : ''}`;
  }
};

const fmtRelative = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
};

export const SalesStatsPanel: React.FC = () => {
  const [range, setRange] = useState<SalesRange>('day');
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<any>(null);

  const load = useCallback(async (r: SalesRange) => {
    setLoading(true);
    try {
      const resp = await fetchSales(r);
      setData(resp);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => load(range), 5 * 60_000);
    const onVis = () => {
      if (!document.hidden) load(range);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [range, load]);

  const containerStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    minHeight: '340px',
    display: 'flex',
    flexDirection: 'column',
  };

  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#333', margin: 0 }}>Sales</h3>
      <div style={{
        display: 'inline-flex', gap: '4px', padding: '4px',
        background: '#f2f4f7', borderRadius: '999px',
      }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 500,
              borderRadius: '999px',
              border: 'none',
              cursor: 'pointer',
              background: r.key === range ? '#fff' : 'transparent',
              color: r.key === range ? '#1f2937' : '#6b7280',
              boxShadow: r.key === range ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (!data && loading) {
    return (
      <div style={containerStyle}>
        {header}
        <div style={{ color: '#999', padding: '24px 0', textAlign: 'center' }}>Loading sales...</div>
      </div>
    );
  }

  if (data?.unconfigured) {
    return (
      <div style={containerStyle}>
        {header}
        <div style={{ color: '#6b7280', padding: '24px 8px', textAlign: 'center', fontSize: '14px' }}>
          Ask your admin to link your Slack account.
        </div>
      </div>
    );
  }

  if (data?.unavailable) {
    return (
      <div style={containerStyle}>
        {header}
        <div style={{ color: '#6b7280', padding: '24px 8px', textAlign: 'center', fontSize: '14px' }}>
          Sales data unavailable.
          <div style={{ marginTop: '12px' }}>
            <button
              onClick={() => load(range)}
              style={{
                padding: '6px 16px', borderRadius: '6px', border: '1px solid #4a90d9',
                background: 'white', color: '#4a90d9', cursor: 'pointer', fontSize: '13px',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const counters = data?.counters ?? { wins: 0, losses: 0, winRate: 0, totalAmount: 0, currency: null };
  const recent: SalesTicket[] = data?.recent ?? [];
  const currency = counters.currency ?? 'EUR';

  const stat = (label: string, value: string, accent?: string) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div style={{
        fontSize: '22px', fontWeight: 700, color: accent ?? '#111827',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>
        {label}
      </div>
    </div>
  );

  return (
    <div style={containerStyle}>
      {header}

      <div style={{
        display: 'flex', gap: '8px', padding: '12px 8px',
        background: '#f9fafb', borderRadius: '8px', marginBottom: '16px',
      }}>
        {stat('Wins', String(counters.wins), '#16a34a')}
        {stat('Losses', String(counters.losses), '#dc2626')}
        {stat('Win rate', counters.wins + counters.losses === 0 ? '—' : `${Math.round((counters.winRate ?? 0) * 100)}%`)}
        {stat('Total won', fmtCurrency(counters.totalAmount || 0, currency))}
      </div>

      <div style={{
        fontSize: '12px', color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: '0.04em', marginBottom: '8px', fontWeight: 600,
      }}>
        Recent tickets
      </div>

      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '420px' }}>
        {recent.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: '13px', padding: '16px 0', textAlign: 'center' }}>
            No tickets in this range.
          </div>
        ) : (
          recent.map((t, i) => (
            <a
              key={i}
              href={t.permalink ?? '#'}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => { if (!t.permalink) e.preventDefault(); }}
              style={{
                display: 'block',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #f1f5f9',
                marginBottom: '6px',
                textDecoration: 'none',
                color: 'inherit',
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 500, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.client || '—'}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    background: t.outcome === 'won' ? '#dcfce7' : '#fee2e2',
                    color: t.outcome === 'won' ? '#166534' : '#991b1b',
                  }}
                >
                  {t.outcome}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', fontSize: '12px', color: '#6b7280' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.destination || ''}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {t.amount != null ? fmtCurrency(t.amount, t.currency ?? currency) : ''}
                  <span style={{ color: '#9ca3af', marginLeft: '8px' }}>{fmtRelative(t.resolvedAt)}</span>
                </span>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
};

export default SalesStatsPanel;
