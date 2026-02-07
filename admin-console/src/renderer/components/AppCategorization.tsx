/**
 * App Categorization Page
 * 
 * Allows managers to categorize applications as productive, neutral, or distracting.
 * This powers the productivity metrics throughout the dashboard.
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only app names are shown (no window titles)
 * - Categorization is for productivity analysis, not surveillance
 */

import React, { useState, useEffect, useCallback } from 'react';
import { secondsToShort } from '../../shared/dashboard-types';

type AppCategory = 'productive' | 'neutral' | 'distracting';

interface AppUsageItem {
  app_name: string;
  total_seconds_today: number;
  total_seconds_7d: number;
  device_count: number;
  category: AppCategory;
}

interface AppCategorizationProps {
  onBack?: () => void;
}

export const AppCategorization: React.FC<AppCategorizationProps> = ({ onBack }) => {
  const [apps, setApps] = useState<AppUsageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AppCategory | 'all' | 'uncategorized'>('all');
  const [sortBy, setSortBy] = useState<'usage' | 'name'>('usage');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<AppCategory>('neutral');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    try {
      const data = await window.adminAPI.getAppUsageAggregates?.();
      setApps(data || []);
    } catch (error) {
      console.error('Failed to load app usage:', error);
      // Generate mock data for demo
      setApps(generateMockApps());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const handleCategoryChange = async (appName: string, category: AppCategory) => {
    try {
      await window.adminAPI.setAppCategory?.(appName, category);
      setApps(prev => prev.map(app => 
        app.app_name === appName ? { ...app, category } : app
      ));
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (error) {
      console.error('Failed to set category:', error);
      setSaveStatus('Failed to save');
    }
  };

  const handleBulkCategorize = async () => {
    if (selectedApps.size === 0) return;
    
    try {
      const updates = Array.from(selectedApps).map(appName => ({
        appName,
        category: bulkCategory,
      }));
      await window.adminAPI.setAppCategoriesBulk?.(updates);
      setApps(prev => prev.map(app => 
        selectedApps.has(app.app_name) ? { ...app, category: bulkCategory } : app
      ));
      setSelectedApps(new Set());
      setSaveStatus(`${updates.length} apps categorized`);
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (error) {
      console.error('Failed to bulk categorize:', error);
      setSaveStatus('Failed to save');
    }
  };

  const toggleAppSelection = (appName: string) => {
    setSelectedApps(prev => {
      const next = new Set(prev);
      if (next.has(appName)) {
        next.delete(appName);
      } else {
        next.add(appName);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedApps(new Set(filteredApps.map(a => a.app_name)));
  };

  const clearSelection = () => {
    setSelectedApps(new Set());
  };

  // Filter and sort apps
  const filteredApps = apps
    .filter(app => {
      if (searchQuery && !app.app_name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (categoryFilter === 'uncategorized') {
        return app.category === 'neutral';
      }
      if (categoryFilter !== 'all' && app.category !== categoryFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'usage') {
        return b.total_seconds_7d - a.total_seconds_7d;
      }
      return a.app_name.localeCompare(b.app_name);
    });

  // Calculate stats
  const stats = {
    total: apps.length,
    productive: apps.filter(a => a.category === 'productive').length,
    neutral: apps.filter(a => a.category === 'neutral').length,
    distracting: apps.filter(a => a.category === 'distracting').length,
    productiveTime: apps.filter(a => a.category === 'productive').reduce((sum, a) => sum + a.total_seconds_today, 0),
    distractingTime: apps.filter(a => a.category === 'distracting').reduce((sum, a) => sum + a.total_seconds_today, 0),
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div>Loading app usage data...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          {onBack && (
            <button onClick={onBack} style={backButtonStyle}>← Back</button>
          )}
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 4px 0' }}>App Categorization</h1>
          <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
            Categorize applications to enable productivity metrics across the dashboard.
          </p>
        </div>
        {saveStatus && (
          <div style={{
            padding: '8px 16px',
            borderRadius: '6px',
            backgroundColor: saveStatus.includes('Failed') ? '#ffebee' : '#e8f5e9',
            color: saveStatus.includes('Failed') ? '#c62828' : '#2e7d32',
            fontSize: '13px',
          }}>
            {saveStatus}
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Total Apps" value={stats.total} color="#666" />
        <StatCard label="Productive" value={stats.productive} color="#4CAF50" />
        <StatCard label="Neutral" value={stats.neutral} color="#9e9e9e" />
        <StatCard label="Distracting" value={stats.distracting} color="#f44336" />
        <StatCard 
          label="Productivity Today" 
          value={stats.productiveTime + stats.distractingTime > 0 
            ? `${Math.round(stats.productiveTime / (stats.productiveTime + stats.distractingTime) * 100)}%`
            : '—'
          } 
          color="#1976d2" 
        />
      </div>

      {/* Filters and Bulk Actions */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Search */}
          <input
            type="text"
            placeholder="Search apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={inputStyle}
          />
          
          {/* Category Filter */}
          <select 
            value={categoryFilter} 
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            style={selectStyle}
          >
            <option value="all">All Categories</option>
            <option value="uncategorized">Uncategorized</option>
            <option value="productive">Productive</option>
            <option value="neutral">Neutral</option>
            <option value="distracting">Distracting</option>
          </select>
          
          {/* Sort */}
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as any)}
            style={selectStyle}
          >
            <option value="usage">Sort by Usage</option>
            <option value="name">Sort by Name</option>
          </select>
          
          <div style={{ flex: 1 }} />
          
          {/* Bulk Actions */}
          {selectedApps.size > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#666' }}>{selectedApps.size} selected</span>
              <select 
                value={bulkCategory} 
                onChange={(e) => setBulkCategory(e.target.value as AppCategory)}
                style={selectStyle}
              >
                <option value="productive">Productive</option>
                <option value="neutral">Neutral</option>
                <option value="distracting">Distracting</option>
              </select>
              <button onClick={handleBulkCategorize} style={primaryButtonStyle}>
                Apply to Selected
              </button>
              <button onClick={clearSelection} style={secondaryButtonStyle}>
                Clear
              </button>
            </div>
          )}
          
          {selectedApps.size === 0 && (
            <button onClick={selectAll} style={secondaryButtonStyle}>
              Select All ({filteredApps.length})
            </button>
          )}
        </div>
      </div>

      {/* Apps Table */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      }}>
        {filteredApps.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            {apps.length === 0 
              ? 'No app usage data yet. Apps will appear here as devices report activity.'
              : 'No apps match your filters.'
            }
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee', backgroundColor: '#fafafa' }}>
                <th style={{ ...thStyle, width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedApps.size === filteredApps.length && filteredApps.length > 0}
                    onChange={() => selectedApps.size === filteredApps.length ? clearSelection() : selectAll()}
                  />
                </th>
                <th style={thStyle}>Application</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Today</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>7 Days</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Devices</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '200px' }}>Category</th>
              </tr>
            </thead>
            <tbody>
              {filteredApps.map((app) => (
                <tr 
                  key={app.app_name}
                  style={{ 
                    borderBottom: '1px solid #f0f0f0',
                    backgroundColor: selectedApps.has(app.app_name) ? '#e3f2fd' : 'transparent',
                  }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <input
                      type="checkbox"
                      checked={selectedApps.has(app.app_name)}
                      onChange={() => toggleAppSelection(app.app_name)}
                    />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500 }}>{app.app_name}</div>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {secondsToShort(app.total_seconds_today)}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {secondsToShort(app.total_seconds_7d)}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#666' }}>
                    {app.device_count}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <CategorySelector
                      value={app.category}
                      onChange={(cat) => handleCategoryChange(app.app_name, cat)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// Category Selector Component
const CategorySelector: React.FC<{
  value: AppCategory;
  onChange: (category: AppCategory) => void;
}> = ({ value, onChange }) => {
  const categories: Array<{ value: AppCategory; label: string; color: string; bgColor: string }> = [
    { value: 'productive', label: '✓ Productive', color: '#2e7d32', bgColor: '#e8f5e9' },
    { value: 'neutral', label: '○ Neutral', color: '#666', bgColor: '#f5f5f5' },
    { value: 'distracting', label: '✗ Distracting', color: '#c62828', bgColor: '#ffebee' },
  ];
  
  return (
    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
      {categories.map((cat) => (
        <button
          key={cat.value}
          onClick={() => onChange(cat.value)}
          style={{
            padding: '4px 10px',
            borderRadius: '12px',
            border: value === cat.value ? `2px solid ${cat.color}` : '2px solid transparent',
            backgroundColor: value === cat.value ? cat.bgColor : '#f5f5f5',
            color: value === cat.value ? cat.color : '#999',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: value === cat.value ? 600 : 400,
            transition: 'all 0.15s ease',
          }}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{ label: string; value: string | number; color: string }> = ({ label, value, color }) => (
  <div style={{
    backgroundColor: 'white',
    borderRadius: '10px',
    padding: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    textAlign: 'center',
  }}>
    <div style={{ fontSize: '24px', fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>{label}</div>
  </div>
);

// Mock data generator for demo
function generateMockApps(): AppUsageItem[] {
  const commonApps = [
    { name: 'Visual Studio Code', category: 'productive' as AppCategory },
    { name: 'Chrome', category: 'neutral' as AppCategory },
    { name: 'Slack', category: 'neutral' as AppCategory },
    { name: 'Microsoft Teams', category: 'productive' as AppCategory },
    { name: 'Outlook', category: 'productive' as AppCategory },
    { name: 'YouTube', category: 'distracting' as AppCategory },
    { name: 'Discord', category: 'distracting' as AppCategory },
    { name: 'Spotify', category: 'neutral' as AppCategory },
    { name: 'Terminal', category: 'productive' as AppCategory },
    { name: 'Figma', category: 'productive' as AppCategory },
    { name: 'Twitter', category: 'distracting' as AppCategory },
    { name: 'Reddit', category: 'distracting' as AppCategory },
    { name: 'Notion', category: 'productive' as AppCategory },
    { name: 'Excel', category: 'productive' as AppCategory },
    { name: 'Word', category: 'productive' as AppCategory },
  ];
  
  return commonApps.map(app => ({
    app_name: app.name,
    total_seconds_today: Math.floor(Math.random() * 7200),
    total_seconds_7d: Math.floor(Math.random() * 36000),
    device_count: Math.floor(Math.random() * 5) + 1,
    category: app.category,
  }));
}

// Styles
const backButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: 'transparent',
  border: '1px solid #ddd',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  marginBottom: '16px',
  marginRight: '16px',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #ddd',
  fontSize: '13px',
  width: '200px',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #ddd',
  fontSize: '13px',
  backgroundColor: 'white',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#1976d2',
  color: 'white',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid #ddd',
  backgroundColor: 'white',
  color: '#333',
  cursor: 'pointer',
  fontSize: '13px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: '12px',
  color: '#666',
  fontWeight: 600,
};

export default AppCategorization;
