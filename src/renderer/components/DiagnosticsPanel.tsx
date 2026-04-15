import React, { useCallback, useEffect, useMemo, useState } from 'react';

type LevelFilter = 'all' | 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const LEVELS: { key: LevelFilter; label: string }[] = [
  { key: 'all', label: 'All levels' },
  { key: 'INFO', label: 'Info' },
  { key: 'WARN', label: 'Warnings' },
  { key: 'ERROR', label: 'Errors' },
  { key: 'DEBUG', label: 'Debug' },
];

const MAX_LINES = 500;

export const DiagnosticsPanel: React.FC = () => {
  const [raw, setRaw] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.logsGetTail(MAX_LINES);
      if (res?.success) setRaw(res.data || '');
      else setError(res?.error || 'Failed to read log file.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const lines = raw.split('\n');
    return lines.filter((ln) => {
      if (level !== 'all' && !ln.includes(`[${level.padEnd(5)}]`)) return false;
      if (search && !ln.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).join('\n');
  }, [raw, level, search]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filtered || raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard write failed.');
    }
  };

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.logsOpenFolder();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear the current log file? This cannot be undone.')) return;
    setClearing(true);
    try {
      const res = await window.electronAPI.logsClear();
      if (res?.success) {
        await load();
      } else {
        setError(res?.error || 'Failed to clear log.');
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="settings-section">
      <h3>Diagnostics</h3>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
        Live tail of the current session's log file. Copy all and paste into a
        bug report when something breaks.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as LevelFilter)}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd' }}
        >
          {LEVELS.map((l) => (
            <option key={l.key} value={l.key}>{l.label}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter text..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '160px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd' }}
        />

        <button onClick={load} disabled={loading} style={btn('#4a90d9')}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button onClick={handleCopy} disabled={!raw} style={btn('#16a34a')}>
          {copied ? 'Copied!' : 'Copy all'}
        </button>
        <button onClick={handleOpenFolder} style={btnOutline('#4a90d9')}>
          Open folder
        </button>
        <button onClick={handleClear} disabled={clearing} style={btn('#dc2626')}>
          {clearing ? 'Clearing…' : 'Clear'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '12px', color: '#c0392b', marginBottom: '8px' }}>
          {error}
        </div>
      )}

      <pre
        style={{
          background: '#0f172a', color: '#e2e8f0', padding: '12px',
          borderRadius: '8px', maxHeight: '360px', overflow: 'auto',
          fontSize: '11px', lineHeight: 1.45, margin: 0,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}
      >
        {filtered || (loading ? 'Loading…' : 'No log entries match.')}
      </pre>

      <div style={{ fontSize: '11px', color: '#999', marginTop: '6px' }}>
        Showing last {MAX_LINES} lines of the current session. Older logs live in
        the logs folder.
      </div>
    </div>
  );
};

const btn = (color: string): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: '6px',
  border: 'none',
  background: color,
  color: 'white',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
});

const btnOutline = (color: string): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: '6px',
  border: `1px solid ${color}`,
  background: 'white',
  color,
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
});

export default DiagnosticsPanel;
