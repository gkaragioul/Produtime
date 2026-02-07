import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AdminLoginDialog } from './AdminLoginDialog';

// Use fake timers for deterministic delays
beforeEach(() => {
  jest.useFakeTimers();
  // Do not replace the global electronAPI object; extend it to avoid cross-file races
  if (!(window as any).electronAPI) {
    (window as any).electronAPI = {} as any;
  }
  Object.assign((window as any).electronAPI, {
    adminLogin: jest.fn(async (_req: any) => ({
      success: true,
      data: {
        success: false,
        isLockedOut: false,
        failedAttempts: 1,
        maxAttempts: 5,
      },
    })),
    getAdminLockoutState: jest.fn(async () => ({
      success: true,
      data: {
        is_locked: false,
        locked_until: null,
        id: 1,
        failed_attempts_count: 0,
        last_attempt_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })),
    resetAdminLockout: jest.fn(async () => ({ success: true })),
  });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

function openDialog() {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  render(
    <AdminLoginDialog isOpen={true} onClose={onClose} onSuccess={onSuccess} />
  );
  return { onClose, onSuccess };
}

describe('AdminLoginDialog (RED)', () => {
  test('has accessible label and controls', () => {
    openDialog();
    const label = screen.getByLabelText(/Admin Password/i);
    expect(label).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Login/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  test('requires password and shows error on empty submit', async () => {
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Login/i }));
    expect(
      await screen.findByText(/Please enter the admin password/i)
    ).toBeInTheDocument();
  });

  test('failed login increments failed attempts and shows error message', async () => {
    // adminLogin mocked to return success:false, failedAttempts:1
    openDialog();
    fireEvent.change(screen.getByLabelText(/Admin Password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Login/i }));
    // Wait for async
    await screen.findByText(/Invalid password/i);
    expect(screen.getByText(/Failed attempts:\s*1/i)).toBeInTheDocument();
  });

  test('successful authentication calls onSuccess and closes dialog', async () => {
    (window as any).electronAPI.adminLogin = jest.fn(async () => ({
      success: true,
      data: {
        success: true,
        isLockedOut: false,
        failedAttempts: 0,
        maxAttempts: 5,
      },
    }));
    const { onSuccess, onClose } = openDialog();
    fireEvent.change(screen.getByLabelText(/Admin Password/i), {
      target: { value: 'correct' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Login/i }));
    // Wait for async
    await act(async () => {});
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('when locked out, dialog communicates lockout and disables login', async () => {
    // Simulate lockout state from main
    (window as any).electronAPI.getAdminLockoutState = jest.fn(async () => ({
      success: true,
      data: {
        id: 1,
        is_locked: true,
        locked_until: new Date(Date.now() + 60_000).toISOString(),
        failed_attempts_count: 5,
        last_attempt_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));

    openDialog();
    // Expect explicit lockout status element and disabled login
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Account is locked/i
    );
    expect(screen.getByRole('button', { name: /Login/i })).toBeDisabled();
  });
});

test('locks out dynamically after 3 failed attempts without closing dialog (RED)', async () => {
  // Prepare: not locked initially, but adminLogin increments failures
  (window as any).electronAPI.getAdminLockoutState = jest
    .fn()
    // on open -> not locked
    .mockResolvedValueOnce({
      success: true,
      data: { is_locked: false, locked_until: null },
    })
    // after 1st failed attempt -> not locked
    .mockResolvedValueOnce({
      success: true,
      data: { is_locked: false, locked_until: null },
    })
    // after 2nd failed attempt -> not locked
    .mockResolvedValueOnce({
      success: true,
      data: { is_locked: false, locked_until: null },
    })
    // after 3rd failed attempt -> locked until +60s
    .mockResolvedValueOnce({
      success: true,
      data: {
        is_locked: true,
        locked_until: new Date(Date.now() + 60_000).toISOString(),
      },
    });
  (window as any).electronAPI.adminLogin = jest
    .fn()
    .mockResolvedValueOnce({
      success: true,
      data: { success: false, failedAttempts: 1 },
    })
    .mockResolvedValueOnce({
      success: true,
      data: { success: false, failedAttempts: 2 },
    })
    .mockResolvedValueOnce({
      success: true,
      data: { success: false, failedAttempts: 3 },
    });

  openDialog();

  const input = screen.getByLabelText(/Admin Password/i);
  const submit = screen.getByRole('button', { name: /Login/i });

  fireEvent.change(input, { target: { value: 'bad1' } });
  fireEvent.click(submit);
  await screen.findByText(/Invalid password/i);

  fireEvent.change(input, { target: { value: 'bad2' } });
  fireEvent.click(submit);
  await screen.findByText(/Invalid password/i);

  fireEvent.change(input, { target: { value: 'bad3' } });
  fireEvent.click(submit);

  // Expect the lockout status region to be present
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent(/Account is locked/i);
});

test('has role="dialog" for accessibility (RED)', () => {
  openDialog();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('shows lockout countdown text while locked (RED)', async () => {
  // Locked for 60s
  (window as any).electronAPI.getAdminLockoutState = jest.fn(async () => ({
    success: true,
    data: {
      is_locked: true,
      locked_until: new Date(Date.now() + 60_000).toISOString(),
    },
  }));

  openDialog();

  // Expect countdown text like "Try again in 60s"
  expect(await screen.findByText(/Try again in \d+s/i)).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(2000);
  });

  expect(screen.getByText(/Try again in \d+s/i)).toBeInTheDocument();
});

test('can reset lockout in test mode to re-enable login (RED)', async () => {
  // First locked, then unlocked after reset
  const getState = (window as any).electronAPI.getAdminLockoutState;
  (window as any).electronAPI.getAdminLockoutState = jest
    .fn()
    .mockResolvedValueOnce({
      success: true,
      data: {
        is_locked: true,
        locked_until: new Date(Date.now() + 60_000).toISOString(),
      },
    })
    .mockResolvedValueOnce({
      success: true,
      data: { is_locked: false, locked_until: null },
    });

  (window as any).electronAPI.resetAdminLockout = jest.fn(async () => ({
    success: true,
  }));

  openDialog();

  // Ensure locked status shown
  await screen.findByRole('status');

  // Click Reset Lockout (test/development control)
  fireEvent.click(screen.getByRole('button', { name: /Reset Lockout/i }));

  // After reset, login should be enabled
  expect(
    await screen.findByRole('button', { name: /Login/i })
  ).not.toBeDisabled();
  // Lockout message removed or not present
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
