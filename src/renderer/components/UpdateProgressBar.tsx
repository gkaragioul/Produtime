import React, { useEffect, useState } from "react";
import { UpdateState, UpdateStatus } from "../../shared/types";

interface Props {
  updateState: UpdateState | null;
  onDownload: () => void;
  onDismiss: () => void;
}

export const UpdateProgressBar: React.FC<Props> = ({
  updateState,
  onDownload,
  onDismiss,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!updateState) {
      setVisible(false);
      return;
    }
    const { status } = updateState;
    setVisible(
      status === UpdateStatus.AVAILABLE ||
        status === UpdateStatus.DOWNLOADING ||
        status === UpdateStatus.DOWNLOADED ||
        status === UpdateStatus.ERROR
    );
  }, [updateState]);

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
      {status === UpdateStatus.AVAILABLE && (
        <>
          <div style={styles.icon}>⬆</div>
          <div style={styles.text}>
            <span style={styles.title}>
              ProduTime {info?.version} available
            </span>
          </div>
          <button style={styles.downloadBtn} onClick={onDownload}>
            Download &amp; Install
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
              Installing {info?.version}… App will restart shortly
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
