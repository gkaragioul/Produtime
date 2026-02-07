import React, { useState, useEffect } from 'react';
import { PDFReportService } from '../services/pdf-report-service';
import {
  ReportType,
  ReportOptions,
  ReportData,
  GenerateReportResponse,
} from '../../shared/types';

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
};

interface ReportGeneratorProps {
  onReportGenerated?: (report: GenerateReportResponse) => void;
  onError?: (error: string) => void;
}

export const ReportGenerator: React.FC<ReportGeneratorProps> = ({
  onReportGenerated,
  onError,
}) => {
  const [reportType, setReportType] = useState<ReportType>(ReportType.DAILY);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [includeCharts, setIncludeCharts] = useState<boolean>(true);
  const [includeSummary, setIncludeSummary] = useState<boolean>(true);
  const [includeDetails, setIncludeDetails] = useState<boolean>(true);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  const reportService = PDFReportService.getInstance();

  useEffect(() => {
    // Set default dates based on report type
    switch (reportType) {
      case ReportType.DAILY:
        const today = reportService.getToday();
        setStartDate(today);
        setEndDate(today);
        break;
      case ReportType.WEEKLY:
        const thisWeek = reportService.getThisWeek();
        setStartDate(thisWeek.startDate);
        setEndDate(thisWeek.endDate);
        break;
      case ReportType.MONTHLY:
        const thisMonth = reportService.getThisMonth();
        setStartDate(thisMonth.startDate);
        setEndDate(thisMonth.endDate);
        break;
      case ReportType.CUSTOM:
        // Keep current dates or set to last week
        if (!startDate || !endDate) {
          const lastWeek = reportService.getLastWeek();
          setStartDate(lastWeek.startDate);
          setEndDate(lastWeek.endDate);
        }
        break;
    }
  }, [reportType]);

  const createReportOptions = (): ReportOptions => {
    return {
      type: reportType,
      format: 'pdf' as any,
      dateRange: {
        startDate,
        endDate,
      },
      includeCharts,
      includeSummary,
      includeDetails,
      title: customTitle || undefined,
    };
  };

  const handlePreviewReport = async () => {
    try {
      setIsPreviewLoading(true);
      const options = createReportOptions();

      // Validate options
      const errors = reportService.validateReportOptions(options);
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      const data = await reportService.getReportData(options);
      setReportData(data);
    } catch (error) {
      console.error('Error previewing report:', error);
      onError?.(String(error));
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    try {
      setIsGenerating(true);
      const options = createReportOptions();

      // Validate options
      const errors = reportService.validateReportOptions(options);
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      const report = await reportService.generateReport(options);
      onReportGenerated?.(report);

      // Optionally open the report
      await reportService.openReport(report.filePath);
    } catch (error) {
      console.error('Error generating report:', error);
      onError?.(String(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const getQuickDateOptions = () => {
    return [
      {
        label: 'Today',
        action: () => {
          const today = reportService.getToday();
          setStartDate(today);
          setEndDate(today);
          setReportType(ReportType.DAILY);
        },
      },
      {
        label: 'Yesterday',
        action: () => {
          const yesterday = reportService.getYesterday();
          setStartDate(yesterday);
          setEndDate(yesterday);
          setReportType(ReportType.DAILY);
        },
      },
      {
        label: 'This Week',
        action: () => {
          const thisWeek = reportService.getThisWeek();
          setStartDate(thisWeek.startDate);
          setEndDate(thisWeek.endDate);
          setReportType(ReportType.WEEKLY);
        },
      },
      {
        label: 'Last Week',
        action: () => {
          const lastWeek = reportService.getLastWeek();
          setStartDate(lastWeek.startDate);
          setEndDate(lastWeek.endDate);
          setReportType(ReportType.WEEKLY);
        },
      },
      {
        label: 'This Month',
        action: () => {
          const thisMonth = reportService.getThisMonth();
          setStartDate(thisMonth.startDate);
          setEndDate(thisMonth.endDate);
          setReportType(ReportType.MONTHLY);
        },
      },
      {
        label: 'Last Month',
        action: () => {
          const lastMonth = reportService.getLastMonth();
          setStartDate(lastMonth.startDate);
          setEndDate(lastMonth.endDate);
          setReportType(ReportType.MONTHLY);
        },
      },
    ];
  };

  return (
    <div className="report-generator">
      <h3>Generate Activity Report</h3>

      <div className="report-form">
        <div className="form-group">
          <label htmlFor="reportType">Report Type:</label>
          <select
            id="reportType"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
          >
            <option value={ReportType.DAILY}>Daily Report</option>
            <option value={ReportType.WEEKLY}>Weekly Report</option>
            <option value={ReportType.MONTHLY}>Monthly Report</option>
            <option value={ReportType.CUSTOM}>Custom Report</option>
          </select>
        </div>

        <div className="form-group">
          <label>Quick Date Selection:</label>
          <div className="quick-dates">
            {getQuickDateOptions().map((option, index) => (
              <button
                key={index}
                type="button"
                className="quick-date-btn"
                onClick={option.action}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="startDate">Start Date:</label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="endDate">End Date:</label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="customTitle">Custom Title (optional):</label>
          <input
            type="text"
            id="customTitle"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="Leave empty for auto-generated title"
          />
        </div>

        <div className="form-group">
          <label>Report Options:</label>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={(e) => setIncludeSummary(e.target.checked)}
              />
              Include Summary
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeDetails}
                onChange={(e) => setIncludeDetails(e.target.checked)}
              />
              Include Activity Details
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeCharts}
                onChange={(e) => setIncludeCharts(e.target.checked)}
              />
              Include Charts
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={handlePreviewReport}
            disabled={isPreviewLoading || isGenerating}
            className="preview-btn"
          >
            {isPreviewLoading ? 'Loading Preview...' : 'Preview Data'}
          </button>
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={isGenerating || isPreviewLoading}
            className="generate-btn"
          >
            {isGenerating ? 'Generating...' : 'Generate PDF Report'}
          </button>
        </div>
      </div>

      {reportData && (
        <div className="report-preview">
          <h4>Report Preview</h4>
          <div className="preview-summary">
            <p>
              <strong>Title:</strong> {reportData.title}
            </p>
            <p>
              <strong>Date Range:</strong> {reportData.dateRange.startDate} to{' '}
              {reportData.dateRange.endDate}
            </p>
            <p>
              <strong>Total Hours:</strong> {reportData.summary.totalHours}
            </p>
            <p>
              <strong>Total Sessions:</strong>{' '}
              {reportData.summary.totalSessions}
            </p>
            <p>
              <strong>Average Session:</strong>{' '}
              {reportData.summary.averageSessionLength} minutes
            </p>
            <p>
              <strong>Most Active Hour:</strong>{' '}
              {reportData.summary.mostActiveHour}:00
            </p>
          </div>

          {reportData.activityLogs.length > 0 && (
            <div className="preview-activities">
              <h5>
                Recent Activities ({reportData.activityLogs.length} total)
              </h5>
              <div className="activity-list">
                {reportData.activityLogs.slice(0, 5).map((log, index) => (
                  <div key={index} className="activity-item">
                    <span className="activity-time">
                      {new Date(log.timestamp).toLocaleDateString()} -{' '}
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="activity-app">{log.app_name}</span>
                    <span className="activity-duration">
                      {formatDuration(log.duration || 0)}
                    </span>
                  </div>
                ))}
                {reportData.activityLogs.length > 5 && (
                  <p className="more-activities">
                    ...and {reportData.activityLogs.length - 5} more activities
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
