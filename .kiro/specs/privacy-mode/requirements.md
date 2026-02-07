# Requirements Document

## Introduction

This feature adds a "Privacy Mode" setting to ProduTime v1.8.1 that reduces the granularity of window title tracking for messaging and communication applications. When enabled, the system will only log the application name (e.g., "Slack", "Microsoft Teams") without capturing potentially sensitive information like contact names, conversation titles, or message previews that appear in window titles. This addresses GDPR compliance concerns and protects user privacy.

## Glossary

- **Activity_Tracker**: The main process service that polls the active window and logs activity to the database
- **Privacy_Mode**: A setting that when enabled, sanitizes window titles for designated privacy-sensitive applications
- **Privacy_Apps**: A configurable list of application names that should have their window titles sanitized when Privacy Mode is enabled
- **Sanitized_Title**: A generic replacement title (e.g., "Slack" or "Conversation") used instead of the actual window title

## Requirements

### Requirement 1: Privacy Mode Toggle

**User Story:** As a user, I want to enable or disable privacy mode for messaging apps, so that I can control whether sensitive information like contact names is tracked.

#### Acceptance Criteria

1. THE Settings_UI SHALL display a "Privacy Mode" toggle in the Settings tab under a "Privacy" section
2. WHEN the user enables Privacy Mode, THE System SHALL persist this setting to the database
3. WHEN the user disables Privacy Mode, THE System SHALL persist this setting to the database
4. THE System SHALL default Privacy Mode to disabled for new installations

### Requirement 2: Privacy-Sensitive Application List

**User Story:** As a user, I want to see which applications are treated as privacy-sensitive, so that I understand what apps will have reduced tracking.

#### Acceptance Criteria

1. THE System SHALL maintain a default list of privacy-sensitive applications including: Slack, Microsoft Teams, Discord, WhatsApp, Telegram, Signal, Zoom, Skype, Messages, Mail, Outlook
2. THE Settings_UI SHALL display the list of privacy-sensitive applications when Privacy Mode is enabled
3. THE Privacy_Apps list SHALL be stored as a configurable setting in the database

### Requirement 3: Window Title Sanitization

**User Story:** As a user, I want messaging app window titles to be sanitized when privacy mode is enabled, so that contact names and conversation details are not stored.

#### Acceptance Criteria

1. WHEN Privacy Mode is enabled AND the active application matches a Privacy_App, THE Activity_Tracker SHALL replace the window title with the application name only
2. WHEN Privacy Mode is disabled, THE Activity_Tracker SHALL log the full window title as normal
3. WHEN the active application does not match any Privacy_App, THE Activity_Tracker SHALL log the full window title regardless of Privacy Mode setting
4. THE sanitization SHALL occur before the activity log is written to the database

### Requirement 4: Existing Data Protection

**User Story:** As a user, I want my existing activity data to remain unchanged when I enable privacy mode, so that historical data is preserved.

#### Acceptance Criteria

1. WHEN Privacy Mode is enabled, THE System SHALL NOT modify any existing activity logs in the database
2. THE Privacy Mode setting SHALL only affect new activity logs created after the setting is changed

### Requirement 5: Real-time Application

**User Story:** As a user, I want privacy mode changes to take effect immediately, so that I don't need to restart the application.

#### Acceptance Criteria

1. WHEN the user changes the Privacy Mode setting, THE Activity_Tracker SHALL apply the new setting immediately without requiring app restart
2. THE Activity_Tracker SHALL read the Privacy Mode setting on each activity log write

### Requirement 6: Dashboard Display

**User Story:** As a user, I want to see sanitized app names in my dashboard when privacy mode is active, so that my reports reflect the privacy setting.

#### Acceptance Criteria

1. WHEN displaying activity logs where window titles were sanitized, THE Dashboard SHALL show the sanitized title (app name only)
2. THE Dashboard SHALL NOT attempt to reconstruct or display original window titles for sanitized entries
