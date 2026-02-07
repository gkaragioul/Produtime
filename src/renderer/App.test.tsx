import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

// Mock heavy child components to keep this test focused and stable
jest.mock('./components/ActivityDashboard', () => ({
  ActivityDashboard: () => (
    <div data-testid="activity-dashboard">Activity Dashboard</div>
  ),
}));

jest.mock('./components/SettingsTab', () => ({
  SettingsTab: () => <div data-testid="settings-tab">Settings Tab</div>,
}));

describe('App Component', () => {
  test('renders app title and tab navigation', () => {
    render(<App />);
    expect(screen.getByText('AtlianFlow.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dashboard' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Settings' })
    ).toBeInTheDocument();
  });

  test('switches between Dashboard and Settings tabs', () => {
    render(<App />);

    const dashboard = screen.getByTestId('activity-dashboard');
    const settings = screen.getByTestId('settings-tab');

    // Default tab is Dashboard
    expect(dashboard).toBeVisible();

    // Switch to Settings
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(settings).toBeVisible();
  });
});
