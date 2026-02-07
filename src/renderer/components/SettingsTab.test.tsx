import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { SettingsTab } from './SettingsTab';

function setupIPC(overrides: Partial<any> = {}) {
  const api = {
    getAllSettings: jest.fn(async () => ({
      success: true,
      data: [
        { key: 'work_schedule_start', value: '08:30' },
        { key: 'work_schedule_end', value: '17:15' },
        { key: 'export_folder', value: 'C:/Reports' },
        { key: 'idle_threshold', value: '600' },
        { key: 'employee_name', value: 'Jane Tester' },
        { key: 'admin_alert_email', value: 'alerts@example.com' },
        { key: 'auto_export_enabled', value: 'true' },
        { key: 'auto_export_time', value: '19:00' },
        {
          key: 'work_schedule_weekly',
          value: JSON.stringify({ monday: { start: '08:30', end: '17:15' } }),
        },
      ],
    })),
    setSetting: jest.fn(async (_req: any) => ({ success: true })),
    selectExportFolder: jest.fn(async () => ({
      success: true,
      data: 'D:/Exports',
    })),
    // required by other parts of app/services
    getActivityLogsByDate: jest.fn(async () => ({ success: true, data: [] })),
    getDbHealth: jest.fn(async () => ({ success: true, data: true })),
  } as any;
  if (!(window as any).electronAPI) {
    (window as any).electronAPI = {} as any;
  }
  Object.assign((window as any).electronAPI, api, overrides);
  // Make AdminAuthService think we are already authenticated for these tests
  sessionStorage.setItem('admin_authenticated', 'true');
  sessionStorage.setItem('admin_auth_token', 'token');
  sessionStorage.setItem('admin_auth_time', new Date().toISOString());
  return (window as any).electronAPI;
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  sessionStorage.clear();
});

describe('SettingsTab (RED)', () => {
  test('loads settings from IPC and renders core fields', async () => {
    setupIPC();
    render(<SettingsTab />);
    // Should auto-load on mount due to stored admin auth
    expect(await screen.findByDisplayValue('08:30')).toBeInTheDocument();
    expect(screen.getByDisplayValue('17:15')).toBeInTheDocument();
    expect(screen.getByDisplayValue('C:/Reports')).toBeInTheDocument();
    expect(screen.getByDisplayValue('600')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jane Tester')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alerts@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('19:00')).toBeInTheDocument();
  });

  test('auto-saves after edits and shows success feedback', async () => {
    const api = setupIPC();
    render(<SettingsTab />);
    const nameInput = await screen.findByLabelText(/Employee Name/i);
    fireEvent.change(nameInput, { target: { value: 'John Smith' } });
    // Debounce 500ms in component
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(api.setSetting).toHaveBeenCalledWith({
      key: 'employee_name',
      value: 'John Smith',
    });
    // Shows success message
    expect(
      screen.getByText(/Employee Name updated successfully/i)
    ).toBeInTheDocument();
  });

  test('validation prevents save and shows error for invalid idle threshold', async () => {
    const api = setupIPC();
    render(<SettingsTab />);
    const idleInput = await screen.findByLabelText(/Idle Threshold/i);
    fireEvent.change(idleInput, { target: { value: '10' } }); // below min 30
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    // Should NOT call setSetting
    expect(api.setSetting).not.toHaveBeenCalledWith({
      key: 'idle_threshold',
      value: '10',
    });
    // Error text visible near field (allow either generic min or custom seconds wording)
    expect(
      screen.getByText(/Idle threshold must be at least 30/i)
    ).toBeInTheDocument();
  });

  test('handles IPC save error with field error feedback', async () => {
    const api = setupIPC({
      setSetting: jest.fn(async () => ({
        success: false,
        error: 'DB write failed',
      })),
    });
    render(<SettingsTab />);
    // Ensure initial load has completed to avoid state overwrite
    await screen.findByDisplayValue('C:/Reports');

    const folder = screen.getByLabelText(/Export Folder/i);
    fireEvent.change(folder, { target: { value: 'X:<>/bad' } });
    // First, invalid chars trigger validation error
    expect(
      await screen.findByText(/Folder path contains invalid characters/i)
    ).toBeInTheDocument();

    // Now set valid path and attempt to save to hit IPC error
    fireEvent.change(folder, { target: { value: 'D:/Good' } });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    // Give microtasks a tick to resolve async IPC wrapper
    await act(async () => {});
    // Assert user-facing error feedback instead of internal spy coupling
    expect(screen.getByText(/Failed to save:/i)).toBeInTheDocument();
  });

  test('work schedule start/end validation enforces end after start', async () => {
    setupIPC();
    render(<SettingsTab />);
    const start = await screen.findByLabelText(/^Start$/i);
    const end = screen.getByLabelText(/^End$/i);

    fireEvent.change(start, { target: { value: '17:00' } });
    fireEvent.change(end, { target: { value: '16:00' } });
    // Cross-field validation should show error
    expect(
      await screen.findByText(/End time must be after start time/i)
    ).toBeInTheDocument();
  });

  test('select export folder through IPC helper and auto-save', async () => {
    const api = setupIPC();
    render(<SettingsTab />);
    // Ensure initial load completed to avoid race with loadSettings
    await screen.findByDisplayValue('C:/Reports');
    const browseBtn = await screen.findByRole('button', { name: /Browse/i });
    fireEvent.click(browseBtn);
    // Wait for selection and debounce
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await screen.findByDisplayValue('D:/Exports');
    expect(screen.getByDisplayValue('D:/Exports')).toBeInTheDocument();
    // Success toast confirms the auto-save path executed
    expect(
      await screen.findByText(/Export Folder updated successfully/i)
    ).toBeInTheDocument();
  });
});

test('auto export toggle/time reconfigures scheduler via IPC (RED)', async () => {
  const api = setupIPC({
    reconfigureScheduler: jest.fn(async () => ({ success: true })),
  });
  render(<SettingsTab />);
  // Wait initial load
  await screen.findByDisplayValue('19:00');

  // Disable then enable auto export to ensure trigger on both transitions
  const enableCheckbox = screen.getByLabelText(/Enable/i);
  // currently checked (true)
  fireEvent.click(enableCheckbox); // set to false
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  fireEvent.click(enableCheckbox); // back to true
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Change time as well
  const timeInput = screen.getByDisplayValue('19:00');
  fireEvent.change(timeInput, { target: { value: '20:30' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Expect scheduler reconfigure to be called with latest values
  expect(api.reconfigureScheduler).toHaveBeenCalled();
});

test('weekly schedule change persists as JSON (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);
  // Expand weekly schedule
  const header = screen.getByRole('button', { name: /Daily Work Hours/i });
  fireEvent.click(header);

  // Toggle first 'Non-working' checkbox to force a weekly save
  const nonWorking = await screen.findAllByLabelText(/Non-working/i);
  fireEvent.click(nonWorking[0]);

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Find the setSetting call for weekly schedule
  const calls = (api.setSetting as jest.Mock).mock.calls;
  const weeklyCall = calls
    .reverse()
    .find(([arg]) => arg.key === 'work_schedule_weekly');
  expect(weeklyCall).toBeTruthy();
  const json = JSON.parse(weeklyCall[0].value);
  expect(json.monday).toBeTruthy();
  expect(typeof json.monday.nonWorking).toBe('boolean');
});

test('employee_name validation rejects invalid characters and sets aria-invalid (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);

  const input = await screen.findByLabelText(/Employee Name/i);
  fireEvent.change(input, { target: { value: 'Jane123' } });

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Should not save invalid value
  expect(api.setSetting).not.toHaveBeenCalledWith({
    key: 'employee_name',
    value: 'Jane123',
  });
  // Error visible and aria-invalid on the field
  expect(
    screen.getByText(/Employee name can only contain/i)
  ).toBeInTheDocument();
  expect(input).toHaveAttribute('aria-invalid', 'true');
});

test('admin_alert_email validation rejects invalid emails (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);

  const email = await screen.findByLabelText(/Alert Email/i);
  fireEvent.change(email, { target: { value: 'foo@' } });

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  expect(api.setSetting).not.toHaveBeenCalledWith({
    key: 'admin_alert_email',
    value: 'foo@',
  });
  expect(
    screen.getByText(/Please enter a valid email address/i)
  ).toBeInTheDocument();
  expect(email).toHaveAttribute('aria-invalid', 'true');
});

// Subtask 3 (Validation & Sanitization) — RED tests

test('idle_threshold shows helpful warnings for extreme but valid values (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);
  const idle = await screen.findByLabelText(/Idle Threshold/i);

  // Very short threshold (<60) -> warning
  fireEvent.change(idle, { target: { value: '45' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(api.setSetting).toHaveBeenCalledWith({
    key: 'idle_threshold',
    value: '45',
  });
  expect(screen.getByText(/Very short idle threshold/i)).toBeInTheDocument();

  // Very long threshold (>1800) -> warning
  fireEvent.change(idle, { target: { value: '2000' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(api.setSetting).toHaveBeenCalledWith({
    key: 'idle_threshold',
    value: '2000',
  });
  expect(screen.getByText(/Long idle threshold/i)).toBeInTheDocument();
});

test('time fields reject invalid HH:MM formats (RED)', async () => {
  setupIPC();
  render(<SettingsTab />);
  const start = await screen.findByLabelText(/^Start$/i);

  fireEvent.change(start, { target: { value: '24:60' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // type="time" may coerce invalid values to empty, triggering required error instead of pattern message.
  // Accept either message as evidence of rejection.
  expect(
    screen.getByText((text) =>
      /Please enter time in HH:MM|Work start time is required/i.test(text)
    )
  ).toBeInTheDocument();
  expect(start).toHaveAttribute('aria-invalid', 'true');
});

test('sanitization: employee_name rejects script/injection patterns (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);

  const name = await screen.findByLabelText(/Employee Name/i);
  fireEvent.change(name, { target: { value: "<script>alert('x')</script>" } });

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  expect(api.setSetting).not.toHaveBeenCalledWith({
    key: 'employee_name',
    value: expect.stringContaining('<script>'),
  });
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText(/can only contain letters/i)).toBeInTheDocument();
});

test('sanitization: admin_alert_email rejects embedded scripts (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);

  const email = await screen.findByLabelText(/Alert Email/i);
  fireEvent.change(email, { target: { value: 'user@example.com"><script>' } });

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  expect(api.setSetting).not.toHaveBeenCalledWith({
    key: 'admin_alert_email',
    value: expect.stringContaining('<script>'),
  });
  expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
});

// Subtask 3 additional RED tests (edge cases)

test('admin_alert_email rejects consecutive/leading/trailing dots (RED)', async () => {
  const api = setupIPC();
  render(<SettingsTab />);
  const email = await screen.findByLabelText(/Alert Email/i);

  const invalids = [
    'a..b@example.com',
    '.user@example.com',
    'user.@example.com',
    'user@example..com',
  ];

  for (const bad of invalids) {
    fireEvent.change(email, { target: { value: bad } });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(api.setSetting).not.toHaveBeenCalledWith({
      key: 'admin_alert_email',
      value: bad,
    });
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
  }
});

test('auto_export_time validation toggles aria-invalid (RED)', async () => {
  setupIPC();
  render(<SettingsTab />);
  // Wait for field to be present
  const timeInput = await screen.findByLabelText(/Export Time/i);

  // Set invalid value (use non-time string to avoid type="time" coercion in JSDOM)
  fireEvent.change(timeInput, { target: { value: 'ab:cd' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(timeInput).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText(/time in HH:MM|Invalid format/i)).toBeInTheDocument();

  // Set valid value
  fireEvent.change(timeInput, { target: { value: '23:59' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(timeInput).toHaveAttribute('aria-invalid', 'false');
});

// Subtask 4 (Integration with scheduler/services) - RED tests

test('reconfigureScheduler is called with correct parameters (RED)', async () => {
  const api = setupIPC({
    reconfigureScheduler: jest.fn(async () => ({ success: true })),
  });
  render(<SettingsTab />);
  // Wait initial load
  await screen.findByDisplayValue('19:00');

  // Disable exports and change time
  const enableCheckbox = screen.getByLabelText(/Enable/i);
  fireEvent.click(enableCheckbox); // false
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  const timeInput = screen.getByDisplayValue('19:00');
  fireEvent.change(timeInput, { target: { value: '06:45' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Expect last call params reflect latest state
  const lastCall = (api.reconfigureScheduler as jest.Mock).mock.calls.pop();
  expect(lastCall[0]).toEqual({ enabled: false, time: '06:45' });
});

test('reconfigureScheduler is NOT called on unrelated field changes (RED)', async () => {
  const api = setupIPC({
    reconfigureScheduler: jest.fn(async () => ({ success: true })),
  });
  render(<SettingsTab />);
  await screen.findByDisplayValue('19:00');

  // Change employee name only
  const nameInput = await screen.findByLabelText(/Employee Name/i);
  fireEvent.change(nameInput, { target: { value: 'No Scheduler Touch' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  expect(api.reconfigureScheduler).not.toHaveBeenCalled();
});

test('shows a non-blocking message when scheduler reconfigure fails (RED)', async () => {
  const api = setupIPC({
    reconfigureScheduler: jest.fn(async () => {
      throw new Error('boom');
    }),
  });
  render(<SettingsTab />);
  await screen.findByDisplayValue('19:00');

  // Trigger reconfigure failure via time change
  const timeInput = await screen.findByLabelText(/Export Time/i);
  fireEvent.change(timeInput, { target: { value: '06:00' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // UI remains responsive and shows a general error banner
  expect(
    screen.getByText(/Failed to reconfigure scheduler/i)
  ).toBeInTheDocument();
});

// Subtask 5 (Data management controls) - RED tests

test('purge all data requires double confirm and shows success (RED)', async () => {
  const api = setupIPC({
    clearAllData: jest.fn(async () => ({ success: true })),
  });
  render(<SettingsTab />);
  // Wait for initial load to complete
  await screen.findByDisplayValue('C:/Reports');
  await screen.findByText(/Data Management/i);

  // Double confirm sequence
  const confirmSpy = jest.spyOn(window, 'confirm');
  confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);

  const purgeBtn = screen.getByRole('button', { name: /Purge All Data/i });
  fireEvent.click(purgeBtn);

  await act(async () => {
    jest.advanceTimersByTime(100);
  });

  expect(api.clearAllData).toHaveBeenCalled();
  expect(screen.getByText(/purged successfully/i)).toBeInTheDocument();

  confirmSpy.mockRestore();
});

test('purge all data error path surfaces error banner (RED)', async () => {
  const api = setupIPC({
    clearAllData: jest.fn(async () => ({ success: false, error: 'nope' })),
  });
  render(<SettingsTab />);
  // Wait for initial load to complete
  await screen.findByDisplayValue('C:/Reports');
  await screen.findByText(/Data Management/i);

  const confirmSpy = jest.spyOn(window, 'confirm');
  confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);

  const purgeBtn = screen.getByRole('button', { name: /Purge All Data/i });
  fireEvent.click(purgeBtn);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });

  expect(screen.getByText(/Failed to purge data/i)).toBeInTheDocument();
  confirmSpy.mockRestore();
});

test('scheduler reconfigure failure is handled gracefully (RED)', async () => {
  const api = setupIPC({
    reconfigureScheduler: jest.fn(async () => {
      throw new Error('Scheduler offline');
    }),
  });
  render(<SettingsTab />);
  await screen.findByDisplayValue('19:00');
  // Trigger failure path
  const timeInput2 = screen.getByDisplayValue('19:00');
  fireEvent.change(timeInput2, { target: { value: '20:00' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // App should remain responsive: change another field and see success toast
  const nameInput = await screen.findByLabelText(/Employee Name/i);
  fireEvent.change(nameInput, { target: { value: 'Alex Dev' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(
    screen.getByText(/Employee Name updated successfully/i)
  ).toBeInTheDocument();
});

// Subtask 6 (Styling, accessibility, and consistency) — RED tests

test('success and error banners use ARIA live regions and roles (RED)', async () => {
  const api = setupIPC({
    setSetting: jest.fn(async () => ({ success: true })),
    reconfigureScheduler: jest.fn(async () => {
      throw new Error('boom');
    }),
  });
  render(<SettingsTab />);
  await screen.findByDisplayValue('C:/Reports');

  // Trigger a success toast with a valid value (no digits)
  const nameInput = await screen.findByLabelText(/Employee Name/i);
  fireEvent.change(nameInput, { target: { value: 'Valid User' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-live', expect.stringMatching(/polite/i));
  expect(status).toHaveTextContent(/updated successfully/i);

  // Trigger a general error banner with assertive role
  const timeInput = await screen.findByLabelText(/Export Time/i);
  fireEvent.change(timeInput, { target: { value: '06:05' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveAttribute(
    'aria-live',
    expect.stringMatching(/assertive/i)
  );
  expect(alert).toHaveTextContent(/Failed to reconfigure scheduler/i);
});

test('collapsible header is keyboard operable (Enter/Space) (RED)', async () => {
  setupIPC();
  render(<SettingsTab />);
  // Collapsible header exists and is focusable
  const header = await screen.findByRole('button', {
    name: /Daily Work Hours/i,
  });
  header.focus();
  expect(header).toHaveAttribute('tabindex', '0');

  // Toggle open with Enter
  fireEvent.keyDown(header, { key: 'Enter', code: 'Enter' });
  // Weekly container should appear
  expect(
    await screen.findByText(/Tip: For overnight shifts/i)
  ).toBeInTheDocument();
});

test('visual consistency: classes for banners and buttons match design system (RED)', async () => {
  setupIPC();
  render(<SettingsTab />);
  await screen.findByDisplayValue('C:/Reports');

  // Test other button classes if needed

  // Trigger success and error to assert classes
  const nameInput = await screen.findByLabelText(/Employee Name/i);
  fireEvent.change(nameInput, { target: { value: 'Visual Check' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  // success banner should use design system classes
  expect(screen.getByRole('status')).toHaveClass('banner', 'success-banner');

  // Force an error banner
  const timeInput = await screen.findByLabelText(/Export Time/i);
  (window as any).electronAPI.reconfigureScheduler = jest.fn(async () => {
    throw new Error('boom');
  });
  fireEvent.change(timeInput, { target: { value: '05:00' } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(screen.getByRole('alert')).toHaveClass('banner', 'error-banner');
});
