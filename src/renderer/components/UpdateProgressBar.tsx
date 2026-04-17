import React, { useEffect, useState } from "react";
import { UpdateState, UpdateStatus } from "../../shared/types";

interface Props {
  updateState: UpdateState | null;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
  // Escape hatch: open the GitHub releases page in the browser so the
  // user can manually download a fresh installer. Shown in ERROR state
  // when in-app auto-update is stuck (corrupt current install,
  // repo ACL change, persistent network failure).
  onOpenReleasesPage?: () => void;
  // Renderer-side error, e.g. IPC invoke failed. Kept separate from
  // updateState.error (which is the main-process updater error) because
  // the user-triggered click failure should be visible even when the
  // state hasn't transitioned to ERROR.
  errorMessage?: string;
}

export const UpdateProgressBar: React.FC<Props> = ({
  updateState,
  onDownload,
  onInstall,
  onDismiss,
  onRetry,
  onOpenReleasesPage,
  errorMessage,
}) => {
  const [visible, setVisible] = useState(false);
  const [isStartingDownload, setIsStartingDownload] = useState(false);

  useEffect(() => {
    if (!updateState) {
      setVisible(!!errorMessage);
      return;
    }
    const { status } = updateState;
    setVisible(
      status === UpdateStatus.AVAILABLE ||
        status === UpdateStatus.DOWNLOADING ||
        status === UpdateStatus.DOWNLOADED ||
        status === UpdateStatus.ERROR ||
        !!errorMessage
    );
    // Reset "Starting..." on any status change — prevents stuck button if download fails early
    if (status !== UpdateStatus.AVAILABLE) {
      setIsStartingDownload(false);
    }
  }, [updateState, errorMessage]);

  if (!visible || !updateState) return null;

  const { status, info, progress, error } = updateState;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB/s`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatMB = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div style={styles.container}>
      {errorMessage && status !== UpdateStatus.ERROR && (
        <div style={styles.ipcError} title={errorMessage}>
          Action failed: {errorMessage.slice(0, 100)}
        </div>
      )}
      {status === UpdateStatus.AVAILABLE && (
        <>
          <div style={styles.icon}>⬆</div>
          <div style={styles.text}>
            <span style={styles.title}>
              ProduTime {info?.version} available
            </span>
          </div>
          <button
            style={{ ...styles.downloadBtn, ...(isStartingDownload ? { opacity: 0.7, cursor: 'wait' } : {}) }}
            disabled={isStartingDownload}
            onClick={() => { setIsStartingDownload(true); onDownload(); }}
          >
            {isStartingDownload ? 'Starting...' : 'Download & Install'}
          </button>
          <button style={styles.dismissBtn} onClick={onDismiss} title="Dismiss">
            ✕
          </button>
        </>
      )}

      {status === UpdateStatus.DOWNLOADING && (
        <>
          <div style={styles.icon}>⬇</div>
          <div style={styles.textFull}>
            <div style={styles.progressRow}>
              <span style={styles.title}>
                Downloading {info?.version ?? "update"}…&nbsp;
                {progress ? `${Math.round(progress.percent)}%` : ""}
              </span>
              {progress && (
                <span style={styles.speed}>
                  {formatBytes(progress.bytesPerSecond)} &nbsp;·&nbsp;{" "}
                  {formatMB(progress.transferred)} /{" "}
                  {formatMB(progress.total)}
                </span>
              )}
            </div>
            <div style={styles.track}>
              <div
                style={{
                  ...styles.fill,
                  width: `${progress?.percent ?? 0}%`,
                }}
              />
            </div>
          </div>
        </>
      )}

      {status === UpdateStatus.DOWNLOADED && (
        <>
          <div style={styles.icon}>✔</div>
          <div style={styles.text}>
            <span style={styles.title}>
              Installing {info?.version}… Restarting shortly
            </span>
          </div>
        </>
      )}

      {status === UpdateStatus.ERROR && (
        <>
          <div style={{ ...styles.icon, color: "#e53e3e" }}>✕</div>
          <div style={styles.text}>
            <span style={{ ...styles.title, color: "#e53e3e" }}>
              Update failed
            </span>
            <span style={styles.errorDetail}>
              {error?.slice(0, 80)}
            </span>
          </div>
          {onRetry && (
            <button
              style={{ ...styles.actionBtn, marginRight: 8 }}
              onClick={onRetry}
              title="Check again"
            >
              Retry
            </button>
          )}
          {onOpenReleasesPage && (
            <button
              style={{ ...styles.actionBtn, marginRight: 8 }}
              onClick={onOpenReleasesPage}
              title="Download the installer manually from GitHub"
            >
              Get it manually
            </button>
          )}
          <button style={styles.dismissBtn} onClick={onDismiss} title="Dismiss">
            ✕
          </button>
        </>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: 16,
    left: 16,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#1a202c",
    color: "#e2e8f0",
    borderRadius: 8,
    padding: "10px 14px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    minWidth: 300,
    maxWidth: 420,
    fontSize: 13,
  },
  icon: {
    fontSize: 16,
    flexShrink: 0,
    color: "#63b3ed",
  },
  text: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    overflow: "hidden",
  },
  textFull: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
  },
  progressRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  speed: {
    fontSize: 11,
    color: "#a0aec0",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  errorDetail: {
    fontSize: 11,
    color: "#fc8181",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ipcError: {
    position: "absolute",
    top: -22,
    left: 0,
    right: 0,
    fontSize: 11,
    color: "#fc8181",
    background: "#1a202c",
    borderRadius: 4,
    padding: "3px 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
  },
  track: {
    height: 4,
    background: "#2d3748",
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    background: "#63b3ed",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  downloadBtn: {
    background: "#3182ce",
    color: "#fff",
    border: "none",
    borderRadius: 5,
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  actionBtn: {
    background: "transparent",
    color: "#3182ce",
    border: "1px solid #3182ce",
    borderRadius: 5,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  dismissBtn: {
    background: "transparent",
    color: "#718096",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 4px",
    flexShrink: 0,
    lineHeight: 1,
  },
};
