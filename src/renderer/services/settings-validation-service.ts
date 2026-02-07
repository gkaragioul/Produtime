export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warning?: string;
}

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  min?: number;
  max?: number;
  customValidator?: (value: string) => ValidationResult;
}

export class SettingsValidationService {
  private static instance: SettingsValidationService;

  private constructor() {}

  public static getInstance(): SettingsValidationService {
    if (!SettingsValidationService.instance) {
      SettingsValidationService.instance = new SettingsValidationService();
    }
    return SettingsValidationService.instance;
  }

  private readonly validationRules: Record<string, ValidationRule> = {
    work_schedule_start: {
      required: true,
      pattern: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      customValidator: (value: string) => this.validateWorkTime(value, 'start'),
    },
    work_schedule_end: {
      required: true,
      pattern: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      customValidator: (value: string) => this.validateWorkTime(value, 'end'),
    },
    export_folder: {
      required: false,
      maxLength: 500,
      customValidator: (value: string) => this.validateFolderPath(value),
    },
    idle_threshold: {
      required: true,
      min: 30,
      max: 3600,
      customValidator: (value: string) => this.validateIdleThreshold(value),
    },
    employee_name: {
      required: true,
      minLength: 1,
      maxLength: 100,
      pattern: /^[a-zA-Z\s\-'\.]+$/,
    },
    admin_alert_email: {
      required: false,
      // Stricter pattern to prevent embedded scripts/quotes and enforce basic RFC-like structure
      pattern: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
      customValidator: (value: string) => this.validateEmail(value),
    },
    // Stored as JSON, validated in main process. We accept any string here.
    work_schedule_weekly: {
      required: false,
      customValidator: (_value: string) => ({ isValid: true }),
    },
    // New: Automatic export settings
    auto_export_enabled: {
      required: false,
      pattern: /^(true|false)$/,
    },
    auto_export_time: {
      required: false,
      pattern: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
    },
  };

  public validateSetting(key: string, value: string): ValidationResult {
    const rule = this.validationRules[key];
    if (!rule) {
      return { isValid: true };
    }

    // Check required
    if (rule.required && (!value || value.trim().length === 0)) {
      return {
        isValid: false,
        error: `${this.getFieldDisplayName(key)} is required`,
      };
    }

    // Skip other validations if value is empty and not required
    if (!rule.required && (!value || value.trim().length === 0)) {
      return { isValid: true };
    }

    // Check length constraints
    if (rule.minLength && value.length < rule.minLength) {
      return {
        isValid: false,
        error: `${this.getFieldDisplayName(key)} must be at least ${rule.minLength} characters long`,
      };
    }

    if (rule.maxLength && value.length > rule.maxLength) {
      return {
        isValid: false,
        error: `${this.getFieldDisplayName(key)} must be no more than ${rule.maxLength} characters long`,
      };
    }

    // Check pattern
    if (rule.pattern && !rule.pattern.test(value)) {
      return {
        isValid: false,
        error: this.getPatternErrorMessage(key),
      };
    }

    // Check numeric constraints
    if (rule.min !== undefined || rule.max !== undefined) {
      const numValue = parseFloat(value);
      if (isNaN(numValue)) {
        return {
          isValid: false,
          error: `${this.getFieldDisplayName(key)} must be a valid number`,
        };
      }

      if (rule.min !== undefined && numValue < rule.min) {
        return {
          isValid: false,
          error: `${this.getFieldDisplayName(key)} must be at least ${rule.min}`,
        };
      }

      if (rule.max !== undefined && numValue > rule.max) {
        return {
          isValid: false,
          error: `${this.getFieldDisplayName(key)} must be no more than ${rule.max}`,
        };
      }
    }

    // Run custom validator
    if (rule.customValidator) {
      return rule.customValidator(value);
    }

    return { isValid: true };
  }

  public validateAllSettings(
    settings: Record<string, string>
  ): Record<string, ValidationResult> {
    const results: Record<string, ValidationResult> = {};

    for (const [key, value] of Object.entries(settings)) {
      results[key] = this.validateSetting(key, value);
    }

    // Cross-field validation
    const crossValidation = this.validateCrossFields(settings);
    if (crossValidation.length > 0) {
      crossValidation.forEach(({ field, result }) => {
        results[field] = result;
      });
    }

    return results;
  }

  private validateWorkTime(
    value: string,
    type: 'start' | 'end'
  ): ValidationResult {
    if (!value) {
      return { isValid: false, error: `Work ${type} time is required` };
    }

    const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timePattern.test(value)) {
      return {
        isValid: false,
        error: 'Please enter time in HH:MM format (e.g., 09:00)',
      };
    }

    const [hours, minutes] = value.split(':').map(Number);
    const timeInMinutes = hours * 60 + minutes;

    if (type === 'start' && timeInMinutes < 0) {
      return { isValid: false, error: 'Invalid start time' };
    }

    if (type === 'end' && timeInMinutes > 1439) {
      // 23:59
      return { isValid: false, error: 'Invalid end time' };
    }

    return { isValid: true };
  }

  private validateFolderPath(value: string): ValidationResult {
    if (!value) {
      return { isValid: true }; // Optional field
    }

    // Allow an optional Windows drive prefix like "D:" at the beginning
    const windowsDrive = /^[A-Za-z]:/;

    // Disallow colon anywhere except as a single drive prefix at index 1
    const firstColon = value.indexOf(':');
    if (firstColon !== -1 && !(firstColon === 1 && windowsDrive.test(value))) {
      return {
        isValid: false,
        error: 'Folder path contains invalid characters',
      };
    }

    // Basic invalid characters (colon handled separately above)
    const invalidChars = /[<>"|?*]/;
    if (invalidChars.test(value)) {
      return {
        isValid: false,
        error: 'Folder path contains invalid characters',
      };
    }

    return { isValid: true };
  }

  private validateIdleThreshold(value: string): ValidationResult {
    const numValue = parseInt(value);
    if (isNaN(numValue)) {
      return {
        isValid: false,
        error: 'Idle threshold must be a valid number',
      };
    }

    if (numValue < 30) {
      return {
        isValid: false,
        error: 'Idle threshold must be at least 30 seconds',
      };
    }

    if (numValue > 3600) {
      return {
        isValid: false,
        error: 'Idle threshold must be no more than 3600 seconds (1 hour)',
      };
    }

    // Provide helpful suggestions
    if (numValue < 60) {
      return {
        isValid: true,
        warning: 'Very short idle threshold may cause frequent interruptions',
      };
    }

    if (numValue > 1800) {
      return {
        isValid: true,
        warning: 'Long idle threshold may miss periods of inactivity',
      };
    }

    return { isValid: true };
  }

  private validateEmail(value: string): ValidationResult {
    if (!value) {
      return { isValid: true }; // Optional field
    }

    // Stricter allowlist and basic shape; disallow angle brackets and quotes explicitly
    const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (/[<>"']/g.test(value)) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }

    if (!emailPattern.test(value)) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }

    // Additional constraints: no consecutive dots; no leading/trailing dots in local or domain
    const [local, domain] = value.split('@');
    if (!local || !domain) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }
    if (local.startsWith('.') || local.endsWith('.')) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }
    if (domain.startsWith('.') || domain.endsWith('.')) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }
    if (local.includes('..') || domain.includes('..')) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }

    return { isValid: true };
  }

  private validateCrossFields(
    settings: Record<string, string>
  ): Array<{ field: string; result: ValidationResult }> {
    const results: Array<{ field: string; result: ValidationResult }> = [];

    // Validate work schedule start/end relationship
    const startTime = settings.work_schedule_start;
    const endTime = settings.work_schedule_end;

    if (startTime && endTime) {
      const startMinutes = this.timeToMinutes(startTime);
      const endMinutes = this.timeToMinutes(endTime);

      if (startMinutes >= endMinutes) {
        results.push({
          field: 'work_schedule_end',
          result: {
            isValid: false,
            error: 'End time must be after start time',
          },
        });
      }

      const duration = endMinutes - startMinutes;
      if (duration < 60) {
        results.push({
          field: 'work_schedule_end',
          result: {
            isValid: true,
            warning: 'Work schedule is less than 1 hour',
          },
        });
      }
    }

    return results;
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private getFieldDisplayName(key: string): string {
    const displayNames: Record<string, string> = {
      work_schedule_start: 'Work start time',
      work_schedule_end: 'Work end time',
      export_folder: 'Export folder',
      idle_threshold: 'Idle threshold',
      employee_name: 'Employee name',
      admin_alert_email: 'Admin alert email',
      auto_export_enabled: 'Automatic exports',
      auto_export_time: 'Automatic export time',
    };

    return displayNames[key] || key.replace(/_/g, ' ');
  }

  private getPatternErrorMessage(key: string): string {
    const messages: Record<string, string> = {
      work_schedule_start: 'Please enter time in HH:MM format (e.g., 09:00)',
      work_schedule_end: 'Please enter time in HH:MM format (e.g., 17:00)',
      employee_name:
        'Employee name can only contain letters, spaces, hyphens, apostrophes, and periods',
      admin_alert_email: 'Please enter a valid email address',
      auto_export_enabled: "Must be 'true' or 'false'",
      auto_export_time: 'Please enter time in HH:MM format (e.g., 18:00)',
    };

    return messages[key] || 'Invalid format';
  }

  public getValidationSummary(results: Record<string, ValidationResult>): {
    isValid: boolean;
    errorCount: number;
    warningCount: number;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [key, result] of Object.entries(results)) {
      if (!result.isValid && result.error) {
        errors.push(`${this.getFieldDisplayName(key)}: ${result.error}`);
      }
      if (result.warning) {
        warnings.push(`${this.getFieldDisplayName(key)}: ${result.warning}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
    };
  }
}

export default SettingsValidationService;
