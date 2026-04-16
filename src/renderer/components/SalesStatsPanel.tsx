import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSales,
  SalesRange,
  SalesResponse,
  SalesTicket,
} from '../services/slack-sales-service';

// (SalesTicket is re-used in TicketCard below.)

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
    // floor so a 36s-old ticket isn't rounded up to "1m ago"
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
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
            <TicketCard key={i} ticket={t} fallbackCurrency={currency} />
          ))
        )}
      </div>
    </div>
  );
};

interface TicketCardProps {
  ticket: SalesTicket;
  fallbackCurrency: string;
}

const MetaChip: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
    <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </span>
    <span style={{ fontSize: '12px', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {value}
    </span>
  </div>
);

const TicketCard: React.FC<TicketCardProps> = ({ ticket, fallbackCurrency }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(ticket.whatTheyWanted || ticket.notes || ticket.objectionsOrBlockers || ticket.contact || ticket.clientBudget);

  const amountStr = ticket.amount != null
    ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: ticket.currency || fallbackCurrency,
        maximumFractionDigits: 0,
      }).format(ticket.amount)
    : null;

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid #f1f5f9',
        marginBottom: '6px',
        background: '#fff',
      }}
    >
      {/* Header: client name + outcome badge + amount */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <a
          href={ticket.permalink ?? '#'}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { if (!ticket.permalink) e.preventDefault(); }}
          style={{
            fontWeight: 600, color: '#111827', textDecoration: 'none',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {ticket.client || '—'}
        </a>
        <span
          style={{
            fontSize: '10px', fontWeight: 700, padding: '2px 8px',
            borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.04em',
            background: ticket.outcome === 'won' ? '#dcfce7' : '#fee2e2',
            color: ticket.outcome === 'won' ? '#166534' : '#991b1b',
          }}
        >
          {ticket.outcome}
        </span>
        {amountStr && (
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap' }}>
            {amountStr}
          </span>
        )}
      </div>

      {/* Meta line: destination · travel dates · travelers · date ago */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px' }}>
        {ticket.destination && <MetaChip label="Dest" value={ticket.destination} />}
        {ticket.travelDates && <MetaChip label="When" value={ticket.travelDates} />}
        {ticket.travelers && <MetaChip label="Pax" value={ticket.travelers} />}
        <MetaChip label="" value={<span style={{ color: '#9ca3af' }}>{fmtRelative(ticket.resolvedAt)}</span>} />
      </div>

      {/* Expandable detail */}
      {hasDetails && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: '6px', padding: 0, background: 'none', border: 'none',
              color: '#4a90d9', fontSize: '11px', cursor: 'pointer',
            }}
          >
            {expanded ? 'Hide details ▴' : 'Show details ▾'}
          </button>
          {expanded && (
            <div style={{ marginTop: '6px', padding: '8px 10px', background: '#f9fafb', borderRadius: '6px', fontSize: '12px', color: '#374151', lineHeight: 1.5 }}>
              {ticket.whatTheyWanted && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>What they wanted</div>
                  <div>{ticket.whatTheyWanted}</div>
                </div>
              )}
              {ticket.objectionsOrBlockers && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Objections / blockers</div>
                  <div>{ticket.objectionsOrBlockers}</div>
                </div>
              )}
              {ticket.notes && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{ticket.notes}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {ticket.contact && <MetaChip label="Contact" value={ticket.contact} />}
                {ticket.clientBudget && <MetaChip label="Budget" value={ticket.clientBudget} />}
                {ticket.caseDate && <MetaChip label="Case date" value={ticket.caseDate} />}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SalesStatsPanel;
