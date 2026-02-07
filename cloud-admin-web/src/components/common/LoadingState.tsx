/**
 * Loading State Component
 * Requirements: 12.6 - Display loading states appropriately
 */

import React from 'react';

interface LoadingStateProps {
  message?: string;
  fullPage?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ message = 'Loading...', fullPage = false }) => {
  const containerStyle: React.CSSProperties = fullPage
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        zIndex: 9999,
      }
    : {
        padding: '40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      };

  return (
    <div style={containerStyle}>
      <div className="spinner" />
      <p style={{ marginTop: '16px', color: '#666', fontSize: '14px' }}>{message}</p>
    </div>
  );
};

/**
 * Loading Skeleton Component
 * For placeholder content while loading
 */
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = '20px', borderRadius = '4px' }) => (
  <div
    className="loading-skeleton"
    style={{
      width,
      height,
      borderRadius,
    }}
  />
);

/**
 * Card Skeleton Component
 * For loading card placeholders
 */
export const CardSkeleton: React.FC = () => (
  <div
    style={{
      backgroundColor: 'white',
      borderRadius: '10px',
      padding: '16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}
  >
    <Skeleton width="60%" height="16px" />
    <div style={{ marginTop: '12px' }}>
      <Skeleton width="100%" height="32px" />
    </div>
    <div style={{ marginTop: '8px' }}>
      <Skeleton width="40%" height="12px" />
    </div>
  </div>
);
