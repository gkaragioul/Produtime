# Implementation Plan: Privacy Mode (v1.8.1)

## Overview

This plan implements Privacy Mode for ProduTime, adding window title sanitization for messaging apps to protect user privacy and support GDPR compliance.

## Tasks

- [x] 1. Update version to 1.8.1
  - Update version in `package.json` from 1.8.0 to 1.8.1
  - _Requirements: Version tracking_

- [x] 2. Add privacy constants and types
  - [x] 2.1 Create privacy constants file with DEFAULT_PRIVACY_APPS list
    - Create `src/main/services/privacy-constants.ts`
    - Define DEFAULT_PRIVACY_APPS array with 17 messaging apps
    - _Requirements: 2.1_
  - [x] 2.2 Add privacy-related types to shared types
    - Add `PrivacySettings` interface to `src/shared/types.ts`
    - _Requirements: 2.1, 2.3_

- [x] 3. Implement sanitization in Activity Tracker
  - [x] 3.1 Add sanitizeWindowTitle method to ActivityTracker
    - Add method that checks privacy mode setting and app list
    - Returns sanitized or original title based on conditions
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 3.2 Add getPrivacyApps helper method
    - Parse privacy_apps setting from database
    - Fall back to DEFAULT_PRIVACY_APPS on error
    - _Requirements: 2.1, 2.3_
  - [x] 3.3 Integrate sanitization into logCurrentActivity
    - Call sanitizeWindowTitle before database insert
    - _Requirements: 3.1, 3.4_
  - [x] 3.4 Write property test for sanitization logic
    - **Property 2: Window Title Sanitization Logic**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 4. Add IPC handlers for privacy settings
  - [x] 4.1 Add getPrivacySettings IPC handler
    - Return current privacy_mode_enabled and privacy_apps values
    - _Requirements: 1.2, 2.2_
  - [x] 4.2 Add setPrivacyMode IPC handler
    - Persist privacy_mode_enabled to database
    - _Requirements: 1.2, 1.3_
  - [x] 4.3 Expose privacy IPC methods in preload
    - Add getPrivacySettings and setPrivacyMode to electronAPI
    - _Requirements: 1.2, 1.3_
  - [x] 4.4 Write property test for setting persistence
    - **Property 1: Privacy Mode Setting Persistence**
    - **Validates: Requirements 1.2, 1.3**

- [x] 5. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add Privacy section to Settings UI
  - [x] 6.1 Add privacy state to SettingsTab component
    - Add useState for privacyModeEnabled and privacyApps
    - Load settings on component mount
    - _Requirements: 1.1, 2.2_
  - [x] 6.2 Create Privacy section UI
    - Add "Privacy" section with toggle checkbox
    - Add description text explaining the feature
    - Show protected apps list when enabled
    - _Requirements: 1.1, 2.2_
  - [x] 6.3 Implement toggle handler
    - Call setPrivacyMode IPC on toggle
    - Update local state immediately
    - _Requirements: 1.2, 1.3, 5.1_
  - [x] 6.4 Add CSS styles for privacy section
    - Style the privacy section, toggle, and apps list
    - _Requirements: 1.1_

- [x] 7. Initialize default settings
  - [x] 7.1 Add default privacy settings on first run
    - In database initialization, set privacy_mode_enabled to "false"
    - Set privacy_apps to JSON string of DEFAULT_PRIVACY_APPS
    - _Requirements: 1.4, 2.1_

- [x] 8. Final checkpoint - Full integration test
  - Ensure all tests pass, ask the user if questions arise.
  - Manual test: Enable privacy mode, use Slack, verify only "Slack" is logged

- [x] 9. Build and package v1.8.1
  - Run npm run build
  - Copy installer to desktop
  - _Requirements: All_

## Notes

- All tasks including property-based tests are required
- Privacy mode defaults to OFF to maintain backward compatibility
- Sanitization is case-insensitive for app name matching
- The feature only affects new logs; existing data is never modified
