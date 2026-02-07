/**
 * Tracking Controls Component - Secondary Controls
 * 
 * Pause/Stop controls are de-emphasized. The product is awareness, not buttons.
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only control actions, no data display
 */

import React from 'react';

interface TrackingControlsProps {
  isTracking: boolean;
  isPaused: boolean;
  isLoading: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export const TrackingControls: React.FC<TrackingControlsProps> = ({
  isTracking,
  isPaused,
  isLoading,
  onStart,
  onStop,
  onPause,
  onResume,
}) => {
  return (
    <div className="tracking-controls">
      {!isTracking ? (
        <button
          className="control-button start"
          onClick={onStart}
          disabled={isLoading}
        >
          ▶️ Start Tracking
        </button>
      ) : isPaused ? (
        <div className="control-group">
          <button
            className="control-button resume"
            onClick={onResume}
            disabled={isLoading}
          >
            ▶️ Resume
          </button>
          <button
            className="control-button stop"
            onClick={onStop}
            disabled={isLoading}
          >
            ⏹️ Stop
          </button>
        </div>
      ) : (
        <div className="control-group">
          <button
            className="control-button pause"
            onClick={onPause}
            disabled={isLoading}
          >
            ⏸️ Pause
          </button>
          <button
            className="control-button stop"
            onClick={onStop}
            disabled={isLoading}
          >
            ⏹️ Stop
          </button>
        </div>
      )}
    </div>
  );
};
