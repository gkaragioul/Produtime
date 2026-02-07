# Icon Preparation Instructions for ProduTime 1.6.9

## Required Icon Files

The ProduTime logo needs to be converted to the following formats:

### 1. **icon.png** (Primary Icon)
- **Location**: `assets/icon.png`
- **Size**: 256x256 pixels (or larger, will be auto-resized)
- **Format**: PNG with transparent background
- **Usage**: Window icon, tray icon, Linux AppImage

### 2. **icon.ico** (Windows Icon)
- **Location**: `assets/icon.ico`
- **Format**: ICO file containing multiple sizes (16x16, 32x32, 48x48, 64x64, 128x128, 256x256)
- **Usage**: Windows executable icon, taskbar icon

### 3. **icon.icns** (macOS Icon)
- **Location**: `assets/icon.icns`
- **Format**: ICNS file
- **Usage**: macOS application icon

## How to Create the Icons

### Option 1: Online Converter (Easiest)

1. **Save the ProduTime logo** (the PNG image provided) to your Desktop
2. **Go to**: https://www.icoconverter.com/ or https://cloudconvert.com/
3. **Upload** the ProduTime logo PNG
4. **Convert to**:
   - ICO format (for Windows) - select "Multi-size" option with sizes: 16, 32, 48, 64, 128, 256
   - ICNS format (for macOS)
5. **Download** the converted files
6. **Rename and place**:
   - Rename the ICO file to `icon.ico` and place in `assets/` folder
   - Rename the ICNS file to `icon.icns` and place in `assets/` folder
   - Copy the original PNG as `icon.png` to `assets/` folder

### Option 2: Using ImageMagick (Command Line)

If you have ImageMagick installed:

```bash
# Convert PNG to ICO with multiple sizes
magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico

# Convert PNG to ICNS (macOS)
# This requires additional tools on Windows
```

### Option 3: Manual Placement (Quick Test)

For quick testing, you can:

1. Save the ProduTime logo PNG as `assets/icon.png`
2. The application will use this PNG for the tray icon and window icon
3. For the Windows executable icon, you'll need the ICO file

## Current Status

The code has been updated to use these icon files:

✅ **package.json** - Added `"icon": "assets/icon.ico"` to Windows build config
✅ **src/main/main.ts** - BrowserWindow now uses `icon.png` for window icon
✅ **src/main/system-tray.ts** - Tray icon now loads from `icon.png` instead of programmatic "T"

## What Happens If Icons Are Missing?

- **Window/Tray Icon**: Falls back to programmatic "T" icon (blue background with white "T")
- **Executable Icon**: Uses default Electron icon

## Next Steps

1. Place the icon files in the `assets/` folder as described above
2. Run the build: `npm run build`
3. The icons will be automatically included in the build

